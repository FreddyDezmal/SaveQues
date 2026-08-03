/**
 * app/api/goal/scenario-run/route.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 30 — Phase 3: Scenario Simulator Upgrade.
 *
 * AUDIT NOTE: lib/scenarioSimulator.ts is pure and never touches real
 * data (see that file's own header) — the actual "what if" arithmetic
 * stays entirely client-side in ScenarioSimulatorCard.tsx, exactly as
 * Sprint 28 built it. This route does not run any simulation and never
 * receives scenario inputs or results. Its only job is the piece that
 * was missing per the Phase 1 audit: `scenarios_limit` (free: 3/day,
 * premium: unlimited) was seeded onto both plans in migration 069 but
 * nothing ever called checkUsage()/enforceUsageLimit() for it, so the
 * cap described in the Sprint 28 brief was silently unenforced. The
 * client calls this route once per "run" (opening the What If panel, or
 * submitting a custom scenario) purely to check/record that quota —
 * same enforceUsageLimit()/recordUsage() pair every other gated action
 * in this codebase uses (see app/api/export/transactions/route.ts).
 *
 * METHOD: POST
 * Body:   { goal_id: string }  — used only for logging/ownership check,
 *         not persisted (scenario runs are not saved; see
 *         app/api/goal/scenario-saved for the separate, genuinely
 *         persisted premium feature).
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { enforceUsageLimit, recordUsage } from "@/lib/billing/gate";
import { createLogger } from "@/lib/logger";

const log = createLogger("goal.scenario-run");
const RATE_LIMIT_ENDPOINT = "goal.scenario-run";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let goal_id: string | undefined;
  try {
    const body = await req.json();
    goal_id = body?.goal_id;
  } catch {
    // goal_id is only used for the log line below — an absent/invalid
    // body doesn't block the request, same "fail open on ancillary
    // context" reasoning as the countError swallow in app/api/goals.
  }

  // Anti-abuse rate limit first, same order as every other gated route in
  // this codebase (see app/api/export/transactions/route.ts) — stops
  // scripted hammering of this endpoint distinctly from the plan-based
  // quota below, which stops exceeding what the Free plan includes.
  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 60,
    actionLabel: "scenario simulations",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { blocked } = await enforceUsageLimit(user.id, "scenarios_limit", "daily scenario simulation");
  if (blocked) return blocked;

  await recordUsage(user.id, "scenarios_limit");

  log.info("scenario run recorded", { user_id: user.id, goal_id: goal_id ?? null });

  return NextResponse.json({ ok: true });
}
