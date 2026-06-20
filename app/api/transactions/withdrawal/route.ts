/**
 * app/api/transactions/withdrawal/route.ts
 *
 * Handles withdrawal and goal_purchase (non-completing) transactions.
 *
 * Day Momentum fix (root cause #1): previously these transaction types
 * were inserted directly from the browser via GoalDetailClient and never
 * recorded any activity_log entry, so a user who only withdrew money
 * never showed as "active" for that day on the Day Momentum heatmap.
 *
 * This route:
 *  • Verifies goal ownership before inserting (matches /api/transactions).
 *  • Inserts the transaction server-side.
 *  • Records activity_log via log_activity_event() with xp = 0 so the day
 *    counts toward momentum without granting XP for withdrawals.
 *  • Goal-completing purchases (txType = "goal_purchase" and the resulting
 *    amount reaches zero) are NOT handled here — the client continues to
 *    call /api/goal/purchase-complete for the GOAL_COMPLETE XP award,
 *    which (via award_xp) also records activity_log for that case.
 *
 * Hardening sprint additions:
 *  • Structured logging (start/success/failure + duration_ms), replacing
 *    the previous dev-only console.warn — activity log failures are now
 *    visible in production logs and Sentry, not silently dropped.
 *  • Server-side validation: amount upper bound, note length/trim.
 *  • DB-backed rate limiting: 60 withdrawals per user per rolling 60 minutes.
 *  • Request correlation ID threaded into every log line and Sentry event.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getUTCDateString } from "@/lib/dateUtils";
import { createLogger } from "@/lib/logger";
import { captureError, captureWarning, setSentryUser } from "@/lib/monitoring";
import { checkRateLimit } from "@/lib/rateLimit";

const log = createLogger("transactions.withdrawal");

const MAX_AMOUNT   = 10_000_000;
const MAX_NOTE_LEN = 500;

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  setSentryUser(user.id);

  const body = await req.json();
  const { goal_id, amount, note: rawNote, transaction_type } = body;

  // ── Validation ──────────────────────────────────────────────────────────
  if (!goal_id || !amount || Number(amount) <= 0) {
    log.warn("Withdrawal rejected — invalid input", { user_id: user.id, request_id: requestId, goal_id });
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (Number(amount) > MAX_AMOUNT) {
    log.warn("Withdrawal rejected — amount exceeds maximum", {
      user_id: user.id, request_id: requestId, goal_id, amount,
    });
    return NextResponse.json(
      { error: `Amount cannot exceed ${MAX_AMOUNT.toLocaleString()}.` },
      { status: 400 }
    );
  }

  if (transaction_type !== "withdrawal" && transaction_type !== "goal_purchase") {
    log.warn("Withdrawal rejected — invalid transaction_type", {
      user_id: user.id, request_id: requestId, goal_id, transaction_type,
    });
    return NextResponse.json({ error: "Invalid transaction_type" }, { status: 400 });
  }

  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, MAX_NOTE_LEN) || null : null;

  const end = log.time("withdrawal", {
    user_id: user.id, request_id: requestId, goal_id, amount, transaction_type,
  });

  // ── Rate limit: 60 withdrawals per user per rolling 60 minutes ────────────
  const rateLimit = await checkRateLimit(supabase, {
    table:         "transactions",
    userId:        user.id,
    windowMinutes: 60,
    maxRequests:   60,
    actionLabel:   "withdrawals",
  });

  if (!rateLimit.allowed) {
    log.warn("Withdrawal rate limited", {
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
    log.warn("Withdrawal rejected — goal not found or not owned", {
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
      transaction_type,
    })
    .select()
    .single();

  if (txError) {
    log.error("Withdrawal insert failed", {
      user_id: user.id, request_id: requestId, goal_id, error: txError.message, error_code: txError.code,
    });
    captureError(txError, { route: "POST /api/transactions/withdrawal", user_id: user.id, request_id: requestId, goal_id });
    return NextResponse.json({ error: txError.message }, { status: 500 });
  }

  // ── 3. RECORD ACTIVITY FOR DAY MOMENTUM ───────────────────────
  // No XP for withdrawals/purchases, but the day still counts as active.
  const { error: activityError } = await supabase.rpc("log_activity_event", {
    p_user_id: user.id,
    p_date:    getUTCDateString(),
    p_xp:      0,
    p_actions: 1,
  });

  if (activityError) {
    // Previously this was console.warn() gated behind NODE_ENV === "development",
    // which meant it was completely silent in production. It is now logged
    // and reported to Sentry in all environments — the transaction itself
    // still succeeds (this is a non-fatal secondary write), but we need
    // visibility when it fails so Day Momentum data gaps are investigatable.
    log.warn("log_activity_event failed after successful withdrawal insert", {
      user_id: user.id, request_id: requestId, goal_id, transaction_id: tx.id,
      error: activityError.message, error_code: activityError.code,
    });
    captureWarning("log_activity_event failed after withdrawal", {
      route: "POST /api/transactions/withdrawal", user_id: user.id, request_id: requestId,
      goal_id, transaction_id: tx.id,
    });
  }

  // ── 4. RE-FETCH GOAL FOR UPDATED AMOUNT/STATUS ────────────────
  const { data: goal } = await supabase
    .from("savings_goals")
    .select("current_amount, target_amount, is_complete")
    .eq("id", goal_id)
    .single();

  end({ user_id: user.id, request_id: requestId, goal_id, transaction_id: tx.id });

  return NextResponse.json({
    transaction: tx,
    goal,
  });
}