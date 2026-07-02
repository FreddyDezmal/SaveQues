/**
 * app/api/profile/purchase-shield/route.ts
 *
 * Spends 10,000 XP to purchase 1 streak shield (grace day).
 *
 * Uses purchase_shield() SECURITY DEFINER RPC (migration 037) rather than
 * a direct UPDATE because the profiles RLS policy (migration 010) correctly
 * blocks client-session updates to xp_total and streak_shields. The RPC
 * runs as postgres role, bypasses RLS, and has its own C1 ownership guard.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger }  from "@/lib/logger";
import { writeAuditLog } from "@/lib/auditLog";

const log         = createLogger("api.profile.purchase-shield");
const XP_COST     = 10_000;
const MAX_SHIELDS  = 5;

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Call SECURITY DEFINER RPC ────────────────────────────────────────────
  const { data: result, error: rpcError } = await supabase.rpc("purchase_shield", {
    p_user_id:    user.id,
    p_xp_cost:    XP_COST,
    p_max_shields: MAX_SHIELDS,
  });

  if (rpcError) {
    log.error("purchase_shield RPC error", {
      user_id: user.id, request_id: requestId, error: rpcError.message,
    });
    return NextResponse.json({ error: "Purchase failed. Please try again." }, { status: 500 });
  }

  const r = result as any;

  // ── Handle RPC-level validation failures ─────────────────────────────────
  if (!r?.success) {
    if (r?.error === "insufficient_xp") {
      return NextResponse.json({
        error:     "Insufficient XP",
        required:  r.required,
        current:   r.current,
        shortfall: r.shortfall,
      }, { status: 422 });
    }
    if (r?.error === "shield_limit_reached") {
      return NextResponse.json({
        error:      "Shield limit reached",
        maxShields: r.maxShields,
        current:    r.current,
      }, { status: 422 });
    }
    if (r?.error === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: r?.error ?? "Purchase failed" }, { status: 400 });
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  await writeAuditLog({
    userId:     user.id,
    eventType:  "SHIELD_PURCHASED",
    entityType: "profile",
    entityId:   user.id,
    metadata:   {
      xp_spent:      XP_COST,
      xp_remaining:  r.xp_remaining,
      shields_after: r.shields_after,
      request_id:    requestId,
    },
    requestId,
  });

  log.info("Shield purchased", {
    user_id:       user.id,
    request_id:    requestId,
    xp_spent:      XP_COST,
    xp_remaining:  r.xp_remaining,
    shields_after: r.shields_after,
  });

  return NextResponse.json({
    success:      true,
    xpSpent:      XP_COST,
    xpRemaining:  r.xp_remaining,
    shieldsAfter: r.shields_after,
  });
}