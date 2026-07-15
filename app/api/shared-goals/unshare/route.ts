/**
 * app/api/shared-goals/unshare/route.ts
 *
 * Owner stops sharing a goal — deletes the shared_goals row only.
 * Cascades shared_goal_members and group_contributions (ON DELETE
 * CASCADE, 045); the underlying savings_goals row and its real balance
 * are completely untouched, since shared_goals only ever wrapped a
 * reference to it.
 *
 * Sprint 22, Phase 14: rate limited, same reasoning as groups/delete —
 * an irreversible cascading action with no rate limit at all before this.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("sharedGoals.unshare");
const RATE_LIMIT_ENDPOINT = "sharedGoals.unshare";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sharedGoalId } = await req.json().catch(() => ({}));
  if (!sharedGoalId) {
    return NextResponse.json({ error: "sharedGoalId required" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 10,
    actionLabel: "unshare actions",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data, error } = await supabase
    .from("shared_goals")
    .delete()
    .eq("id", sharedGoalId)
    .select("id")
    .maybeSingle();

  if (error) {
    log.error("unshare failed", { user_id: user.id, shared_goal_id: sharedGoalId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found, or you're not the owner" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}