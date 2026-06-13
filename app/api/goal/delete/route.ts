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
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";

export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let goal_id: string;
  try {
    const body = await req.json();
    goal_id = body.goal_id;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!goal_id) {
    return NextResponse.json({ error: "goal_id is required" }, { status: 400 });
  }

  // Fetch goal metadata before deletion (for analytics properties)
  const { data: goal } = await supabase
    .from("savings_goals")
    .select("id, category, target_amount, current_amount, is_complete, user_id")
    .eq("id", goal_id)
    .eq("user_id", user.id)   // RLS: users can only delete their own goals
    .single();

  if (!goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  // Perform deletion — FK cascade removes child transactions
  const { error } = await supabase
    .from("savings_goals")
    .delete()
    .eq("id", goal_id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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

  return NextResponse.json({ ok: true });
}