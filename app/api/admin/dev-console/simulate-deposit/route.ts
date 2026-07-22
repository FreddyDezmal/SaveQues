/**
 * app/api/admin/dev-console/simulate-deposit/route.ts
 *
 * Inserts a real deposit transaction for a demo account and awards the
 * same "log_saving" XP a genuine deposit would earn — for QA on
 * deposit-triggered UI (quest completion, streak continuation,
 * momentum, celebrations, goal-completion detection) without needing a
 * real bank flow.
 *
 * REUSE, NOT REIMPLEMENTATION:
 *   - The transaction insert relies on the SAME DB triggers a real
 *     deposit uses: update_goal_amount() (updates current_amount, flips
 *     is_complete) and enforce_transaction_goal_ownership() (rejects a
 *     goal_id that doesn't belong to userId) — both confirmed to have no
 *     auth.uid() dependency, so they behave identically under a
 *     service-role insert as they would for a real user's own deposit.
 *   - XP is awarded via the REAL award_xp() RPC (not a new function,
 *     unlike award-xp/route.ts) — award_xp() only blocks source_type =
 *     'admin_grant'; 'log_saving' is a normal, unblocked source type,
 *     and its per-call ownership check (p_user_id = auth.uid()) is a
 *     no-op under a service-role connection (auth.uid() is NULL there,
 *     same documented pattern this codebase already relies on for
 *     cron/admin RPC calls elsewhere). Calling it via the service
 *     client — NOT lib/awardXP.ts's awardXP(), which uses the
 *     session-scoped client bound to the ADMIN's own auth.uid() and
 *     would fail the ownership check — is what makes this legitimate
 *     reuse rather than a new privileged path like admin_award_xp had
 *     to be.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog } from "@/lib/adminAudit";
import { requireDemoAccount }     from "@/lib/devConsole";
import { getXPForAction }         from "@/lib/xp";

const MAX_AMOUNT = 1_000_000; // sanity ceiling, not a real financial limit

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.dev-console.simulate-deposit");
    const { userId, goalId, amount, note } = await req.json();

    if (typeof amount !== "number" || amount <= 0 || amount > MAX_AMOUNT) {
      return NextResponse.json({ error: `amount must be a number between 0 and ${MAX_AMOUNT}` }, { status: 400 });
    }
    if (!goalId || typeof goalId !== "string") {
      return NextResponse.json({ error: "goalId is required" }, { status: 400 });
    }

    await requireDemoAccount(service, userId);

    // Defense-in-depth ahead of the DB trigger — gives a clear error
    // instead of a raw Postgres exception if the goal doesn't belong to
    // this demo user (or doesn't exist).
    const { data: goal } = await service.from("savings_goals").select("id, user_id, is_complete").eq("id", goalId).maybeSingle();
    if (!goal || goal.user_id !== userId) {
      return NextResponse.json({ error: "That goal does not belong to this demo user." }, { status: 400 });
    }

    const { data: tx, error: txError } = await service
      .from("transactions")
      .insert({ user_id: userId, goal_id: goalId, amount, transaction_type: "deposit", note: note ?? "[Simulated by dev console]" })
      .select()
      .single();
    if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });

    const { data: profile } = await service.from("profiles").select("streak_days").eq("id", userId).maybeSingle();
    const xpAmount = getXPForAction("LOG_SAVING", profile?.streak_days ?? 0);

    const { data: xpResult, error: xpError } = await service.rpc("award_xp", {
      p_user_id: userId,
      p_source_type: "log_saving",
      p_source_id: `dev_console_deposit:${tx.id}`,
      p_xp: xpAmount,
    });
    // XP failure doesn't roll back the transaction — the deposit itself
    // is the thing being tested; if XP awarding hiccups, that's visible
    // in the response rather than silently swallowed OR blocking on it.
    const xpAwarded = !xpError && xpResult?.success;

    await auditLog(service, user.id, "CREATE", "dev_console_action", `simulate_deposit:${tx.id}`,
      null,
      { action: "simulate_deposit", target_user_id: userId, goal_id: goalId, amount, transaction_id: tx.id, xp_awarded: xpAwarded ? xpResult.xp_awarded : 0 }
    );

    return NextResponse.json({
      success: true,
      transaction: tx,
      xpAwarded: xpAwarded ? xpResult.xp_awarded : 0,
      xpError: xpAwarded ? null : (xpError?.message ?? xpResult?.error ?? null),
    });
  } catch (res) { return res as Response; }
}