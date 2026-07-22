/**
 * app/api/admin/dev-console/reset-streak/route.ts
 *
 * Resets a demo account's current streak — for QA on the comeback flow,
 * streak-shield UI, or momentum recovery without waiting for a real
 * missed day. A direct service-role UPDATE on profiles is safe here
 * (unlike award-xp): the streak columns have no SECURITY DEFINER RPC
 * gate to route around, and service_role bypasses RLS entirely, so no
 * new database function is needed for this one.
 *
 * Resets streak_days, last_active_date, and streak_paused_until.
 * longest_streak (a lifetime record) and streak_shields (shields the
 * demo account may have "earned" for testing) are left untouched unless
 * resetShields is explicitly passed — deliberately opt-in, since wiping
 * a QA tester's shield count on every streak reset would make shield-
 * related testing more annoying, not less.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog } from "@/lib/adminAudit";
import { requireDemoAccount }     from "@/lib/devConsole";

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.dev-console.reset-streak");
    const { userId, resetShields } = await req.json();

    await requireDemoAccount(service, userId);

    const { data: before } = await service
      .from("profiles")
      .select("streak_days, longest_streak, last_active_date, streak_shields, total_shields_used, streak_paused_until")
      .eq("id", userId)
      .single();

    const updates: Record<string, unknown> = {
      streak_days: 0,
      last_active_date: null,
      streak_paused_until: null,
    };
    if (resetShields === true) {
      updates.streak_shields = 2;      // matches profiles.streak_shields' DEFAULT
      updates.total_shields_used = 0;
    }

    const { data: after, error } = await service.from("profiles").update(updates).eq("id", userId).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auditLog(service, user.id, "UPDATE", "dev_console_action", `reset_streak:${userId}`,
      { action: "reset_streak", target_user_id: userId, before },
      { action: "reset_streak", target_user_id: userId, after: { streak_days: after.streak_days, streak_shields: after.streak_shields } }
    );

    return NextResponse.json({ success: true });
  } catch (res) { return res as Response; }
}