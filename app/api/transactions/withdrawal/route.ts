/**
 * app/api/transactions/withdrawal/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 13 P0-B: Added balance validation before insert.
 *
 * Previously the route accepted any positive amount without checking whether
 * current_amount >= amount. The DB trigger (GREATEST(0, current_amount + delta))
 * silently clamped the balance to zero, creating audit records showing a
 * withdrawal larger than the available balance.
 *
 * Fix: added step 1b — fetch current_amount and return HTTP 422 if the
 * requested withdrawal exceeds available balance. The DB-level trigger
 * (migration 034) is the backstop for any code path that bypasses this route.
 */

import { createClient }        from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger }        from "@/lib/logger";
import { captureError }        from "@/lib/monitoring";
import { checkRateLimit }      from "@/lib/rateLimit";
import { writeAuditLog }       from "@/lib/auditLog";
import { recordOutcome }       from "@/lib/recordOutcome";
import { awardXP }             from "@/lib/awardXP";
import { getXPForAction }      from "@/lib/xp";

const log = createLogger("api.transactions.withdrawal");

const MAX_AMOUNT        = 1_000_000;
const RATE_LIMIT_MAX    = 20;
const RATE_LIMIT_WINDOW = 60; // minutes

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { goal_id, amount, note: rawNote, transaction_type, idempotency_key } = body;

  // ── Idempotency key ───────────────────────────────────────────────────────
  if (!idempotency_key) {
    return NextResponse.json({ error: "idempotency_key is required" }, { status: 400 });
  }

  // Check for existing transaction with this idempotency key
  const { data: existing } = await supabase
    .from("transactions")
    .select("id, amount, created_at")
    .eq("user_id", user.id)
    .eq("idempotency_key", idempotency_key)
    .maybeSingle();

  if (existing) {
    log.info("Withdrawal idempotency hit — returning existing transaction", {
      user_id: user.id, request_id: requestId, transaction_id: existing.id,
    });
    return NextResponse.json({ transaction: existing, duplicate: true });
  }

  // ── Basic validation ──────────────────────────────────────────────────────
  if (!goal_id || !amount || Number(amount) <= 0) {
    return NextResponse.json({ error: "goal_id and positive amount are required" }, { status: 400 });
  }

  if (Number(amount) > MAX_AMOUNT) {
    log.warn("Withdrawal rejected — amount exceeds maximum", {
      user_id: user.id, request_id: requestId, goal_id, amount,
    });
    return NextResponse.json({ error: "Amount exceeds maximum allowed withdrawal" }, { status: 400 });
  }

  // ── 1a. Verify goal ownership ─────────────────────────────────────────────
  const { data: goal, error: goalError } = await supabase
    .from("savings_goals")
    .select("id, current_amount, target_amount, is_complete, title")
    .eq("id", goal_id)
    .eq("user_id", user.id)
    .single();

  if (goalError || !goal) {
    log.warn("Withdrawal rejected — goal not found or not owned by user", {
      user_id: user.id, request_id: requestId, goal_id,
    });
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  // ── 1b. Verify sufficient balance (Sprint 13 P0-B fix) ───────────────────
  // Reject withdrawals that would exceed current balance. Previously the
  // DB trigger silently clamped to zero — this creates a clear 422 instead
  // of an audit discrepancy.
  if (Number(amount) > Number(goal.current_amount)) {
    log.warn("Withdrawal rejected — insufficient balance", {
      user_id:   user.id,
      request_id: requestId,
      goal_id,
      requested: amount,
      available: goal.current_amount,
    });
    return NextResponse.json({
      error:     `Insufficient balance. Available: ${goal.current_amount}, requested: ${amount}.`,
      available: goal.current_amount,
    }, { status: 422 });
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const limit = await checkRateLimit(supabase, {
    table:        "transactions",
    userId:       user.id,
    windowMinutes: RATE_LIMIT_WINDOW,
    maxRequests:  RATE_LIMIT_MAX,
    actionLabel:  "withdrawals",
  });

  if (!limit.allowed) {
    await recordOutcome(supabase, "withdrawal", "failure", "rate_limited", user.id, requestId);
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  // ── Insert transaction ────────────────────────────────────────────────────
  const note = rawNote?.trim().slice(0, 200) || null;

  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .insert({
      user_id:          user.id,
      goal_id,
      amount:           Number(amount),
      note,
      transaction_type: transaction_type ?? "withdrawal",
      idempotency_key,
    })
    .select("id, amount, created_at, goal_id, transaction_type")
    .single();

  if (txError) {
    // 23505 = unique_violation (idempotency key race)
    if (txError.code === "23505") {
      const { data: raceTx } = await supabase
        .from("transactions")
        .select("id, amount, created_at")
        .eq("user_id", user.id)
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();
      return NextResponse.json({ transaction: raceTx, duplicate: true });
    }
    // 23514 = check_violation (DB balance trigger — safety net)
    if (txError.code === "23514") {
      log.warn("Withdrawal rejected by DB balance trigger (route check should have caught this)", {
        user_id: user.id, request_id: requestId, goal_id, amount,
      });
      await recordOutcome(supabase, "withdrawal", "failure", "insufficient_balance", user.id, requestId);
      return NextResponse.json({
        error:     `Insufficient balance. Available: ${goal.current_amount}, requested: ${amount}.`,
        available: goal.current_amount,
      }, { status: 422 });
    }

    log.error("Withdrawal insert failed", {
      user_id: user.id, request_id: requestId, error: txError.message, code: txError.code,
    });
    captureError(txError, { route: "POST /api/transactions/withdrawal", user_id: user.id });
    await recordOutcome(supabase, "withdrawal", "failure", "db_error", user.id, requestId);
    return NextResponse.json({ error: "Failed to process withdrawal" }, { status: 500 });
  }

  // ── Award XP ──────────────────────────────────────────────────────────────
  const xp = getXPForAction("WITHDRAWAL");
  if (xp > 0) {
    await awardXP(user.id, "withdrawal", tx.id, xp);
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  await writeAuditLog({
    userId:     user.id,
    eventType:  "WITHDRAWAL_CREATED",
    entityType: "transaction",
    entityId:   tx.id,
    metadata:   { amount, goal_id, transaction_type: transaction_type ?? "withdrawal" },
    requestId,
  });

  await recordOutcome(supabase, "withdrawal", "success", undefined, user.id, requestId);

  log.info("Withdrawal completed", {
    user_id:        user.id,
    request_id:     requestId,
    transaction_id: tx.id,
    amount,
    goal_id,
  });

  return NextResponse.json({ transaction: tx });
}