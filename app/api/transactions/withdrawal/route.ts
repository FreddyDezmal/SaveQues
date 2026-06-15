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
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getUTCDateString } from "@/lib/dateUtils";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { goal_id, amount, note, transaction_type } = body;

  if (!goal_id || !amount || Number(amount) <= 0) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (transaction_type !== "withdrawal" && transaction_type !== "goal_purchase") {
    return NextResponse.json({ error: "Invalid transaction_type" }, { status: 400 });
  }

  // ── 1. VERIFY GOAL OWNERSHIP before touching any data ────────
  const { data: goalOwnerCheck } = await supabase
    .from("savings_goals")
    .select("id")
    .eq("id", goal_id)
    .eq("user_id", user.id)
    .single();

  if (!goalOwnerCheck) {
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
      note:             note ?? null,
      transaction_type,
    })
    .select()
    .single();

  if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });

  // ── 3. RECORD ACTIVITY FOR DAY MOMENTUM ───────────────────────
  // No XP for withdrawals/purchases, but the day still counts as active.
  const { error: activityError } = await supabase.rpc("log_activity_event", {
    p_user_id: user.id,
    p_date:    getUTCDateString(),
    p_xp:      0,
    p_actions: 1,
  });

  if (activityError && process.env.NODE_ENV === "development") {
    console.warn("[transactions/withdrawal] log_activity_event error:", activityError);
  }

  // ── 4. RE-FETCH GOAL FOR UPDATED AMOUNT/STATUS ────────────────
  const { data: goal } = await supabase
    .from("savings_goals")
    .select("current_amount, target_amount, is_complete")
    .eq("id", goal_id)
    .single();

  return NextResponse.json({
    transaction: tx,
    goal,
  });
}
