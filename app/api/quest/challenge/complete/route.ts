/**
 * app/api/quest/challenge/complete/route.ts
 *
 * Marks a seasonal challenge as complete for the authenticated user.
 *
 * Fix: The original route expected { questId, weekStart } and called
 * complete_weekly_quest() — the wrong RPC for seasonal challenges which
 * use the user_challenges table, not user_weekly_quests. The client
 * correctly sends { userChallengeId } (the user_challenges.id).
 *
 * Security guarantees:
 *  • Auth required     — session verified via createClient()
 *  • Ownership guard   — user_challenges row fetched with .eq("user_id", user.id)
 *  • XP integrity      — xp_reward loaded server-side from challenges table
 *  • Status guard      — only 'active' rows are completed; already-completed
 *                        rows return alreadyAwarded: true
 *  • Idempotency       — award_xp() UNIQUE(user_id, source_type, source_id)
 *                        prevents double XP on retry
 */

import { createClient }              from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAndAwardAchievements } from "@/lib/awardXP";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";
import { recordDailyActivity }       from "@/lib/recordDailyActivity";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userChallengeId } = await req.json();
  if (!userChallengeId) {
    return NextResponse.json({ error: "userChallengeId is required" }, { status: 400 });
  }

  // ── 1. Fetch the user_challenge row (ownership enforced by RLS + .eq) ────
  const { data: uc, error: ucError } = await supabase
    .from("user_challenges")
    .select("id, status, challenge_id, challenges(id, xp_reward, title)")
    .eq("id", userChallengeId)
    .eq("user_id", user.id)
    .single();

  if (ucError || !uc) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  // ── 2. Already completed? ─────────────────────────────────────────────────
  if (uc.status === "completed") {
    return NextResponse.json({ xpGained: 0, alreadyAwarded: true, newAchievements: [] });
  }

  if (uc.status !== "active") {
    return NextResponse.json({ error: "Challenge is not active" }, { status: 400 });
  }

  // ── 3. Mark complete ──────────────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from("user_challenges")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", userChallengeId)
    .eq("user_id", user.id)
    .eq("status", "active"); // atomic guard — second concurrent request hits 0 rows

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── 4. Award XP server-side ───────────────────────────────────────────────
  const challenge = uc.challenges as any;
  const xp        = challenge?.xp_reward ?? 0;

  let xpAwarded = 0;
  let newTotal   = 0;

  if (xp > 0) {
    const { data: xpResult } = await supabase.rpc("award_xp", {
      p_user_id:     user.id,
      p_source_type: "challenge",
      p_source_id:   userChallengeId,
      p_xp:          xp,
    });

    const r = xpResult as any;
    if (r?.reason === "already_awarded") {
      return NextResponse.json({ xpGained: 0, alreadyAwarded: true, newAchievements: [] });
    }
    xpAwarded = r?.xp_awarded ?? 0;
    newTotal   = r?.new_total  ?? 0;
  }

  // ── 5. Achievement check ──────────────────────────────────────────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("streak_days, daily_quests_completed, weekly_quests_completed")
    .eq("id", user.id)
    .single();

  const [challengeCountRes, chainRes, earnedRes] = await Promise.all([
    supabase.from("user_challenges").select("id").eq("user_id", user.id).eq("status", "completed"),
    supabase.from("quest_chain_progress").select("id").eq("user_id", user.id).eq("status", "completed"),
    supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id),
  ]);

  const newAchievements = await checkAndAwardAchievements(user.id, {
    streakDays:            profile?.streak_days ?? 0,
    totalSaved:            0,
    goalsCompleted:        0,
    activeGoals:           0,
    challengesCompleted:   challengeCountRes.data?.length ?? 0,
    dailyQuestsCompleted:  profile?.daily_quests_completed ?? 0,
    weeklyQuestsCompleted: profile?.weekly_quests_completed ?? 0,
    questChainsCompleted:  chainRes.data?.length ?? 0,
    earnedIds:             (earnedRes.data ?? []).map((a: any) => a.achievement_id),
  });

  // ── 6. Analytics + activity log ──────────────────────────────────────────
  await trackServerEvent(AnalyticsEvents.SEASONAL_CHALLENGE_COMPLETED, user.id, {
    challenge_id: uc.challenge_id,
    xp_gained:    xpAwarded,
  });

  if (xpAwarded > 0) {
    await trackServerEvent(AnalyticsEvents.XP_AWARDED, user.id, {
      amount:      xpAwarded,
      source_type: "challenge",
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
    xp_delta:    xpAwarded,
    quest_delta: 1,
  });

  return NextResponse.json({
    xpGained:       xpAwarded,
    newTotal,
    newAchievements,
    alreadyAwarded: false,
  });
}