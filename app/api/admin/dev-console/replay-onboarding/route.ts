/**
 * app/api/admin/dev-console/replay-onboarding/route.ts
 *
 * Resets a demo account's onboarding flags so its next login goes
 * through onboarding again — for QA on the onboarding funnel without
 * creating a fresh account every time. Direct service-role UPDATE, same
 * reasoning as reset-streak/route.ts: no RPC gate to route around here.
 *
 * Resets exactly the three onboarding-related profiles columns (added
 * in migration 022_onboarding_activation.sql): onboarding_goal_created,
 * notification_prompt_dismissed, onboarding_completed_at. Does NOT
 * touch xp_total, goals, or transactions — "replay onboarding" means
 * re-showing the onboarding UI, not wiping the account's history.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog } from "@/lib/adminAudit";
import { requireDemoAccount }     from "@/lib/devConsole";

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.dev-console.replay-onboarding");
    const { userId } = await req.json();

    await requireDemoAccount(service, userId);

    const { data: before } = await service
      .from("profiles")
      .select("onboarding_goal_created, notification_prompt_dismissed, onboarding_completed_at")
      .eq("id", userId)
      .single();

    const { error } = await service.from("profiles").update({
      onboarding_goal_created: false,
      notification_prompt_dismissed: false,
      onboarding_completed_at: null,
    }).eq("id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auditLog(service, user.id, "UPDATE", "dev_console_action", `replay_onboarding:${userId}`,
      { action: "replay_onboarding", target_user_id: userId, before },
      { action: "replay_onboarding", target_user_id: userId }
    );

    return NextResponse.json({ success: true });
  } catch (res) { return res as Response; }
}