/**
 * app/api/quest/weekly/complete/route.ts
 *
 * Security guarantees:
 *  • Auth required   — session verified via createClient()
 *  • XP integrity    — xp_reward loaded from `weekly_quests` DB table server-side;
 *                      any client-supplied xpReward is ignored entirely (M3 fix)
 *  • Status guard    — complete_weekly_quest() DB function only marks complete
 *                      when status = 'active'; already-completed rows return
 *                      alreadyAwarded: true
 *  • Idempotency     — award_xp() uses source_id = week_start date
 *  • Concurrent tab  — DB UPDATE WHERE status = 'active' is atomic;
 *                      second concurrent request sees 0 rows updated
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAndAwardAchievements } from "@/lib/awardXP";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";
import { recordDailyActivity } from "@/lib/recordDailyActivity";
import { checkQuestRequirement, type QuestRequirementType } from "@/lib/questRequirements";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // M3 fix: destructure questId and weekStart only — xpReward is intentionally
  // ignored even if the client sends it.
  const { questId, weekStart } = await req.json();
  if (!questId || !weekStart) {
    return NextResponse.json({ error: "questId and weekStart required" }, { status: 400 });
  }

  // M3 fix: load XP reward from the database, never from the client
  const { data: questRecord } = await supabase
    .from("weekly_quests")
    .select("xp_reward, requirement_type, requirement_value")
    .eq("id", questId)
    .eq("is_active", true)
    .single();

  if (!questRecord) {
    return NextResponse.json({ error: "Quest not found" }, { status: 404 });
  }

  // FIX (admin CRUD audit, migration 038): previously nothing checked
  // whether the user actually satisfied the quest's requirement before
  // awarding XP — e.g. a "streak 7 days this week" quest could be
  // completed by clicking it on day one. requirement_type/value are
  // optional (default 'none' = unchanged, self-reported behavior for
  // every quest that hasn't been given a structured requirement).
  if (questRecord.requirement_type && questRecord.requirement_type !== "none") {
    const { data: profileForCheck } = await supabase
      .from("profiles")
      .select("streak_days")
      .eq("id", user.id)
      .single();

    const { data: weekTxs } = await supabase
      .from("transactions")
      .select("amount")
      .eq("user_id", user.id)
      .eq("transaction_type", "deposit")
      .gte("created_at", `${weekStart}T00:00:00.000Z`);
    const savedThisWeek = (weekTxs ?? []).reduce((sum, t) => sum + Math.max(0, Number(t.amount)), 0);

    const check = checkQuestRequirement(
      questRecord.requirement_type as QuestRequirementType,
      questRecord.requirement_value ?? 0,
      { streakDays: profileForCheck?.streak_days ?? 0, totalSaved: 0 },
      savedThisWeek
    );
    if (!check.met) {
      return NextResponse.json({ error: `Requirement not met: ${check.reason}` }, { status: 409 });
    }
  }

  const xp = questRecord.xp_reward;

  const { data: result, error } = await supabase.rpc("complete_weekly_quest", {
    p_user_id:    user.id,
    p_quest_id:   questId,
    p_week_start: weekStart,
    p_xp:         xp,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rpcResult = result as { success: boolean; xp_awarded: number; new_total: number; reason?: string };

  if (rpcResult.reason === "already_awarded") {
    return NextResponse.json({ xpGained: 0, alreadyAwarded: true, newAchievements: [] });
  }

  // Achievement check
  const { data: profile } = await supabase
    .from("profiles")
    .select("streak_days, daily_quests_completed, weekly_quests_completed")
    .eq("id", user.id)
    .single();

  const [weeklyCountRes, chainRes, earnedRes] = await Promise.all([
    supabase.from("user_weekly_quests").select("id").eq("user_id", user.id).eq("status", "completed"),
    supabase.from("quest_chain_progress").select("id").eq("user_id", user.id).eq("status", "completed"),
    supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id),
  ]);

  const newAchievements = await checkAndAwardAchievements(user.id, {
    streakDays:            profile?.streak_days ?? 0,
    totalSaved:            0,
    goalsCompleted:        0,
    activeGoals:           0,
    challengesCompleted:   weeklyCountRes.data?.length ?? 0,
    dailyQuestsCompleted:  profile?.daily_quests_completed ?? 0,
    weeklyQuestsCompleted: (profile?.weekly_quests_completed ?? 0) + 1,
    questChainsCompleted:  chainRes.data?.length ?? 0,
    earnedIds:             (earnedRes.data ?? []).map((a: any) => a.achievement_id),
  });

  await trackServerEvent(AnalyticsEvents.WEEKLY_QUEST_COMPLETED, user.id, {
    quest_id:  questId,
    xp_gained: rpcResult.xp_awarded,
  });

  await trackServerEvent(AnalyticsEvents.XP_AWARDED, user.id, {
    amount:      rpcResult.xp_awarded,
    source_type: "weekly_quest",
  });

  const prevDailyCount  = profile?.daily_quests_completed ?? 0;
  const prevWeeklyCount = profile?.weekly_quests_completed ?? 0;
  if (prevDailyCount === 0 && prevWeeklyCount === 0) {
    await trackServerEvent(AnalyticsEvents.FIRST_QUEST_COMPLETED, user.id, {
      quest_type: "weekly",
    });
  }

  for (const achievement of newAchievements) {
    await trackServerEvent(AnalyticsEvents.ACHIEVEMENT_UNLOCKED, user.id, {
      achievement_id: achievement.id,
      xp_reward:      achievement.xpReward,
    });
  }

  await recordDailyActivity(supabase, user.id, {
    app_opened:  true,
    xp_delta:    rpcResult.xp_awarded,
    quest_delta: 1,
  });

  return NextResponse.json({
    xpGained:       rpcResult.xp_awarded,
    newTotal:       rpcResult.new_total,
    newAchievements,
    alreadyAwarded: false,
  });
}
