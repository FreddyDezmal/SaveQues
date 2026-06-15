/**
 * app/api/quest/daily/complete/route.ts
 *
 * Replaces the client-side direct Supabase write in QuestsClient.tsx.
 *
 * Security guarantees:
 *  • Auth required — server reads session via createClient()
 *  • Idempotency   — complete_daily_quest() DB function uses award_xp()
 *                    with source_id = YYYY-MM-DD; second call returns
 *                    alreadyAwarded: true, xpAwarded: 0
 *  • No client XP  — xp amount computed server-side from streak_days
 *  • Achievement   — checked + awarded atomically via award_achievement()
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getXPForAction } from "@/lib/xp";
import { checkAndAwardAchievements } from "@/lib/awardXP";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";
import { recordDailyActivity } from "@/lib/recordDailyActivity";
import { getUTCDateString } from "@/lib/dateUtils";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { questId } = await req.json();
  if (!questId) return NextResponse.json({ error: "questId required" }, { status: 400 });

  // Compute XP server-side — never trust client-supplied amount
  const { data: profile } = await supabase
    .from("profiles")
    .select("streak_days, daily_quests_completed, weekly_quests_completed")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const today = getUTCDateString();
  const xp    = getXPForAction("DAILY_QUEST_COMPLETE", profile.streak_days);

  // ── Atomic DB function: logs quest + awards XP idempotently ──
  const { data: result, error } = await supabase.rpc("complete_daily_quest", {
    p_user_id:   user.id,
    p_quest_id:  questId,
    p_quest_date: today,
    p_xp:        xp,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rpcResult = result as { success: boolean; xp_awarded: number; new_total: number; reason?: string };

  // Already completed today — idempotent success
  if (rpcResult.reason === "already_awarded") {
    return NextResponse.json({ xpGained: 0, alreadyAwarded: true, newAchievements: [] });
  }

  // ── Check and award achievements ──────────────────────────────
  const [weeklyRes, chainRes, earnedRes] = await Promise.all([
    supabase.from("user_weekly_quests").select("id").eq("user_id", user.id).eq("status", "completed"),
    supabase.from("quest_chain_progress").select("id").eq("user_id", user.id).eq("status", "completed"),
    supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id),
  ]);

  const newAchievements = await checkAndAwardAchievements(user.id, {
    streakDays:           profile.streak_days,
    totalSaved:           0,
    goalsCompleted:       0,
    activeGoals:          0,
    challengesCompleted:  weeklyRes.data?.length ?? 0,
    dailyQuestsCompleted: (profile.daily_quests_completed ?? 0) + 1,
    weeklyQuestsCompleted: profile.weekly_quests_completed ?? 0,
    questChainsCompleted: chainRes.data?.length ?? 0,
    earnedIds:            (earnedRes.data ?? []).map((a: any) => a.achievement_id),
  });

  // ── Analytics ─────────────────────────────────────────────────
  await trackServerEvent(AnalyticsEvents.DAILY_QUEST_COMPLETED, user.id, {
    quest_id:  questId,
    xp_gained: rpcResult.xp_awarded,
  });

  await trackServerEvent(AnalyticsEvents.XP_AWARDED, user.id, {
    amount:      rpcResult.xp_awarded,
    source_type: "daily_quest",
  });

  // First quest completed activation milestone
  const prevDailyCount = profile.daily_quests_completed ?? 0;
  const prevWeeklyCount = profile.weekly_quests_completed ?? 0;
  if (prevDailyCount === 0 && prevWeeklyCount === 0) {
    await trackServerEvent(AnalyticsEvents.FIRST_QUEST_COMPLETED, user.id, {
      quest_type: "daily",
    });
  }

  // Newly unlocked achievements
  for (const achievement of newAchievements) {
    await trackServerEvent(AnalyticsEvents.ACHIEVEMENT_UNLOCKED, user.id, {
      achievement_id: achievement.id,
      xp_reward:      achievement.xpReward,
    });
  }

  await recordDailyActivity(supabase, user.id, {
    app_opened:   true,
    xp_delta:     rpcResult.xp_awarded,
    quest_delta:  1,
  });

  return NextResponse.json({
    xpGained:        rpcResult.xp_awarded,
    newTotal:        rpcResult.new_total,
    newAchievements,
    alreadyAwarded:  false,
  });
}
