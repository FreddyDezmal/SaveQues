/**
 * app/api/profile/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * PATCH /api/profile — Sprint 10, Part 3: Profile Update API Route
 *
 * Replaces TWO separate client-direct Supabase write paths:
 *   1. app/(app)/settings/SettingsClient.tsx — display_name, currency_code
 *   2. app/(app)/profile/ProfileClient.tsx   — avatar_emoji
 *
 * These were two different components writing to the same table with no
 * shared validation, logging, or audit trail. This route is the single
 * consolidated write path for all three fields going forward.
 *
 * RLS INTERACTION (per the brief's explicit question)
 *   This route uses the REGULAR (anon-key, cookie-authenticated) Supabase
 *   client via createClient(), NOT the service-role client. This is a
 *   deliberate choice: profiles already has RLS policy
 *   "Users can view/update own profile" scoped to auth.uid() = id, which
 *   is the correct enforcement boundary for a self-service profile edit.
 *
 *   Using the service role here would be WRONG — it would bypass RLS
 *   entirely for a write that should never need to. The service role is
 *   reserved for operations RLS cannot express (e.g. DELETE /api/account
 *   calling admin.deleteUser(), which operates on auth.users, a table
 *   profiles' RLS has no jurisdiction over). For a same-table,
 *   same-owner update like this one, the regular client + RLS is both
 *   sufficient and the more defensible default — it means even a bug in
 *   this route's logic cannot write to another user's profile, because
 *   the database itself enforces the boundary independent of application
 *   code correctness.
 *
 *   Browser-direct updates ARE fully removed by this change — both
 *   SettingsClient.tsx and ProfileClient.tsx are updated to call this
 *   route instead of `supabase.from("profiles").update(...)` directly.
 *
 * Validation (mirrors DB constraints in 025_validation_constraints.sql,
 *   expanded by 056_expand_currency_codes.sql):
 *  • display_name: 1-60 characters
 *  • currency_code: must be one of lib/currency.ts's SUPPORTED_CURRENCIES
 *    codes (116 ISO-4217 currencies as of Sprint 31 Phase 3 — this comment
 *    said "10" until Sprint 31's Phase 14 security audit caught it; the
 *    validation itself (VALID_CURRENCY_CODES below) was already correctly
 *    derived from SUPPORTED_CURRENCIES, only this comment was stale)
 *  • avatar_emoji: must be one of the curated AVATAR_OPTIONS (mirrored
 *    here from ProfileClient.tsx — see inline constant)
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";

const log = createLogger("profile.update");

const MAX_DISPLAY_NAME_LEN = 60;
const VALID_CURRENCY_CODES = SUPPORTED_CURRENCIES.map(c => c.code);
const VALID_PROFILE_VISIBILITY = ["private", "friends", "public"];
const VALID_ACTIVITY_VISIBILITY = ["private", "friends", "groups", "public"];

// Mirrors AVATAR_OPTIONS in app/(app)/profile/ProfileClient.tsx — kept as
// an explicit allowlist here rather than imported, because ProfileClient
// is a client component and this avoids pulling client-only code into the
// API route's bundle. If AVATAR_OPTIONS changes, update both locations.
const VALID_AVATAR_EMOJIS = [
  "🌱", "💰", "🚀", "⚡", "🏆", "🔥", "💎", "👑", "🦅", "🧠", "🎯", "✨", "🌟", "⚔️", "🛡️",
];

export async function PATCH(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  setSentryUser(user.id);

  let body: {
    display_name?: string; avatar_emoji?: string; currency_code?: string;
    profile_visibility?: string; activity_visibility?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { display_name, avatar_emoji, currency_code, profile_visibility, activity_visibility } = body;

  // ── Validation ────────────────────────────────────────────────────────────
  const validationErrors: string[] = [];

  if (display_name !== undefined) {
    if (typeof display_name !== "string" || display_name.trim().length === 0) {
      validationErrors.push("display_name cannot be empty");
    } else if (display_name.trim().length > MAX_DISPLAY_NAME_LEN) {
      validationErrors.push(`display_name cannot exceed ${MAX_DISPLAY_NAME_LEN} characters`);
    }
  }

  if (avatar_emoji !== undefined && !VALID_AVATAR_EMOJIS.includes(avatar_emoji)) {
    validationErrors.push("avatar_emoji must be one of the supported avatar options");
  }

  if (currency_code !== undefined && !VALID_CURRENCY_CODES.includes(currency_code)) {
    validationErrors.push(`currency_code must be one of: ${VALID_CURRENCY_CODES.join(", ")}`);
  }

  // Sprint 22, Phase 12. Mirrors the CHECK constraints added in
  // 045_social_foundation.sql exactly — profile_visibility has no
  // 'groups' option (there's no natural "groups" reading for "can
  // strangers find my profile at all"), activity_visibility does.
  if (profile_visibility !== undefined && !VALID_PROFILE_VISIBILITY.includes(profile_visibility)) {
    validationErrors.push(`profile_visibility must be one of: ${VALID_PROFILE_VISIBILITY.join(", ")}`);
  }
  if (activity_visibility !== undefined && !VALID_ACTIVITY_VISIBILITY.includes(activity_visibility)) {
    validationErrors.push(`activity_visibility must be one of: ${VALID_ACTIVITY_VISIBILITY.join(", ")}`);
  }

  if (validationErrors.length > 0) {
    log.warn("Profile update rejected — validation failed", {
      user_id: user.id, request_id: requestId, errors: validationErrors.join("; "),
    });
    return NextResponse.json({ error: validationErrors.join("; ") }, { status: 422 });
  }

  // ── Build update payload (only provided fields) ───────────────────────────
  const updates: Record<string, unknown> = {};
  if (display_name  !== undefined) updates.display_name  = display_name.trim();
  if (avatar_emoji  !== undefined) updates.avatar_emoji   = avatar_emoji;
  if (currency_code !== undefined) {
    updates.currency_code = currency_code;
    const selected = SUPPORTED_CURRENCIES.find(c => c.code === currency_code);
    if (selected?.locale) updates.locale = selected.locale;
  }
  if (profile_visibility !== undefined) updates.profile_visibility = profile_visibility;
  if (activity_visibility !== undefined) updates.activity_visibility = activity_visibility;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const end = log.time("profile update", {
    user_id: user.id, request_id: requestId, fields: Object.keys(updates).join(","),
  });

  // ── Update — RLS-scoped client, NOT service role (see file header) ───────
  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id)
    .select()
    .single();

  if (updateError) {
    log.error("Profile update failed", {
      user_id: user.id, request_id: requestId, error: updateError.message, error_code: updateError.code,
    });
    captureError(updateError, { route: "PATCH /api/profile", user_id: user.id, request_id: requestId });
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── Analytics ────────────────────────────────────────────────────────────
  // Profile updates are product engagement signals, not financial/account
  // lifecycle events — PostHog only, no audit_logs entry. See lib/auditLog.ts
  // header and this sprint's "audit logs vs PostHog" rationale: a changed
  // display name, avatar emoji, or currency preference has no support/
  // compliance reconstruction value the way a deposit or account deletion
  // does. None of the three fields here are in the Sprint 10 required
  // PostHog event list either, so no trackServerEvent call is made — this
  // route's value is consolidation, validation, and logging, not new
  // analytics surface.

  end({ user_id: user.id, request_id: requestId, fields: Object.keys(updates).join(",") });

  return NextResponse.json({ profile: updated });
}