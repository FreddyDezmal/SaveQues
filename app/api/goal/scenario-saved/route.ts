/**
 * app/api/goal/scenario-saved/route.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 30 — Phase 3: Scenario Simulator Upgrade — "multiple saved
 * scenarios," the one genuinely new premium feature this phase adds
 * (everything else in this phase enforces a pre-existing seeded limit or
 * reuses the comparison view Sprint 28.5 already built).
 *
 * Stores the scenario INPUT (type/amount/interval), not a frozen result —
 * see supabase/migrations/070_scenario_simulator_premium.sql's comment on
 * why: re-simulating against current transactions on every read keeps a
 * saved scenario from ever showing a stale number, and it means this
 * route never duplicates lib/scenarioSimulator.ts's arithmetic.
 *
 * saved_scenarios_limit is a live-row-count feature (free: 1, premium:
 * unlimited) — same lifetime-limit shape as goals_limit, so POST counts
 * current rows via getFeatureLimit() exactly the way
 * app/api/goals/route.ts already does, rather than usage_counters.
 *
 * METHODS:
 *   GET    ?goal_id=<uuid>            — list this user's saved scenarios for a goal
 *   POST   { goal_id, scenario_type, amount?, interval_days?, label }
 *   DELETE ?id=<uuid>                 — delete one saved scenario (own rows only; RLS + explicit filter)
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getFeatureLimit } from "@/lib/billing/entitlements";
import { BillingAnalyticsEvents } from "@/lib/billing/analytics";
import { trackServerEvent } from "@/lib/analytics-server";
import { createLogger } from "@/lib/logger";

const log = createLogger("goal.scenario-saved");
const SCENARIO_TYPES = new Set(["weekly_delta", "skip_payment", "cadence_change", "lump_sum"]);

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const goalId = req.nextUrl.searchParams.get("goal_id");
  if (!goalId) return NextResponse.json({ error: "goal_id is required" }, { status: 422 });

  const { data, error } = await supabase
    .from("saved_scenarios")
    .select("id, goal_id, scenario_type, amount, interval_days, label, created_at")
    .eq("user_id", user.id)
    .eq("goal_id", goalId)
    .order("created_at", { ascending: true });

  if (error) {
    log.error("scenario-saved list failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Couldn't load saved scenarios right now." }, { status: 500 });
  }

  return NextResponse.json({ scenarios: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { goal_id, scenario_type, amount, interval_days, label } = body ?? {};

  if (!goal_id || typeof goal_id !== "string") {
    return NextResponse.json({ error: "goal_id is required" }, { status: 422 });
  }
  if (!SCENARIO_TYPES.has(scenario_type)) {
    return NextResponse.json({ error: "Invalid scenario_type" }, { status: 422 });
  }
  if (!label || typeof label !== "string" || label.length > 200) {
    return NextResponse.json({ error: "label is required (max 200 chars)" }, { status: 422 });
  }

  // Own-goal check — belt and braces alongside RLS, same pattern as
  // app/api/goal/edit and app/api/export/transactions.
  const { data: goal, error: goalError } = await supabase
    .from("savings_goals")
    .select("id")
    .eq("id", goal_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (goalError || !goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  // ── Premium entitlement: saved_scenarios_limit ─────────────────────────
  // Same lifetime-count pattern as app/api/goals/route.ts's goals_limit
  // check — a saved scenario can be deleted (freeing a slot), so this
  // counts live rows rather than an append-only usage counter.
  const savedLimit = await getFeatureLimit(user.id, "saved_scenarios_limit");
  if (savedLimit !== null) {
    const { count, error: countError } = await supabase
      .from("saved_scenarios")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("goal_id", goal_id);

    if (!countError && (count ?? 0) >= savedLimit) {
      await trackServerEvent(BillingAnalyticsEvents.USAGE_LIMIT_REACHED, user.id, {
        feature_key: "saved_scenarios_limit",
        limit: savedLimit,
      });
      return NextResponse.json(
        {
          error: `You've reached the Free plan's limit of ${savedLimit} saved scenario${savedLimit === 1 ? "" : "s"} per goal. Upgrade to Premium to save more.`,
          code: "PLAN_LIMIT_REACHED",
          feature_key: "saved_scenarios_limit",
          limit: savedLimit,
          used: count ?? savedLimit,
        },
        { status: 403 }
      );
    }
    // countError swallowed deliberately — same fail-open reasoning as
    // app/api/goals/route.ts's own goals_limit count query.
  }

  const { data: inserted, error: insertError } = await supabase
    .from("saved_scenarios")
    .insert({
      user_id: user.id,
      goal_id,
      scenario_type,
      amount: amount ?? null,
      interval_days: interval_days ?? null,
      label,
    })
    .select("id, goal_id, scenario_type, amount, interval_days, label, created_at")
    .single();

  if (insertError || !inserted) {
    log.error("scenario-saved insert failed", { user_id: user.id, error: insertError?.message });
    return NextResponse.json({ error: "Couldn't save that scenario right now." }, { status: 500 });
  }

  return NextResponse.json({ scenario: inserted }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 422 });

  const { error } = await supabase
    .from("saved_scenarios")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    log.error("scenario-saved delete failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Couldn't delete that scenario right now." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
