/**
 * app/api/goals/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/goals — Sprint 10, Part 2: Goal Creation API Route
 *
 * Replaces the client-direct `supabase.from("savings_goals").insert(...)`
 * call previously in app/(app)/goals/new/page.tsx. This was the last
 * unconsolidated write path for goal creation — goal editing and deletion
 * already went through server routes (PATCH /api/goal/edit,
 * DELETE /api/goal/delete); this brings creation in line with the same
 * pattern.
 *
 * Why this matters even though DB constraints (migration 025) already
 * backstop the data: a server route gives us a single point to attach
 * structured logging, request correlation IDs, Sentry capture, rate
 * limiting headroom, and — new in this sprint — an immutable audit log
 * entry. The DB constraints remain in place as defence-in-depth; this
 * route is the primary enforcement layer going forward.
 *
 * Validation (mirrors DB constraints in 025_validation_constraints.sql):
 *  • title: required, 1-80 characters
 *  • category: must be one of the 12 GOAL_CATEGORIES ids
 *  • goal_emoji: must be one of the 30 GOAL_EMOJIS (allowlist — stricter
 *    than the DB's length-only check, matching the same allowlist already
 *    enforced in PATCH /api/goal/edit for consistency)
 *  • target_amount: > 0, <= 10,000,000 (matches transactions' ceiling —
 *    no goal should have a target larger than the maximum single deposit
 *    times a reasonable number of deposits; this is a sanity ceiling, not
 *    a precise business rule)
 *  • target_date: optional, must be a valid date string if provided
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";
import { writeAuditLog } from "@/lib/auditLog";
import { GOAL_CATEGORIES, GOAL_EMOJIS } from "@/lib/utils";

const log = createLogger("goals.create");

const MAX_TITLE_LEN = 80;
const MAX_TARGET_AMOUNT = 10_000_000;
const VALID_CATEGORY_IDS = GOAL_CATEGORIES.map(c => c.id);

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  setSentryUser(user.id);

  let body: {
    title?: string;
    category?: string;
    goal_emoji?: string;
    target_amount?: number;
    target_date?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { title, category, goal_emoji, target_amount, target_date } = body;

  // ── Validation ────────────────────────────────────────────────────────────
  const validationErrors: string[] = [];

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    validationErrors.push("title is required");
  } else if (title.trim().length > MAX_TITLE_LEN) {
    validationErrors.push(`title cannot exceed ${MAX_TITLE_LEN} characters`);
  }

  if (!category || !VALID_CATEGORY_IDS.includes(category as any)) {
    validationErrors.push(`category must be one of: ${VALID_CATEGORY_IDS.join(", ")}`);
  }

  if (!goal_emoji || !GOAL_EMOJIS.includes(goal_emoji as typeof GOAL_EMOJIS[number])) {
    validationErrors.push("goal_emoji must be one of the supported emoji options");
  }

  if (typeof target_amount !== "number" || target_amount <= 0) {
    validationErrors.push("target_amount must be greater than 0");
  } else if (target_amount > MAX_TARGET_AMOUNT) {
    validationErrors.push(`target_amount cannot exceed ${MAX_TARGET_AMOUNT.toLocaleString()}`);
  }

  if (target_date !== undefined && target_date !== null && target_date !== "") {
    const parsed = new Date(target_date);
    if (isNaN(parsed.getTime())) {
      validationErrors.push("target_date must be a valid date");
    }
  }

  if (validationErrors.length > 0) {
    log.warn("Goal creation rejected — validation failed", {
      user_id: user.id, request_id: requestId, errors: validationErrors.join("; "),
    });
    return NextResponse.json({ error: validationErrors.join("; ") }, { status: 422 });
  }

  const end = log.time("goal creation", { user_id: user.id, request_id: requestId, category });

  // ── Insert ───────────────────────────────────────────────────────────────
  const { data: goal, error: insertError } = await supabase
    .from("savings_goals")
    .insert({
      user_id:        user.id,
      title:          title!.trim(),
      category,
      goal_emoji,
      target_amount,
      current_amount: 0,
      target_date:    target_date || null,
      is_complete:    false,
    })
    .select()
    .single();

  if (insertError) {
    log.error("Goal creation insert failed", {
      user_id: user.id, request_id: requestId, error: insertError.message, error_code: insertError.code,
    });
    captureError(insertError, { route: "POST /api/goals", user_id: user.id, request_id: requestId });
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // ── First-goal activation milestone check ───────────────────────────────
  const { data: existingGoals } = await supabase
    .from("savings_goals")
    .select("id")
    .eq("user_id", user.id);
  const isFirstGoal = (existingGoals?.length ?? 0) <= 1;

  // ── Analytics ────────────────────────────────────────────────────────────
  await trackServerEvent(AnalyticsEvents.GOAL_CREATED, user.id, {
    goal_category: category,
    target_amount,
    source:        "manual",
  });

  if (isFirstGoal) {
    await trackServerEvent(AnalyticsEvents.FIRST_GOAL_CREATED, user.id, {
      goal_category: category,
      target_amount,
    });
  }

  // ── Immutable audit log ──────────────────────────────────────────────────
  await writeAuditLog({
    userId:     user.id,
    eventType:  "GOAL_CREATED",
    entityType: "goal",
    entityId:   goal.id,
    metadata: {
      title:         goal.title,
      category,
      target_amount,
      source:        "manual",
    },
    requestId,
  });

  end({ user_id: user.id, request_id: requestId, goal_id: goal.id, category });

  return NextResponse.json({ goal });
}