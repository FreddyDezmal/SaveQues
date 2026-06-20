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
 *
 * Hardening sprint additions:
 *  • Structured logging (start/success/failure + duration_ms).
 *  • Rate limiting: 10 requests per user per rolling 60 minutes.
 *    Uses checkAttemptRateLimit() rather than checkRateLimit() because
 *    complete_daily_quest() is idempotent on (user_id, quest_date) — a
 *    spamming client calling this endpoint repeatedly produces only ONE
 *    daily_quest_logs row regardless of call count, so counting that
 *    table would never detect the spam. checkAttemptRateLimit() instead
 *    counts request attempts via the dedicated rate_limit_attempts table
 *    (migration 026), independent of whether the RPC actually awarded XP.
 *  • Request correlation ID threaded into every log line and Sentry event.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getXPForAction } from "@/lib/xp";
import { checkAndAwardAchievements } from "@/lib/awardXP";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";
import { recordDailyActivity } from "@/lib/recordDailyActivity";
import { getUTCDateString } from "@/lib/dateUtils";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";

const log = createLogger("quest.daily.complete");
const RATE_LIMIT_ENDPOINT = "quest.daily.complete";

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  setSentryUser(user.id);

  const { questId } = await req.json();
  if (!questId) {
    log.warn("Quest complete rejected — missing questId", { user_id: user.id, request_id: requestId });
    return NextResponse.json({ error: "questId required" }, { status: 400 });
  }

  const end = log.time("quest complete", { user_id: user.id, request_id: requestId, quest_id: questId });

  // ── Rate limit: 10 attempts per user per rolling 60 minutes ───────────────
  // See file header — counts request attempts, not successful RPC writes,
  // because the RPC is idempotent and a spamming client won't create
  // multiple rows for us to count.
  const rateLimit = await checkAttemptRateLimit(supabase, {
    userId:        user.id,
    endpoint:      RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests:   10,
    actionLabel:   "quest completion attempts",
  });

  if (!rateLimit.allowed) {
    log.warn("Quest complete rate limited", {
      user_id: user.id, request_id: requestId, quest_id: questId, count: rateLimit.count, limit: rateLimit.limit,
    });
    return NextResponse.json({ error: rateLimit.message }, { status: 429 });
  }

  // Record this attempt regardless of outcome — fire-and-forget, fails open.
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);

  // Compute XP server-side — never trust client-supplied amount
  const { data: profile } = await supabase
    .from("profiles")
    .select("streak_days, daily_quests_completed, weekly_quests_completed")
    .eq("id", user.id)
    .single();

  if (!profile) {
    log.error("Quest complete failed — profile not found", { user_id: user.id, request_id: requestId, quest_id: questId });
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

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
    log.error("complete_daily_quest RPC failed", {
      user_id: user.id, request_id: requestId, quest_id: questId, error: error.message, error_code: error.code,
    });
    captureError(error, { route: "POST /api/quest/daily/complete", user_id: user.id, request_id: requestId, quest_id: questId });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rpcResult = result as { success: boolean; xp_awarded: number; new_total: number; reason?: string };

  // Already completed today — idempotent success
  if (rpcResult.reason === "already_awarded") {
    end({ user_id: user.id, request_id: requestId, quest_id: questId, already_awarded: true });
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

  end({
    user_id: user.id, request_id: requestId, quest_id: questId,
    xp_awarded: rpcResult.xp_awarded, already_awarded: false,
  });

  return NextResponse.json({
    xpGained:        rpcResult.xp_awarded,
    newTotal:        rpcResult.new_total,
    newAchievements,
    alreadyAwarded:  false,
  });
}