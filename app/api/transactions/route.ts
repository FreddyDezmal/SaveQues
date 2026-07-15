/**
 * app/api/transactions/route.ts — FINANCIAL INTEGRITY HARDENED (Sprint 10)
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
 *
 * Sprint 10 — Financial Integrity & Write Consolidation additions:
 * 10. REQUIRED idempotency_key — rejects requests with no key (400). A
 *     duplicate (user_id, idempotency_key) pair returns the ORIGINAL
 *     transaction's response unchanged rather than creating a second row
 *     or erroring — this is what makes a retry/double-click SAFE rather
 *     than merely logged.
 * 11. Immutable audit log entry (DEPOSIT_CREATED) written after success,
 *     independent of the PostHog analytics event below.
 * 12. LEVEL_UP analytics event fires when this deposit's XP award crosses
 *     a level threshold (see lib/awardXP.ts detectLevelUp()).
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getXPForAction } from "@/lib/xp";
import { checkAchievements } from "@/lib/achievements";
import { awardSavingXP, awardGoalCompleteXP, detectLevelUp } from "@/lib/awardXP";
import { postLevelUpToFeed } from "@/lib/activityFeed";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";
import { recordDailyActivity } from "@/lib/recordDailyActivity";
import { getUTCDateString } from "@/lib/dateUtils";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";
import { checkRateLimit } from "@/lib/rateLimit";
import { writeAuditLog } from "@/lib/auditLog";
import { withOutcomeTracking } from "@/lib/recordOutcome";
import { deferAnalytics } from "@/lib/deferredAnalytics";

const log = createLogger("transactions.deposit");

const MAX_AMOUNT  = 10_000_000;
const MAX_NOTE_LEN = 500;

// Loose UUID v4-ish check — we don't need to be pedantic about the exact
// RFC4122 version byte, just confident the client sent something
// crypto.randomUUID()-shaped rather than e.g. an empty string or a
// human-typed value that would silently never collide with itself on retry.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handlePOST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  setSentryUser(user.id);

  const body = await req.json();
  const { goal_id, amount, note: rawNote, idempotency_key } = body;

  // ── Idempotency key validation ─────────────────────────────────────────
  // REQUIRED — not optional. A missing key means the client wasn't built
  // to participate in the idempotency contract, which is exactly the
  // condition that lets double-clicks and retries create duplicate
  // financial records. We reject rather than silently proceeding without
  // protection.
  if (!idempotency_key || typeof idempotency_key !== "string" || !UUID_RE.test(idempotency_key)) {
    log.warn("Deposit rejected — missing or invalid idempotency_key", {
      user_id: user.id, request_id: requestId, goal_id,
    });
    return NextResponse.json(
      { error: "idempotency_key is required and must be a valid UUID." },
      { status: 400 }
    );
  }

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

  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, MAX_NOTE_LEN) || null : null;

  const end = log.time("deposit", { user_id: user.id, request_id: requestId, goal_id, amount });

  // ── Idempotency check: has this exact (user, key) pair been seen before? ─
  // Checked BEFORE the rate limit so a retried request never burns a second
  // rate-limit slot for what is, semantically, the same logical deposit.
  const { data: existingTx } = await supabase
    .from("transactions")
    .select("id, amount, goal_id, created_at")
    .eq("user_id", user.id)
    .eq("idempotency_key", idempotency_key)
    .maybeSingle();

  if (existingTx) {
    // This is a duplicate submission (double-click, retry, reconnect).
    // Return success with the ORIGINAL transaction's outcome rather than
    // creating a second row. We do not re-run XP/achievement logic —
    // award_xp() is itself idempotent on transaction.id, so even if we
    // did, it would correctly award 0 XP — but skipping it here avoids
    // unnecessary work and an unnecessary set of duplicate analytics events.
    log.info("Deposit duplicate detected via idempotency_key — returning original", {
      user_id: user.id, request_id: requestId, goal_id, transaction_id: existingTx.id,
    });
    end({ user_id: user.id, request_id: requestId, goal_id, transaction_id: existingTx.id, duplicate: true });
    return NextResponse.json({
      duplicate:       true,
      transactionId:   existingTx.id,
      xpGained:        0,
      newAchievements: [],
    });
  }

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

  // ── 1b. CAPTURE XP-BEFORE for level-up detection ─────────────
  const { data: profileBefore } = await supabase
    .from("profiles")
    .select("xp_total")
    .eq("id", user.id)
    .single();
  const xpBefore = profileBefore?.xp_total ?? 0;

  // ── 2. INSERT TRANSACTION ─────────────────────────────────────
  // The DB trigger enforce_goal_ownership provides a second layer of defence.
  // idempotency_key + UNIQUE(user_id, idempotency_key) (migration 028) is
  // the final backstop against a race: if two near-simultaneous requests
  // with the same key both pass the maybeSingle() check above before
  // either has inserted, the DB unique index rejects the second insert
  // (handled below as error.code === "23505").
  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .insert({
      user_id:          user.id,
      goal_id,
      amount,
      note,
      transaction_type: "deposit",
      idempotency_key,
    })
    .select()
    .single();

  if (txError) {
    // Unique violation on (user_id, idempotency_key) — a concurrent request
    // with the same key won the race. Fetch and return THAT transaction
    // rather than erroring, preserving the same duplicate-safe contract.
    if (txError.code === "23505") {
      const { data: raceWinner } = await supabase
        .from("transactions")
        .select("id")
        .eq("user_id", user.id)
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();

      log.info("Deposit idempotency race detected — returning concurrent winner", {
        user_id: user.id, request_id: requestId, goal_id, transaction_id: raceWinner?.id,
      });
      return NextResponse.json({
        duplicate:       true,
        transactionId:   raceWinner?.id ?? null,
        xpGained:        0,
        newAchievements: [],
      });
    }

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
      goalTitle:        goal.title,
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

  // ── 5. ANALYTICS (DEFERRED — Sprint 11 Phase 3) ─────────────────
  // All PostHog calls below are queued via waitUntil() (lib/deferredAnalytics.ts)
  // to run AFTER the response is sent. Confirmed in Phase 1: each
  // trackServerEvent call is a real external HTTP round-trip (PostHog
  // client construct → flush → teardown, not a buffered local write), so
  // up to 7 of these sequentially in the critical path was directly
  // adding to the user-facing latency of a deposit, and coupling deposit
  // reliability to PostHog's own uptime. None of this affects financial
  // correctness — moved AFTER the financial write (transaction insert)
  // and AFTER the XP award (atomic DB RPC) have both already succeeded.
  //
  // The audit log write (section 6) and recordDailyActivity (section 7)
  // below remain SYNCHRONOUS and UNCHANGED — both are Supabase/PostgREST
  // calls, not external HTTP calls, and audit_logs is the application's
  // financial source of truth (see lib/deferredAnalytics.ts header for
  // the full reasoning on why these are not the same category of cost).
  const isDeposit = Number(amount) > 0;
  const eventName = isDeposit ? AnalyticsEvents.DEPOSIT_MADE : AnalyticsEvents.WITHDRAWAL_MADE;
  const isFirstDeposit = isDeposit && allTxs.filter((t: any) => Number(t.amount) > 0).length === 1;
  const levelUpResult = !xpResult.alreadyAwarded ? detectLevelUp(xpBefore, xpResult.newTotal) : null;
  const prevAchievementCount = earnedIds.length;

  deferAnalytics(async () => {
    await trackServerEvent(eventName, user.id, {
      amount:        Math.abs(Number(amount)),
      goal_id:       goal_id,
      goal_category: goal?.category ?? "unknown",
    });

    if (isFirstDeposit) {
      await trackServerEvent(AnalyticsEvents.FIRST_DEPOSIT, user.id, {
        goal_category: goal?.category ?? "unknown",
      });
    }

    if (!xpResult.alreadyAwarded && xpResult.xpAwarded > 0) {
      await trackServerEvent(AnalyticsEvents.XP_AWARDED, user.id, {
        amount:      xpResult.xpAwarded,
        source_type: isGoalComplete ? "goal_complete" : "log_saving",
      });
    }

    if (levelUpResult) {
      await trackServerEvent(AnalyticsEvents.LEVEL_UP, user.id, {
        new_level:      levelUpResult.newLevel,
        previous_level: levelUpResult.previousLevel,
        new_title:      levelUpResult.newTitle,
        source:         isGoalComplete ? "goal_complete" : "log_saving",
      });
      // Sprint 22, Phase 8: post to the activity feed too. Same
      // fire-and-forget deferred-analytics context this already runs in
      // — a failed feed post should never affect the deposit response,
      // which has already been sent by this point.
      postLevelUpToFeed(user.id, levelUpResult.newLevel, levelUpResult.newTitle).catch((err) => {
        console.error("[transactions] Failed to post level_up to feed:", err);
      });
    }

    if (isGoalComplete && !xpResult.alreadyAwarded) {
      await trackServerEvent(AnalyticsEvents.GOAL_COMPLETED, user.id, {
        goal_category:  goal?.category ?? "unknown",
        target_amount:  goal?.target_amount ?? 0,
      });
    }

    for (const achievement of xpResult.newAchievements) {
      await trackServerEvent(AnalyticsEvents.ACHIEVEMENT_UNLOCKED, user.id, {
        achievement_id: achievement.id,
        xp_reward:      achievement.xpReward,
      });
    }

    if (xpResult.newAchievements.length > 0 && prevAchievementCount === 0) {
      await trackServerEvent(AnalyticsEvents.FIRST_ACHIEVEMENT, user.id, {
        achievement_id: xpResult.newAchievements[0].id,
      });
    }
  }, "transactions.deposit", { user_id: user.id, request_id: requestId, transaction_id: tx.id });

  // ── 6. IMMUTABLE AUDIT LOG (SYNCHRONOUS — unchanged from prior sprint) ──
  // Stays in the critical path. This is the permanent financial record,
  // not a product-analytics signal (see lib/auditLog.ts header) and is
  // explicitly NOT deferred — see lib/deferredAnalytics.ts header for why
  // this is the correct, deliberate distinction Phase 1 made.
  await writeAuditLog({
    userId:     user.id,
    eventType:  "DEPOSIT_CREATED",
    entityType: "transaction",
    entityId:   tx.id,
    metadata: {
      amount,
      goal_id,
      idempotency_key,
      is_goal_complete: isGoalComplete,
    },
    requestId,
  });

  // ── 7. RETENTION RECORDING (SYNCHRONOUS — unchanged) ─────────────
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
    duplicate:       false,
    transactionId:   tx.id,
    xpGained:        xpResult.xpAwarded,
    newXP:           xpResult.newTotal,
    newAchievements: xpResult.newAchievements,
    isGoalComplete,
  });
}

// Sprint 11 — Phase 4: wraps the handler above so every outcome (success
// or failure, across all 12 return points in this file) is recorded to
// request_outcomes exactly once, without touching the handler's existing
// control flow or adding latency to the response. See lib/recordOutcome.ts.
export const POST = withOutcomeTracking("transactions.deposit", handlePOST);