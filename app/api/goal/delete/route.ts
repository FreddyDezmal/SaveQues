/**
 * app/api/goal/delete/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deletes a savings goal owned by the authenticated user.
 *
 * Tracks the `goal_deleted` analytics event so we can measure
 * abandonment rates by category and goal size.
 *
 * METHOD: DELETE
 * Body:   { goal_id: string }
 *
 * Cascades: all transactions for this goal are cascade-deleted by the
 * FK constraint in the initial schema migration.
 *
 * Hardening sprint additions:
 *  • Structured logging (start/success/failure + duration_ms).
 *  • Request correlation ID threaded into every log line and Sentry event.
 *
 * No rate limiting added — deletion is destructive only to the acting
 * user's own data (ownership-scoped), and the realistic abuse case
 * (someone deleting their own goals repeatedly) has no meaningful blast
 * radius beyond their own account.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";
import { writeAuditLog } from "@/lib/auditLog";

const log = createLogger("goal.delete");

export async function DELETE(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  setSentryUser(user.id);

  let goal_id: string;
  try {
    const body = await req.json();
    goal_id = body.goal_id;
  } catch {
    log.warn("Goal delete rejected — invalid request body", { user_id: user.id, request_id: requestId });
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!goal_id) {
    log.warn("Goal delete rejected — missing goal_id", { user_id: user.id, request_id: requestId });
    return NextResponse.json({ error: "goal_id is required" }, { status: 400 });
  }

  const end = log.time("goal delete", { user_id: user.id, request_id: requestId, goal_id });

  // Fetch goal metadata before deletion (for analytics properties)
  const { data: goal } = await supabase
    .from("savings_goals")
    .select("id, category, target_amount, current_amount, is_complete, user_id")
    .eq("id", goal_id)
    .eq("user_id", user.id)   // RLS: users can only delete their own goals
    .single();

  if (!goal) {
    log.warn("Goal delete rejected — goal not found or not owned", { user_id: user.id, request_id: requestId, goal_id });
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  // Perform deletion — FK cascade removes child transactions
  const { error } = await supabase
    .from("savings_goals")
    .delete()
    .eq("id", goal_id)
    .eq("user_id", user.id);

  if (error) {
    log.error("Goal delete failed", {
      user_id: user.id, request_id: requestId, goal_id, error: error.message, error_code: error.code,
    });
    captureError(error, { route: "DELETE /api/goal/delete", user_id: user.id, request_id: requestId, goal_id });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Immutable audit log — written with the goal's last-known state, since
  // the row itself is gone immediately after this point (same pattern as
  // ACCOUNT_DELETED in app/api/account/route.ts: capture before, write
  // after the delete succeeds, since entity_id here still resolves for
  // historical lookup purposes even though the row is gone).
  await writeAuditLog({
    userId:     user.id,
    eventType:  "GOAL_DELETED",
    entityType: "goal",
    entityId:   goal_id,
    metadata: {
      goal_category:  goal.category,
      target_amount:  goal.target_amount,
      amount_saved:   goal.current_amount,
      was_complete:   goal.is_complete,
    },
    requestId,
  });

  // Track goal_deleted event
  await trackServerEvent(AnalyticsEvents.GOAL_DELETED, user.id, {
    goal_category:    goal.category,
    target_amount:    goal.target_amount,
    amount_saved:     goal.current_amount,
    completion_pct:   goal.target_amount > 0
      ? Math.round((goal.current_amount / goal.target_amount) * 100)
      : 0,
    was_complete:     goal.is_complete,
  });

  end({ user_id: user.id, request_id: requestId, goal_id });

  return NextResponse.json({ ok: true });
}