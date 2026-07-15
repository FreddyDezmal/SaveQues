/**
 * app/api/shared-goals/members/remove/route.ts
 *
 * Removes a contributor (owner action) or leaves a shared goal (self
 * action) — both are the same 'active' → 'removed' transition, which the
 * 049 trigger allows for either the member themself or the owner.
 * Contributions already logged (group_contributions) are untouched —
 * leaving doesn't erase what was already tracked.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("sharedGoals.members.remove");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberId } = await req.json().catch(() => ({}));
  if (!memberId) {
    return NextResponse.json({ error: "memberId required" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await supabase
    .from("shared_goal_members")
    .select("id, status")
    .eq("id", memberId)
    .maybeSingle();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (row.status !== "active") {
    return NextResponse.json({ error: `Not an active contributor (${row.status})` }, { status: 409 });
  }

  const { error: updateError } = await supabase
    .from("shared_goal_members")
    .update({ status: "removed" })
    .eq("id", memberId);

  if (updateError) {
    log.warn("shared goal member remove failed", { user_id: user.id, member_id: memberId, error: updateError.message });
    return NextResponse.json({ error: "Couldn't remove that contributor" }, { status: 403 });
  }

  return NextResponse.json({ success: true });
}