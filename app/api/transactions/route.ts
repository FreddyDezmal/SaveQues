/**
 * app/api/transactions/route.ts  — SECURITY HARDENED
 *
 * Changes from original:
 *  1. Goal ownership verified BEFORE the transaction insert.
 *  2. XP awarded via awardSavingXP() / awardGoalCompleteXP() — goes through
 *     the award_xp() Postgres function with idempotency on transaction.id.
 *  3. Achievement XP awarded via award_achievement() RPC — atomic + deduped.
 *  4. Non-atomic three-write race condition eliminated.
 *  5. No direct profiles.xp_total update anywhere in this file.
 *
 * Hardening sprint additions:
 *  6. Structured logging (start/success/failure + duration_ms).
 *  7. Server-side validation: amount upper bound, note length/trim.
 *  8. DB-backed rate limiting: 60 deposits per user per rolling 60 minutes.
 *  9. Request correlation ID threaded into every log line and Sentry event.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getXPForAction } from "@/lib/xp";
import { checkAchievements } from "@/lib/achievements";
import { awardSavingXP, awardGoalCompleteXP } from "@/lib/awardXP";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";
import { recordDailyActivity } from "@/lib/recordDailyActivity";
import { getUTCDateString } from "@/lib/dateUtils";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";
import { checkRateLimit } from "@/lib/rateLimit";

const log = createLogger("transactions.deposit");

// Server-side mirror of the DB CHECK constraint added in
// 025_validation_constraints.sql — fail fast with a clear 400 before
// even touching the database, rather than surfacing a raw Postgres error.
const MAX_AMOUNT  = 10_000_000;
const MAX_NOTE_LEN = 500;

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  setSentryUser(user.id);

  const body = await req.json();
  const { goal_id, amount, note: rawNote } = body;

  // ── Validation ──────────────────────────────────────────────────────────
  if (!goal_id || !amount || amount <= 0) {
    log.warn("Deposit rejected — invalid input", { user_id: user.id, request_id: requestId, goal_id });
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (Number(amount) > MAX_AMOUNT) {
    log.warn("Deposit rejected — amount exceeds maximum", {
      user_id: user.id, request_id: requestId, goal_id, amount,
    });
    return NextResponse.json(
      { error: `Amount cannot exceed ${MAX_AMOUNT.toLocaleString()}.` },
      { status: 400 }
    );
  }

  // Trim and cap note length server-side — belt-and-suspenders ahead of the
  // DB CHECK constraint (025_validation_constraints.sql).
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, MAX_NOTE_LEN) || null : null;

  const end = log.time("deposit", { user_id: user.id, request_id: requestId, goal_id, amount });

  // ── Rate limit: 60 deposits per user per rolling 60 minutes ───────────────
  const rateLimit = await checkRateLimit(supabase, {
    table:         "transactions",
    userId:        user.id,
    windowMinutes: 60,
    maxRequests:   60,
    actionLabel:   "deposits",
  });

  if (!rateLimit.allowed) {
    log.warn("Deposit rate limited", {
      user_id: user.id, request_id: requestId, count: rateLimit.count, limit: rateLimit.limit,
    });
    return NextResponse.json({ error: rateLimit.message }, { status: 429 });
  }

  // ── 1. VERIFY GOAL OWNERSHIP before touching any data ────────
  const { data: goalOwnerCheck } = await supabase
    .from("savings_goals")
    .select("id")
    .eq("id", goal_id)
    .eq("user_id", user.id)
    .single();

  if (!goalOwnerCheck) {
    log.warn("Deposit rejected — goal not found or not owned", {
      user_id: user.id, request_id: requestId, goal_id,
    });
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  // ── 2. INSERT TRANSACTION ─────────────────────────────────────
  // The DB trigger enforce_goal_ownership provides a second layer of defence.
  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .insert({
      user_id:          user.id,
      goal_id,
      amount,
      note,
      transaction_type: "deposit",
    })
    .select()
    .single();

  if (txError) {
    log.error("Deposit insert failed", {
      user_id: user.id, request_id: requestId, goal_id, error: txError.message, error_code: txError.code,
    });
    captureError(txError, { route: "POST /api/transactions", user_id: user.id, request_id: requestId, goal_id });
    return NextResponse.json({ error: txError.message }, { status: 500 });
  }

  // ── 3. FETCH CONTEXT FOR XP + ACHIEVEMENT CHECKS ─────────────
  const today = getUTCDateString();
  const [profileRes, goalRes, allTxRes, todayTxRes, achievementsRes, goalsRes, weeklyRes, chainRes] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("savings_goals").select("*").eq("id", goal_id).single(),
      supabase.from("transactions").select("id, amount").eq("user_id", user.id),
      supabase.from("transactions").select("id").eq("user_id", user.id).gte("created_at", `${today}T00:00:00`),
      supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id),
      supabase.from("savings_goals").select("is_complete, current_amount, target_amount, created_at, completed_at").eq("user_id", user.id),
      supabase.from("user_weekly_quests").select("id").eq("user_id", user.id).eq("status", "completed"),
      supabase.from("quest_chain_progress").select("id").eq("user_id", user.id).eq("status", "completed"),
    ]);

  const profile = profileRes.data;
  const goal    = goalRes.data;
  if (!profile || !goal) {
    log.error("Deposit failed — profile or goal fetch returned null after insert", {
      user_id: user.id, request_id: requestId, goal_id, transaction_id: tx.id,
    });
    return NextResponse.json({ error: "Data error" }, { status: 500 });
  }

  const isGoalComplete = goal.is_complete;
  const earnedIds      = (achievementsRes.data ?? []).map((a: any) => a.achievement_id);
  const allGoals       = goalsRes.data ?? [];
  const allTxs         = allTxRes.data ?? [];
  const todayTxs       = todayTxRes.data ?? [];

  const totalSaved     = allTxs.reduce((sum, t) => sum + Math.max(0, Number(t.amount)), 0);
  const completedGoals = allGoals.filter((g: any) => g.is_complete).length;
  const activeGoals    = allGoals.filter((g: any) => !g.is_complete).length;

  let goalCompletedInDays: number | undefined;
  if (isGoalComplete && goal.completed_at && goal.created_at) {
    const ms = new Date(goal.completed_at).getTime() - new Date(goal.created_at).getTime();
    goalCompletedInDays = Math.max(1, Math.ceil(ms / 86400000));
  }

  let goalExceededByPercent: number | undefined;
  if (isGoalComplete && Number(goal.current_amount) > Number(goal.target_amount)) {
    goalExceededByPercent = ((Number(goal.current_amount) - Number(goal.target_amount)) / Number(goal.target_amount)) * 100;
  }

  let goalTargetDaysAway: number | undefined;
  if (goal.target_date && goal.created_at) {
    goalTargetDaysAway = Math.ceil(
      (new Date(goal.target_date).getTime() - new Date(goal.created_at).getTime()) / 86400000
    );
  }

  const hour              = new Date().getHours();
  const xpForAction       = isGoalComplete
    ? getXPForAction("GOAL_COMPLETE", profile.streak_days)
    : getXPForAction("LOG_SAVING",    profile.streak_days);

  const achievementParams = {
    streakDays:           profile.streak_days,
    totalSaved,
    goalsCompleted:       completedGoals,
    activeGoals,
    challengesCompleted:  weeklyRes.data?.length ?? 0,
    dailyQuestsCompleted: profile.daily_quests_completed ?? 0,
    weeklyQuestsCompleted: profile.weekly_quests_completed ?? 0,
    questChainsCompleted: chainRes.data?.length ?? 0,
    transactionAmount:    amount,
    transactionHour:      hour,
    transactionCount:     todayTxs.length,
    goalCompletedInDays,
    goalExceededByPercent,
    goalTargetDaysAway,
    earnedIds,
  };

  // ── 4. AWARD XP THROUGH CENTRALISED FUNCTION ─────────────────
  // source_id = transaction UUID — guarantees exactly-once per deposit.
  let xpResult;
  if (isGoalComplete) {
    xpResult = await awardGoalCompleteXP({
      userId:           user.id,
      goalId:           goal_id,
      xp:               xpForAction,
      achievementParams,
    });
  } else {
    xpResult = await awardSavingXP({
      userId:        user.id,
      transactionId: tx.id,
      xp:            xpForAction,
      achievementParams,
    });
  }

  if (!xpResult.success) {
    log.error("XP award failed", {
      user_id: user.id, request_id: requestId, goal_id, transaction_id: tx.id, error: xpResult.error,
    });
    captureError(new Error(xpResult.error ?? "XP award failed"), {
      route: "POST /api/transactions", user_id: user.id, request_id: requestId, goal_id, transaction_id: tx.id,
    });
    return NextResponse.json({ error: xpResult.error ?? "XP award failed" }, { status: 500 });
  }

  // ── 5. ANALYTICS ─────────────────────────────────────────────
  const isDeposit = Number(amount) > 0;
  const eventName = isDeposit ? AnalyticsEvents.DEPOSIT_MADE : AnalyticsEvents.WITHDRAWAL_MADE;

  await trackServerEvent(eventName, user.id, {
    amount:        Math.abs(Number(amount)),
    goal_id:       goal_id,
    goal_category: goal?.category ?? "unknown",
  });

  // Track first deposit activation milestone
  if (isDeposit && allTxs.filter((t: any) => Number(t.amount) > 0).length === 1) {
    await trackServerEvent(AnalyticsEvents.FIRST_DEPOSIT, user.id, {
      goal_category: goal?.category ?? "unknown",
    });
  }

  // Track XP awarded
  if (!xpResult.alreadyAwarded && xpResult.xpAwarded > 0) {
    await trackServerEvent(AnalyticsEvents.XP_AWARDED, user.id, {
      amount:      xpResult.xpAwarded,
      source_type: isGoalComplete ? "goal_complete" : "log_saving",
    });
  }

  // Track goal completed
  if (isGoalComplete && !xpResult.alreadyAwarded) {
    await trackServerEvent(AnalyticsEvents.GOAL_COMPLETED, user.id, {
      goal_category:  goal?.category ?? "unknown",
      target_amount:  goal?.target_amount ?? 0,
    });
  }

  // Track newly unlocked achievements
  for (const achievement of xpResult.newAchievements) {
    await trackServerEvent(AnalyticsEvents.ACHIEVEMENT_UNLOCKED, user.id, {
      achievement_id: achievement.id,
      xp_reward:      achievement.xpReward,
    });
  }

  // Track first achievement activation milestone
  const prevAchievementCount = earnedIds.length;
  if (xpResult.newAchievements.length > 0 && prevAchievementCount === 0) {
    await trackServerEvent(AnalyticsEvents.FIRST_ACHIEVEMENT, user.id, {
      achievement_id: xpResult.newAchievements[0].id,
    });
  }

  // ── 6. RETENTION RECORDING ────────────────────────────────────
  await recordDailyActivity(supabase, user.id, {
    app_opened:    true,
    deposit_delta: isDeposit ? 1 : 0,
    xp_delta:      xpResult.xpAwarded,
  });

  end({
    user_id: user.id, request_id: requestId, goal_id, transaction_id: tx.id,
    xp_awarded: xpResult.xpAwarded, is_goal_complete: isGoalComplete,
  });

  return NextResponse.json({
    xpGained:        xpResult.xpAwarded,
    newXP:           xpResult.newTotal,
    newAchievements: xpResult.newAchievements,
    isGoalComplete,
  });
}