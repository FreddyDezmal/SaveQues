/**
 * app/api/shared-goals/invite/route.ts
 *
 * Owner invites a user to contribute to a shared goal. Same stale-row
 * replacement pattern as /api/friends/request and /api/groups/invite for
 * a user re-invited after a past decline/removal — UNIQUE(shared_goal_id,
 * user_id) means the row must be deleted and recreated rather than
 * updated, since the 049 transition trigger deliberately doesn't allow
 * removed/declined → invited directly.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { sendGoalInvitation } from "@/lib/notifications";

const log = createLogger("sharedGoals.invite");
const RATE_LIMIT_ENDPOINT = "sharedGoals.invite";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sharedGoalId, targetUserId } = await req.json().catch(() => ({}));
  if (!sharedGoalId || !targetUserId) {
    return NextResponse.json({ error: "sharedGoalId and targetUserId required" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 30,
    actionLabel: "shared goal invites",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data: existing, error: fetchError } = await supabase
    .from("shared_goal_members")
    .select("id, status")
    .eq("shared_goal_id", sharedGoalId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (fetchError) {
    log.error("invite lookup failed", { user_id: user.id, shared_goal_id: sharedGoalId, error: fetchError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  if (existing) {
    if (existing.status === "active" || existing.status === "invited") {
      return NextResponse.json({ error: `Already ${existing.status === "active" ? "a contributor" : "invited"}` }, { status: 409 });
    }
    const { error: deleteError } = await supabase.from("shared_goal_members").delete().eq("id", existing.id);
    if (deleteError) {
      log.error("stale shared goal member cleanup failed", { user_id: user.id, error: deleteError.message });
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  }

  const { error: insertError } = await supabase
    .from("shared_goal_members")
    .insert({ shared_goal_id: sharedGoalId, user_id: targetUserId, invited_by: user.id });

  if (insertError) {
    log.warn("shared goal invite insert failed", { user_id: user.id, shared_goal_id: sharedGoalId, target: targetUserId, error: insertError.message });
    return NextResponse.json({ error: "Couldn't send that invite — check you own this shared goal" }, { status: 400 });
  }

  const [{ data: inviterProfile }, { data: sg }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).single(),
    supabase.from("shared_goals").select("goal_id").eq("id", sharedGoalId).single(),
  ]);
  // savings_goals is RLS-locked to auth.uid() = user_id (014) — readable
  // here because the caller is the goal's owner (enforce_shared_goal_
  // ownership, 045/049, already guarantees that for any shared_goals row
  // they own).
  const { data: goal } = sg
    ? await supabase.from("savings_goals").select("title").eq("id", sg.goal_id).single()
    : { data: null };
  sendGoalInvitation(targetUserId, inviterProfile?.display_name || "Someone", goal?.title || "a shared goal").catch((err) =>
    log.error("sendGoalInvitation failed", { error: err.message })
  );

  return NextResponse.json({ success: true });
}