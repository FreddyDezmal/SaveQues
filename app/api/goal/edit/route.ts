/**
 * app/api/goal/edit/route.ts
 *
 * PATCH — Edit an existing savings goal.
 *
 * Follows the same pattern as goal/delete/route.ts —
 * goal_id is read from the request body, not the URL.
 *
 * Allows updating: title, goal_emoji, target_amount.
 *
 * Validation:
 *  • title required and non-empty
 *  • target_amount must be > 0
 *  • target_amount must be >= current_amount
 *  • Goal must be owned by the authenticated user
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";
import { GOAL_EMOJIS } from "@/lib/utils";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";
import { writeAuditLog } from "@/lib/auditLog";

const log = createLogger("goals.edit");

const MAX_TITLE_LEN = 80;

export async function PATCH(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  setSentryUser(user.id);

  let body: { goal_id?: string; title?: string; goal_emoji?: string; target_amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { goal_id, title, goal_emoji, target_amount } = body;

  if (!goal_id) {
    return NextResponse.json({ error: "goal_id is required" }, { status: 400 });
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const validationErrors: string[] = [];
  if (title !== undefined && (!title || title.trim().length === 0)) {
    validationErrors.push("title cannot be empty");
  }
  if (title !== undefined && title.trim().length > MAX_TITLE_LEN) {
    validationErrors.push(`title cannot exceed ${MAX_TITLE_LEN} characters`);
  }
  if (goal_emoji !== undefined && !GOAL_EMOJIS.includes(goal_emoji as typeof GOAL_EMOJIS[number])) {
    validationErrors.push("goal_emoji must be one of the supported emoji options");
  }
  if (target_amount !== undefined && (typeof target_amount !== "number" || target_amount <= 0)) {
    validationErrors.push("target_amount must be greater than 0");
  }
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: validationErrors.join("; ") }, { status: 422 });
  }

  // ── Ownership + current state check ──────────────────────────────────────
  const { data: goal } = await supabase
    .from("savings_goals")
    .select("id, title, goal_emoji, current_amount, target_amount, is_complete")
    .eq("id", goal_id)
    .eq("user_id", user.id)
    .single();

  if (!goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  // Cannot set target below what's already saved
  if (target_amount !== undefined && target_amount < Number(goal.current_amount)) {
    return NextResponse.json({
      error: `target_amount (${target_amount}) cannot be less than the current saved amount (${goal.current_amount}). Withdraw funds first.`,
    }, { status: 422 });
  }

  // ── Build update payload ──────────────────────────────────────────────────
  const updates: Record<string, unknown> = {};
  if (title         !== undefined) updates.title         = title.trim();
  if (goal_emoji    !== undefined) updates.goal_emoji    = goal_emoji;
  if (target_amount !== undefined) {
    updates.target_amount = target_amount;
    // If the new target is now met, mark complete
    if (!goal.is_complete && Number(goal.current_amount) >= target_amount) {
      updates.is_complete  = true;
      updates.completed_at = new Date().toISOString();
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("savings_goals")
    .update(updates)
    .eq("id", goal_id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (updateError) {
    log.error("Goal update failed", {
      user_id:    user.id,
      request_id: requestId,
      goal_id,
      error:      updateError.message,
      error_code: updateError.code,
    });
    captureError(updateError, {
      route:   "PATCH /api/goal/edit",
      user_id: user.id,
      request_id: requestId,
      goal_id,
    });
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── Analytics ────────────────────────────────────────────────────────────
  await trackServerEvent(AnalyticsEvents.GOAL_EDITED, user.id, {
    goal_id,
    fields_changed: Object.keys(updates).join(","),
  });

  // ── Immutable audit log ──────────────────────────────────────────────────
  // before/after snapshot of only the fields that actually changed, not a
  // full row dump — keeps the metadata column focused on what's useful for
  // a support investigation ("what did this user change about this goal").
  await writeAuditLog({
    userId:     user.id,
    eventType:  "GOAL_EDITED",
    entityType: "goal",
    entityId:   goal_id,
    metadata: {
      before: {
        title:         goal.title,
        goal_emoji:    goal.goal_emoji,
        target_amount: goal.target_amount,
      },
      after: updates,
    },
    requestId,
  });

  log.info("Goal updated", {
    user_id: user.id,
    request_id: requestId,
    goal_id,
    fields:  Object.keys(updates).join(", "),
  });

  return NextResponse.json({ goal: updated });
}