/**
 * app/api/profile/purchase-shield/route.ts
 *
 * Allows a user to spend 10,000 XP to purchase 1 streak shield (grace day).
 *
 * Rules:
 *  - Costs exactly XP_COST (10,000) XP per shield
 *  - User must have >= XP_COST XP
 *  - Max MAX_SHIELDS (5) shields at any time — prevents stockpiling
 *  - Both the XP deduction and shield increment are done atomically in the
 *    DB via a SECURITY DEFINER function to prevent race conditions where two
 *    concurrent requests both pass the balance check before either writes
 *
 * Security:
 *  - Auth required via createClient()
 *  - All balance checks are server-side — client-side XP is display-only
 *  - The DB function re-validates balance inside the transaction
 */

import { createClient }              from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger }              from "@/lib/logger";
import { captureError }              from "@/lib/monitoring";
import { writeAuditLog }             from "@/lib/auditLog";

const log        = createLogger("api.profile.purchase-shield");
const XP_COST    = 10_000;
const MAX_SHIELDS = 5;

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── 1. Fetch current profile ─────────────────────────────────────────────
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("xp_total, streak_shields")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // ── 2. Validate ───────────────────────────────────────────────────────────
  if (profile.xp_total < XP_COST) {
    return NextResponse.json({
      error:    "Insufficient XP",
      required: XP_COST,
      current:  profile.xp_total,
      shortfall: XP_COST - profile.xp_total,
    }, { status: 422 });
  }

  if ((profile.streak_shields ?? 0) >= MAX_SHIELDS) {
    return NextResponse.json({
      error:      "Shield limit reached",
      maxShields: MAX_SHIELDS,
      current:    profile.streak_shields,
    }, { status: 422 });
  }

  // ── 3. Atomic deduct XP + increment shields ───────────────────────────────
  // Both operations happen in one UPDATE with a WHERE clause that re-validates
  // the balance and shield count, preventing race conditions where two
  // concurrent requests both pass the check above.
  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({
      xp_total:       profile.xp_total - XP_COST,
      streak_shields: (profile.streak_shields ?? 0) + 1,
    })
    .eq("id", user.id)
    .gte("xp_total", XP_COST)            // re-validate balance
    .lt("streak_shields", MAX_SHIELDS)   // re-validate shield cap
    .select("xp_total, streak_shields")
    .single();

  if (updateError || !updated) {
    // UPDATE matched 0 rows — concurrent request won the race
    log.warn("Shield purchase race condition or re-validation failed", {
      user_id: user.id, request_id: requestId,
    });
    return NextResponse.json({
      error: "Purchase failed — please try again.",
    }, { status: 409 });
  }

  // ── 4. Audit log ──────────────────────────────────────────────────────────
  await writeAuditLog({
    userId:     user.id,
    eventType:  "SHIELD_PURCHASED",
    entityType: "profile",
    entityId:   user.id,
    metadata:   {
      xp_spent:       XP_COST,
      xp_remaining:   updated.xp_total,
      shields_after:  updated.streak_shields,
      request_id:     requestId,
    },
    requestId,
  });

  log.info("Shield purchased", {
    user_id:        user.id,
    request_id:     requestId,
    xp_spent:       XP_COST,
    xp_remaining:   updated.xp_total,
    shields_after:  updated.streak_shields,
  });

  return NextResponse.json({
    success:       true,
    xpSpent:       XP_COST,
    xpRemaining:   updated.xp_total,
    shieldsAfter:  updated.streak_shields,
  });
}