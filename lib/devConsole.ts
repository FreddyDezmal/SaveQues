/**
 * lib/devConsole.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 24 (Product Intelligence Platform) — Phase 8: Internal
 * Developer Console.
 *
 * Every route under app/api/admin/dev-console/* calls
 * requireDemoAccount() before doing anything else. This is the one
 * place that check lives — see migration 060's header for why is_demo
 * exists at all. A dev-console route that skipped this check could
 * credit arbitrary XP, wipe a real streak, insert a fake deposit into a
 * real user's real transaction history, or (for impersonation) generate
 * a session that lets an admin browse the app as a real user. In a
 * fintech app those are not equivalent-severity bugs to get wrong.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Throws a Response (same "throw the Response, catch it in the route"
 * convention requireAdmin() in lib/adminAudit.ts already uses) if the
 * target user doesn't exist or isn't a demo account. Returns nothing on
 * success — callers proceed only if this resolves without throwing.
 */
export async function requireDemoAccount(service: SupabaseClient, targetUserId: string): Promise<void> {
  if (!targetUserId || typeof targetUserId !== "string") {
    throw NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { data: profile, error } = await service
    .from("profiles")
    .select("id, is_demo")
    .eq("id", targetUserId)
    .maybeSingle();

  if (error || !profile) {
    throw NextResponse.json({ error: "Target user not found" }, { status: 404 });
  }

  if (!profile.is_demo) {
    // Distinct from the 404 above on purpose — this is an internal admin
    // tool behind requireAdmin() already, not a public endpoint, so
    // there's no user-enumeration concern to hide behind a generic
    // error. Telling an admin "found the user, but they're not a demo
    // account" vs "no such user" is more useful for debugging a typo'd
    // userId than a single undifferentiated failure would be.
    throw NextResponse.json(
      { error: "This action can only be performed on a demo account (profiles.is_demo = true)." },
      { status: 403 }
    );
  }
}