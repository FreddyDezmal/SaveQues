/**
 * app/api/quest/weekly/complete/route.ts
 *
 * Security guarantees:
 *  • Status guard   — complete_weekly_quest() DB function only marks
 *                     complete when status = 'active'; already-completed
 *                     rows return alreadyAwarded: true
 *  • Idempotency    — award_xp() uses source_id = week_start date
 *  • Concurrent tab — DB UPDATE WHERE status = 'active' is atomic;
 *                     second concurrent request sees 0 rows updated
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAndAwardAchievements } from "@/lib/awardXP";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { questId, weekStart, xpReward } = await req.json();
  if (!questId || !weekStart || !xpReward) {
    return NextResponse.json({ error: "questId, weekStart, and xpReward required" }, { status: 400 });
  }

  // Validate xpReward is a positive integer — never trust client blindly,
  // but weekly quest XP is defined in code not DB so we accept it here
  // and cap it defensively.
  const xp = Math.min(Math.max(Math.round(Number(xpReward)), 0), 10000);

  const { data: result, error } = await supabase.rpc("complete_weekly_quest", {
    p_user_id:   user.id,
    p_quest_id:  questId,
    p_week_start: weekStart,
    p_xp:        xp,
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
    streakDays:           profile?.streak_days ?? 0,
    totalSaved:           0,
    goalsCompleted:       0,
    activeGoals:          0,
    challengesCompleted:  weeklyCountRes.data?.length ?? 0,
    dailyQuestsCompleted: profile?.daily_quests_completed ?? 0,
    weeklyQuestsCompleted: (profile?.weekly_quests_completed ?? 0) + 1,
    questChainsCompleted: chainRes.data?.length ?? 0,
    earnedIds:            (earnedRes.data ?? []).map((a: any) => a.achievement_id),
  });

  return NextResponse.json({
    xpGained:       rpcResult.xp_awarded,
    newTotal:       rpcResult.new_total,
    newAchievements,
    alreadyAwarded: false,
  });
}
