/**
 * app/api/shared-goals/contribute/route.ts
 *
 * Logs a tracked contribution — NOT a real deposit. This never touches
 * savings_goals.current_amount or the transactions table; it writes only
 * to group_contributions, the separate ledger from 045. See that
 * migration's file header for the full reasoning: the existing
 * enforce_goal_ownership trigger requires transactions.user_id =
 * savings_goals.user_id, so a contributor's money literally cannot land
 * in transactions without weakening a trigger the money system depends
 * on. The response makes this explicit (tracked: true) so the client
 * can't accidentally present it as a real balance change.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("sharedGoals.contribute");
const RATE_LIMIT_ENDPOINT = "sharedGoals.contribute";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { sharedGoalId } = body;
  const amount = typeof body.amount === "number" ? body.amount : parseFloat(body.amount);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null;

  if (!sharedGoalId) {
    return NextResponse.json({ error: "sharedGoalId required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (amount > 1_000_000) {
    return NextResponse.json({ error: "That amount looks off — try again" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 20,
    actionLabel: "contributions logged",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  // Sprint 31 — Phase 9: record the currency this contribution was
  // actually made in (defaults to the column's own 'ZAR' default if this
  // lookup somehow comes back empty — matches every other currency_code
  // fallback in this codebase, never silently guesses a DIFFERENT
  // currency than "unknown").
  const { data: contributorProfile } = await supabase
    .from("profiles")
    .select("currency_code")
    .eq("id", user.id)
    .single();

  const { data, error } = await supabase
    .from("group_contributions")
    .insert({
      shared_goal_id: sharedGoalId,
      user_id: user.id,
      amount: Math.round(amount * 100) / 100,
      currency_code: contributorProfile?.currency_code ?? "ZAR",
      note,
    })
    .select("id, amount, currency_code, note, created_at")
    .single();

  if (error) {
    log.warn("contribution insert failed", { user_id: user.id, shared_goal_id: sharedGoalId, error: error.message });
    return NextResponse.json(
      { error: "Couldn't log that — you may not be an active contributor on this goal" },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true, tracked: true, contribution: data });
}