/**
 * app/api/goal/purchase-complete/route.ts
 *
 * Awards GOAL_COMPLETE XP when a goal_purchase transaction zeroes out a goal.
 * Called from GoalDetailClient after the transaction has already been inserted
 * (the DB trigger marks is_complete = TRUE on the goal row).
 *
 * Security guarantees:
 *  • Ownership check — verifies goal belongs to this user AND is_complete = TRUE
 *  • Idempotency     — awardGoalCompleteXP() uses award_xp() with
 *                      source_id = goal.id, so replaying this route is safe
 *  • No client XP   — xp amount computed server-side from streak_days
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getXPForAction } from "@/lib/xp";
import { awardGoalCompleteXP } from "@/lib/awardXP";
import { checkAchievements } from "@/lib/achievements";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { goalId } = await req.json();
  if (!goalId) return NextResponse.json({ error: "goalId required" }, { status: 400 });

  // ── 1. Verify goal ownership + completion ─────────────────────
  const { data: goal } = await supabase
    .from("savings_goals")
    // Sprint 18 fix: "title" was missing from this select — Sprint 17
    // added `goalTitle: goal.title` a few lines below (for the
    // milestone_celebration push notification), but never added "title" to
    // this query, so `goal.title` was always `undefined` here. The
    // notification wasn't crashing (undefined is silently falsy), it was
    // just never firing from THIS route — found only now because `tsc`
    // was never run on this codebase until Sprint 18.
    .select("id, title, is_complete, current_amount, target_amount, created_at, completed_at")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .single();

  if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

  if (!goal.is_complete) {
    // Goal not marked complete yet — the DB trigger may still be running.
    // Return 0 XP gracefully rather than erroring; client shows the celebration
    // without a specific XP number in this rare race case.
    return NextResponse.json({ xpGained: 0, alreadyAwarded: false, reason: "goal_not_complete" });
  }

  // ── 2. Build achievement context ──────────────────────────────
  const [profileRes, allGoalsRes, weeklyRes, chainRes, earnedRes] = await Promise.all([
    supabase.from("profiles").select("streak_days, daily_quests_completed, weekly_quests_completed").eq("id", user.id).single(),
    supabase.from("savings_goals").select("is_complete, current_amount, target_amount, created_at, completed_at").eq("user_id", user.id),
    supabase.from("user_weekly_quests").select("id").eq("user_id", user.id).eq("status", "completed"),
    supabase.from("quest_chain_progress").select("id").eq("user_id", user.id).eq("status", "completed"),
    supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id),
  ]);

  const profile      = profileRes.data;
  const allGoals     = allGoalsRes.data ?? [];
  const earnedIds    = (earnedRes.data ?? []).map((a: any) => a.achievement_id);
  const streakDays   = profile?.streak_days ?? 0;

  const completedGoals = allGoals.filter((g: any) => g.is_complete).length;
  const activeGoals    = allGoals.filter((g: any) => !g.is_complete).length;

  let goalCompletedInDays: number | undefined;
  if (goal.completed_at && goal.created_at) {
    const ms = new Date(goal.completed_at).getTime() - new Date(goal.created_at).getTime();
    goalCompletedInDays = Math.max(1, Math.ceil(ms / 86400000));
  }

  // ── 3. Award XP — idempotent via goal.id as source_id ─────────
  const xp = getXPForAction("GOAL_COMPLETE", streakDays);
  const xpResult = await awardGoalCompleteXP({
    userId:    user.id,
    goalId:    goalId,
    goalTitle: goal.title,
    xp,
    achievementParams: {
      streakDays,
      totalSaved:           0,
      goalsCompleted:       completedGoals,
      activeGoals,
      challengesCompleted:  weeklyRes.data?.length ?? 0,
      dailyQuestsCompleted: profile?.daily_quests_completed ?? 0,
      weeklyQuestsCompleted: profile?.weekly_quests_completed ?? 0,
      questChainsCompleted: chainRes.data?.length ?? 0,
      goalCompletedInDays,
      earnedIds,
    },
  });

  if (!xpResult.success) {
    return NextResponse.json({ error: xpResult.error }, { status: 500 });
  }

  return NextResponse.json({
    xpGained:        xpResult.xpAwarded,
    newTotal:        xpResult.newTotal,
    alreadyAwarded:  xpResult.alreadyAwarded,
    newAchievements: xpResult.newAchievements,
  });
}
