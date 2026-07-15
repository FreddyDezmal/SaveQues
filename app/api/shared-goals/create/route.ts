/**
 * app/api/shared-goals/create/route.ts
 *
 * Converts an existing savings goal into a shared goal. Does not touch
 * savings_goals at all — just creates the shared_goals wrapper row.
 * enforce_shared_goal_ownership (045/049) verifies goalId really belongs
 * to the caller and, if groupId is given, that the caller is actually a
 * member of that group.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("sharedGoals.create");
const RATE_LIMIT_ENDPOINT = "sharedGoals.create";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { goalId, groupId } = await req.json().catch(() => ({}));
  if (!goalId) {
    return NextResponse.json({ error: "goalId required" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 20,
    actionLabel: "shared goals created",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data, error } = await supabase
    .from("shared_goals")
    .insert({ goal_id: goalId, owner_id: user.id, group_id: groupId ?? null })
    .select("id, goal_id, group_id, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This goal is already shared" }, { status: 409 });
    }
    log.warn("shared goal create failed", { user_id: user.id, goal_id: goalId, error: error.message });
    return NextResponse.json(
      { error: "Couldn't share that goal — check it's yours and (if a group was given) that you're a member of it" },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true, sharedGoal: data });
}