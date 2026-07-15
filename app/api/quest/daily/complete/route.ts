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
import { checkAndAwardAchievements, detectLevelUp } from "@/lib/awardXP";
import { postLevelUpToFeed } from "@/lib/activityFeed";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";
import { recordDailyActivity } from "@/lib/recordDailyActivity";
import { getUTCDateString } from "@/lib/dateUtils";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { withOutcomeTracking } from "@/lib/recordOutcome";
import { deferAnalytics } from "@/lib/deferredAnalytics";
import { checkQuestRequirement, type QuestRequirementType } from "@/lib/questRequirements";

const log = createLogger("quest.daily.complete");
const RATE_LIMIT_ENDPOINT = "quest.daily.complete";

async function handlePOST(req: NextRequest) {
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
    .select("streak_days, daily_quests_completed, weekly_quests_completed, xp_total")
    .eq("id", user.id)
    .single();

  if (!profile) {
    log.error("Quest complete failed — profile not found", { user_id: user.id, request_id: requestId, quest_id: questId });
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const today = getUTCDateString();

  // FIX (admin CRUD audit, migration 038): this route previously never
  // checked that `questId` corresponded to a real, active quest at all —
  // any string awarded the flat "one daily quest today" XP. It also never
  // checked the quest's requirement_type/requirement_value (added in
  // migration 038) before awarding. Both are now enforced server-side.
  //
  // BUG FIX: the original version of this fix discarded the query's
  // `error` and only looked at `data`, so a query *failure* (e.g. this
  // endpoint deployed before migration 038 actually ran against the
  // database, meaning requirement_type/requirement_value don't exist yet)
  // silently looked identical to "quest not found" — a 404 masking a
  // missing migration, breaking every daily quest at once. Now logged and
  // surfaced distinctly as a 500 so it's diagnosable instead of looking
  // like bad quest data.
  const { data: questRow, error: questFetchError } = await supabase
    .from("daily_quests")
    .select("id, is_active, requirement_type, requirement_value")
    .eq("id", questId)
    .single();

  if (questFetchError) {
    log.error("Quest complete failed — daily_quests lookup errored (check migration 038 has been applied)", {
      user_id: user.id, request_id: requestId, quest_id: questId, error: questFetchError.message, code: questFetchError.code,
    });
    return NextResponse.json({ error: "Could not verify quest — please try again shortly" }, { status: 500 });
  }

  if (!questRow || !questRow.is_active) {
    log.warn("Quest complete rejected — unknown or inactive quest", { user_id: user.id, request_id: requestId, quest_id: questId });
    return NextResponse.json({ error: "Quest not found" }, { status: 404 });
  }

  if (questRow.requirement_type !== "none") {
    const { data: todaysTxs } = await supabase
      .from("transactions")
      .select("amount, transaction_type")
      .eq("user_id", user.id)
      .eq("transaction_type", "deposit")
      .gte("created_at", `${today}T00:00:00.000Z`);
    const savedToday = (todaysTxs ?? []).reduce((sum, t) => sum + Math.max(0, Number(t.amount)), 0);

    const check = checkQuestRequirement(
      questRow.requirement_type as QuestRequirementType,
      questRow.requirement_value,
      { streakDays: profile.streak_days, totalSaved: 0 },
      savedToday
    );
    if (!check.met) {
      log.info("Quest complete rejected — requirement not met", {
        user_id: user.id, request_id: requestId, quest_id: questId, reason: check.reason,
      });
      return NextResponse.json({ error: `Requirement not met: ${check.reason}` }, { status: 409 });
    }
  }

  const xp = getXPForAction("DAILY_QUEST_COMPLETE", profile.streak_days);

  // ── Atomic DB function: logs quest + awards XP idempotently ──
  // NOTE (audit finding, unchanged by this fix): complete_daily_quest()'s
  // idempotency key is (user_id, quest_date) — NOT quest_id. Only the
  // first daily quest claimed each day is ever actually paid; a second
  // quest_id claimed the same day returns already_awarded regardless of
  // its own requirement. That's pre-existing "one daily quest reward per
  // day" product behavior, not something introduced here — flagged in
  // docs/ADMIN_CRUD_AUDIT.md as worth a deliberate product decision rather
  // than changed silently in an audit-fix pass.
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

  // ── Analytics (DEFERRED — Sprint 11 Phase 3) ────────────────────
  // Same treatment as the deposit/withdrawal routes — all PostHog calls
  // queued via waitUntil() so they cannot add latency to the quest
  // completion response. recordDailyActivity below stays synchronous
  // (Supabase RPC, not an external call — see lib/deferredAnalytics.ts).
  const levelUpResult = detectLevelUp(profile.xp_total ?? 0, rpcResult.new_total);
  const prevDailyCount = profile.daily_quests_completed ?? 0;
  const prevWeeklyCount = profile.weekly_quests_completed ?? 0;
  const isFirstQuest = prevDailyCount === 0 && prevWeeklyCount === 0;

  deferAnalytics(async () => {
    await trackServerEvent(AnalyticsEvents.DAILY_QUEST_COMPLETED, user.id, {
      quest_id:  questId,
      xp_gained: rpcResult.xp_awarded,
    });

    await trackServerEvent(AnalyticsEvents.XP_AWARDED, user.id, {
      amount:      rpcResult.xp_awarded,
      source_type: "daily_quest",
    });

    if (levelUpResult) {
      await trackServerEvent(AnalyticsEvents.LEVEL_UP, user.id, {
        new_level:      levelUpResult.newLevel,
        previous_level: levelUpResult.previousLevel,
        new_title:      levelUpResult.newTitle,
        source:         "daily_quest",
      });
      // Sprint 22, Phase 8 — see lib/activityFeed.ts for why this is a
      // service-role call from application code rather than a trigger.
      postLevelUpToFeed(user.id, levelUpResult.newLevel, levelUpResult.newTitle).catch((err) => {
        console.error("[quest/daily/complete] Failed to post level_up to feed:", err);
      });
    }

    if (isFirstQuest) {
      await trackServerEvent(AnalyticsEvents.FIRST_QUEST_COMPLETED, user.id, {
        quest_type: "daily",
      });
    }

    for (const achievement of newAchievements) {
      await trackServerEvent(AnalyticsEvents.ACHIEVEMENT_UNLOCKED, user.id, {
        achievement_id: achievement.id,
        xp_reward:      achievement.xpReward,
      });
    }
  }, "quest.daily.complete", { user_id: user.id, request_id: requestId, quest_id: questId });

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

export const POST = withOutcomeTracking("quest.daily.complete", handlePOST);