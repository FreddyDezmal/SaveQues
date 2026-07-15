/**
 * app/api/shared-goals/group/route.ts
 *
 * Owner attaches a shared goal to a group (visible to all that group's
 * members via can_view_shared_goal, 045) or detaches it (groupId: null,
 * back to invite-only visibility). enforce_shared_goal_ownership (049)
 * requires the owner actually be a member of any group they attach.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("sharedGoals.group");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { sharedGoalId } = body;
  if (!sharedGoalId) {
    return NextResponse.json({ error: "sharedGoalId required" }, { status: 400 });
  }
  const groupId = body.groupId === null || body.groupId === undefined ? null : body.groupId;

  const { data, error } = await supabase
    .from("shared_goals")
    .update({ group_id: groupId })
    .eq("id", sharedGoalId)
    .select("id, group_id")
    .maybeSingle();

  if (error) {
    log.warn("shared goal group attach failed", { user_id: user.id, shared_goal_id: sharedGoalId, error: error.message });
    return NextResponse.json(
      { error: "Couldn't update that — check you own this shared goal and (if attaching) are a member of the group" },
      { status: 400 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Not found, or you're not the owner" }, { status: 404 });
  }

  return NextResponse.json({ success: true, sharedGoal: data });
}