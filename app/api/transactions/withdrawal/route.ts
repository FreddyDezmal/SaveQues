/**
 * app/api/transactions/withdrawal/route.ts — FINANCIAL INTEGRITY HARDENED (Sprint 10)
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
 *  • Structured logging, server-side validation, rate limiting, request IDs.
 *
 * Sprint 10 — Financial Integrity & Write Consolidation additions:
 *  • REQUIRED idempotency_key, same contract as POST /api/transactions —
 *    a duplicate (user_id, idempotency_key) returns the original
 *    transaction rather than creating a second withdrawal.
 *  • Immutable audit log entry (WITHDRAWAL_CREATED) written after success.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getUTCDateString } from "@/lib/dateUtils";
import { createLogger } from "@/lib/logger";
import { captureError, captureWarning, setSentryUser } from "@/lib/monitoring";
import { checkRateLimit } from "@/lib/rateLimit";
import { writeAuditLog } from "@/lib/auditLog";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";

const log = createLogger("transactions.withdrawal");

const MAX_AMOUNT   = 10_000_000;
const MAX_NOTE_LEN = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  setSentryUser(user.id);

  const body = await req.json();
  const { goal_id, amount, note: rawNote, transaction_type, idempotency_key } = body;

  // ── Idempotency key validation — REQUIRED, same contract as deposits ────
  if (!idempotency_key || typeof idempotency_key !== "string" || !UUID_RE.test(idempotency_key)) {
    log.warn("Withdrawal rejected — missing or invalid idempotency_key", {
      user_id: user.id, request_id: requestId, goal_id,
    });
    return NextResponse.json(
      { error: "idempotency_key is required and must be a valid UUID." },
      { status: 400 }
    );
  }

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

  // ── Idempotency check: has this exact (user, key) pair been seen before? ─
  const { data: existingTx } = await supabase
    .from("transactions")
    .select("id")
    .eq("user_id", user.id)
    .eq("idempotency_key", idempotency_key)
    .maybeSingle();

  if (existingTx) {
    log.info("Withdrawal duplicate detected via idempotency_key — returning original", {
      user_id: user.id, request_id: requestId, goal_id, transaction_id: existingTx.id,
    });

    const { data: goal } = await supabase
      .from("savings_goals")
      .select("current_amount, target_amount, is_complete")
      .eq("id", goal_id)
      .single();

    end({ user_id: user.id, request_id: requestId, goal_id, transaction_id: existingTx.id, duplicate: true });
    return NextResponse.json({ duplicate: true, transaction: { id: existingTx.id }, goal });
  }

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
  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .insert({
      user_id:          user.id,
      goal_id,
      amount,
      note,
      transaction_type,
      idempotency_key,
    })
    .select()
    .single();

  if (txError) {
    // Unique violation on (user_id, idempotency_key) — concurrent retry won the race.
    if (txError.code === "23505") {
      const { data: raceWinner } = await supabase
        .from("transactions")
        .select("id")
        .eq("user_id", user.id)
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();

      const { data: goal } = await supabase
        .from("savings_goals")
        .select("current_amount, target_amount, is_complete")
        .eq("id", goal_id)
        .single();

      log.info("Withdrawal idempotency race detected — returning concurrent winner", {
        user_id: user.id, request_id: requestId, goal_id, transaction_id: raceWinner?.id,
      });
      return NextResponse.json({ duplicate: true, transaction: { id: raceWinner?.id ?? null }, goal });
    }

    log.error("Withdrawal insert failed", {
      user_id: user.id, request_id: requestId, goal_id, error: txError.message, error_code: txError.code,
    });
    captureError(txError, { route: "POST /api/transactions/withdrawal", user_id: user.id, request_id: requestId, goal_id });
    return NextResponse.json({ error: txError.message }, { status: 500 });
  }

  // ── 3. RECORD ACTIVITY FOR DAY MOMENTUM ───────────────────────
  const { error: activityError } = await supabase.rpc("log_activity_event", {
    p_user_id: user.id,
    p_date:    getUTCDateString(),
    p_xp:      0,
    p_actions: 1,
  });

  if (activityError) {
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

  // ── 5. IMMUTABLE AUDIT LOG ─────────────────────────────────────
  await writeAuditLog({
    userId:     user.id,
    eventType:  "WITHDRAWAL_CREATED",
    entityType: "transaction",
    entityId:   tx.id,
    metadata: {
      amount,
      goal_id,
      transaction_type,
      idempotency_key,
    },
    requestId,
  });

  // ── 6. ANALYTICS ─────────────────────────────────────────────
  // Note: deposits' DEPOSIT_MADE event fires in /api/transactions for the
  // deposit path; withdrawals fire their own WITHDRAWAL_MADE event here
  // since this route handles them exclusively.
  await trackServerEvent(AnalyticsEvents.WITHDRAWAL_MADE, user.id, {
    amount,
    goal_id,
    transaction_type,
  });

  end({ user_id: user.id, request_id: requestId, goal_id, transaction_id: tx.id });

  return NextResponse.json({
    duplicate:   false,
    transaction: tx,
    goal,
  });
}