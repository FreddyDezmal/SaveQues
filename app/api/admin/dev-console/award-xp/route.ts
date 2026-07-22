/**
 * app/api/admin/dev-console/award-xp/route.ts
 *
 * Grants XP directly to a demo account for QA purposes — e.g. testing
 * level-up UI, seasonal XP tracks, or leaderboard placement without
 * grinding real quests.
 *
 * IMPORTANT — does NOT use lib/awardXP.ts's awardXP(). That function
 * calls the award_xp() Postgres RPC via the session-scoped client, and
 * award_xp() unconditionally rejects source_type = 'admin_grant' for
 * every caller (see migration 018 — a deliberate, permanent
 * privilege-escalation fix, not something to route around). This route
 * instead calls the new admin_award_xp() RPC (migration 061), a
 * separate function granted EXECUTE only to service_role — unreachable
 * from any browser session, admin or not, which is what makes it safe
 * to allow admin_grant through it. See that migration's header for the
 * full reasoning.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog } from "@/lib/adminAudit";
import { requireDemoAccount }     from "@/lib/devConsole";

const MAX_GRANT = 100_000; // sanity ceiling — this is a QA tool, not a way to bypass game balance entirely

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.dev-console.award-xp");
    const { userId, amount, reason } = await req.json();

    if (typeof amount !== "number" || amount <= 0 || amount > MAX_GRANT) {
      return NextResponse.json({ error: `amount must be a number between 1 and ${MAX_GRANT}` }, { status: 400 });
    }

    await requireDemoAccount(service, userId);

    // sourceId includes a fresh random component so repeated grants of
    // the same amount to the same user aren't treated as the same
    // idempotent award and silently no-op the second time.
    const sourceId = `dev_console:${crypto.randomUUID()}`;

    const { data, error } = await service.rpc("admin_award_xp", {
      p_user_id: userId,
      p_source_id: sourceId,
      p_xp: amount,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data?.success) {
      return NextResponse.json({ error: data?.error ?? "XP award failed" }, { status: 500 });
    }

    await auditLog(service, user.id, "CREATE", "dev_console_action", `award_xp:${userId}`,
      null, { action: "award_xp", target_user_id: userId, amount, reason: reason ?? null, new_total: data.new_total }
    );

    return NextResponse.json({ success: true, xpAwarded: data.xp_awarded, newTotal: data.new_total });
  } catch (res) { return res as Response; }
}