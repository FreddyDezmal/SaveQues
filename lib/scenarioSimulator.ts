/**
 * lib/scenarioSimulator.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 28 — Phase 8: Scenario Simulator.
 *
 * AUDIT NOTE: lib/forecast.ts already ships `whatIfWeeklyDelta()` (Sprint
 * 19) — a single-scenario "what if my weekly pace changes by $X" what-if.
 * This file does not re-implement that. It reuses `forecastGoal()` and
 * `whatIfWeeklyDelta()` as the two arithmetic primitives every scenario
 * here is built from, and adds the scenario *shapes* the Sprint 28 brief
 * asks for that weren't expressible with those primitives alone: skipping
 * a single payment, changing deposit cadence, and a one-time lump sum.
 *
 * Design rules (same as forecast.ts, deliberately):
 *   - Pure, deterministic, explainable arithmetic. No ML, no randomness.
 *   - Never mutates real data. Every function takes a goal + transactions
 *     and returns a new result object; nothing is written anywhere. A
 *     caller can run ten scenarios back to back with zero side effects.
 *   - `now` is always a parameter (defaults to `new Date()`) so results
 *     are reproducible in tests.
 *   - Every result carries a plain-language `explanation` and, when a
 *     projection can't be made, an `insufficientDataReason` — same
 *     "never leave a gap silently blank" convention as forecast.ts.
 */

import { forecastGoal, whatIfWeeklyDelta, type GoalForecast } from "@/lib/forecast";
import { getDeposits, getDepositStats, averageDepositIntervalDays } from "@/lib/analyticsEngine";
import { utcDaysBetween } from "@/lib/dateUtils";
import type { SavingsGoal, Transaction } from "@/lib/types";

export type ScenarioType = "weekly_delta" | "skip_payment" | "cadence_change" | "lump_sum";

export interface ScenarioInput {
  type: ScenarioType;
  /**
   * Meaning depends on `type`:
   *   weekly_delta   → $/week to add (negative = reduce pace).
   *   skip_payment   → unused; always simulates skipping the next expected deposit.
   *   cadence_change → new interval in days between deposits (e.g. 14 for biweekly).
   *   lump_sum       → one-time $ amount deposited today, on top of normal pace.
   */
  amount?: number;
  intervalDays?: number;
}

export interface ScenarioResult {
  type: ScenarioType;
  label: string;
  baselineCompletionDate: string | null;
  projectedCompletionDate: string | null;
  /** Positive = scenario delays completion, negative = speeds it up, null = can't compare. */
  deltaDays: number | null;
  explanation: string;
  insufficientDataReason: string | null;
}

function toUTCDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function diffDays(baseline: string | null, projected: string | null): number | null {
  if (!baseline || !projected) return null;
  return utcDaysBetween(new Date(baseline + "T00:00:00Z"), new Date(projected + "T00:00:00Z"));
}

type GoalInput = Pick<SavingsGoal, "id" | "target_amount" | "current_amount" | "target_date" | "is_complete">;

/**
 * "If deposits increase/decrease by $X/week." Thin wrapper over the
 * existing `whatIfWeeklyDelta()` — no new pace math, just packaged as a
 * ScenarioResult alongside the other scenario types.
 */
function simulateWeeklyDelta(baseline: GoalForecast, input: ScenarioInput, now: Date): ScenarioResult {
  const amount = input.amount ?? 0;
  const label = amount >= 0 ? `Deposit $${amount}/week more` : `Deposit $${Math.abs(amount)}/week less`;

  if (baseline.isComplete) {
    return {
      type: "weekly_delta",
      label,
      baselineCompletionDate: null,
      projectedCompletionDate: null,
      deltaDays: null,
      explanation: "This goal is already complete — there's nothing left to simulate.",
      insufficientDataReason: null,
    };
  }

  const result = whatIfWeeklyDelta(baseline, amount, now);
  if (result === null) {
    return {
      type: "weekly_delta",
      label,
      baselineCompletionDate: baseline.projectedCompletionDate,
      projectedCompletionDate: null,
      deltaDays: null,
      explanation: label,
      insufficientDataReason: "Not enough deposit history on this goal yet to simulate a pace change.",
    };
  }

  if (result.projectedCompletionDate === null) {
    // whatIfWeeklyDelta() returns a non-null object with a null date when
    // the adjusted pace is zero or negative — a real, distinct outcome
    // from "no baseline pace at all," so it gets its own message.
    return {
      type: "weekly_delta",
      label,
      baselineCompletionDate: baseline.projectedCompletionDate,
      projectedCompletionDate: null,
      deltaDays: null,
      explanation: label,
      insufficientDataReason: "That change would bring the weekly pace to zero or below, so a completion date can't be projected.",
    };
  }

  return {
    type: "weekly_delta",
    label,
    baselineCompletionDate: baseline.projectedCompletionDate,
    projectedCompletionDate: result.projectedCompletionDate,
    deltaDays: diffDays(baseline.projectedCompletionDate, result.projectedCompletionDate),
    explanation:
      result.projectedCompletionDate && baseline.projectedCompletionDate
        ? `At $${result.adjustedWeeklyPace.toFixed(2)}/week instead of $${(baseline.currentWeeklyPace ?? 0).toFixed(2)}/week, this goal would finish on ${result.projectedCompletionDate}.`
        : label,
    insufficientDataReason: null,
  };
}

/**
 * "If one payment is skipped." Modeled as a one-off delay, not a sustained
 * pace change (that's what weekly_delta/cadence_change are for): the delay
 * is however long it would take, at the goal's *current* pace, to make up
 * the dollar amount of one average-sized deposit.
 *
 *   extraDays = ceil((averageDepositAmount / currentWeeklyPace) * 7)
 *
 * Documented assumption: the skipped deposit is assumed to be this goal's
 * own historical average size — the only size that's actually derived from
 * the user's real behaviour rather than invented.
 */
function simulateSkipPayment(baseline: GoalForecast, transactions: Transaction[], now: Date): ScenarioResult {
  const label = "Skip the next deposit";

  if (baseline.isComplete) {
    return {
      type: "skip_payment",
      label,
      baselineCompletionDate: null,
      projectedCompletionDate: null,
      deltaDays: null,
      explanation: "This goal is already complete — there's nothing left to simulate.",
      insufficientDataReason: null,
    };
  }

  const deposits = getDeposits(transactions);
  const stats = getDepositStats(deposits);

  if (!baseline.projectedCompletionDate || baseline.currentWeeklyPace === null || baseline.currentWeeklyPace <= 0 || !stats) {
    return {
      type: "skip_payment",
      label,
      baselineCompletionDate: baseline.projectedCompletionDate,
      projectedCompletionDate: null,
      deltaDays: null,
      explanation: label,
      insufficientDataReason: "Not enough deposit history on this goal yet to simulate a skipped payment.",
    };
  }

  const extraWeeks = stats.average / baseline.currentWeeklyPace;
  const extraDays = Math.ceil(extraWeeks * 7);
  const baselineDate = new Date(baseline.projectedCompletionDate + "T00:00:00Z");
  const projectedDate = toUTCDateString(new Date(baselineDate.getTime() + extraDays * 86400000));

  return {
    type: "skip_payment",
    label,
    baselineCompletionDate: baseline.projectedCompletionDate,
    projectedCompletionDate: projectedDate,
    deltaDays: extraDays,
    explanation: `Skipping one average deposit (~$${stats.average.toFixed(2)}) would push completion back ${extraDays} day${extraDays === 1 ? "" : "s"}, to ${projectedDate}.`,
    insufficientDataReason: null,
  };
}

/**
 * "If deposits become biweekly" (or any other cadence). Keeps the goal's
 * own historical average deposit *amount* fixed and recomputes weekly pace
 * for the requested interval, then reuses `whatIfWeeklyDelta()` to project
 * forward — no separate pace formula.
 */
function simulateCadenceChange(baseline: GoalForecast, transactions: Transaction[], input: ScenarioInput, now: Date): ScenarioResult {
  const intervalDays = input.intervalDays ?? 14;
  const label = intervalDays === 14 ? "Switch to biweekly deposits" : `Switch to every ${intervalDays} days`;

  if (baseline.isComplete) {
    return {
      type: "cadence_change",
      label,
      baselineCompletionDate: null,
      projectedCompletionDate: null,
      deltaDays: null,
      explanation: "This goal is already complete — there's nothing left to simulate.",
      insufficientDataReason: null,
    };
  }

  const deposits = getDeposits(transactions);
  const stats = getDepositStats(deposits);

  if (!stats || baseline.currentWeeklyPace === null) {
    return {
      type: "cadence_change",
      label,
      baselineCompletionDate: baseline.projectedCompletionDate,
      projectedCompletionDate: null,
      deltaDays: null,
      explanation: label,
      insufficientDataReason: "Not enough deposit history on this goal yet to simulate a cadence change.",
    };
  }

  const newWeeklyPace = stats.average / (intervalDays / 7);
  const deltaPerWeek = newWeeklyPace - baseline.currentWeeklyPace;
  const result = whatIfWeeklyDelta(baseline, deltaPerWeek, now);

  if (result === null || result.projectedCompletionDate === null) {
    return {
      type: "cadence_change",
      label,
      baselineCompletionDate: baseline.projectedCompletionDate,
      projectedCompletionDate: null,
      deltaDays: null,
      explanation: label,
      insufficientDataReason: "That cadence would bring the weekly pace to zero or below, so a completion date can't be projected.",
    };
  }

  return {
    type: "cadence_change",
    label,
    baselineCompletionDate: baseline.projectedCompletionDate,
    projectedCompletionDate: result.projectedCompletionDate,
    deltaDays: diffDays(baseline.projectedCompletionDate, result.projectedCompletionDate),
    explanation: `Depositing ~$${stats.average.toFixed(2)} every ${intervalDays} days (≈$${newWeeklyPace.toFixed(2)}/week) would finish on ${result.projectedCompletionDate}.`,
    insufficientDataReason: null,
  };
}

/**
 * "If I add a one-time lump sum today." Reuses `forecastGoal()` directly
 * against a cloned goal with the lump sum already applied to
 * `current_amount` — the safest way to reuse the exact same pace/remaining
 * math as the baseline forecast without duplicating it.
 */
function simulateLumpSum(goal: GoalInput, transactions: Transaction[], baseline: GoalForecast, input: ScenarioInput, now: Date): ScenarioResult {
  const amount = Math.max(0, input.amount ?? 0);
  const label = `Add a one-time $${amount} deposit today`;

  if (baseline.isComplete || amount <= 0) {
    return {
      type: "lump_sum",
      label,
      baselineCompletionDate: baseline.isComplete ? null : baseline.projectedCompletionDate,
      projectedCompletionDate: baseline.isComplete ? null : baseline.projectedCompletionDate,
      deltaDays: 0,
      explanation: baseline.isComplete ? "This goal is already complete — there's nothing left to simulate." : "Enter a lump sum amount greater than $0 to simulate.",
      insufficientDataReason: null,
    };
  }

  const adjustedGoal: GoalInput = {
    ...goal,
    current_amount: Number(goal.current_amount) + amount,
  };
  const projected = forecastGoal(adjustedGoal, transactions, now);

  return {
    type: "lump_sum",
    label,
    baselineCompletionDate: baseline.projectedCompletionDate,
    projectedCompletionDate: projected.isComplete ? toUTCDateStringForNow(now) : projected.projectedCompletionDate,
    deltaDays: projected.isComplete ? diffDays(baseline.projectedCompletionDate, toUTCDateStringForNow(now)) : diffDays(baseline.projectedCompletionDate, projected.projectedCompletionDate),
    explanation: projected.isComplete
      ? `A $${amount} lump sum today would complete this goal immediately.`
      : projected.projectedCompletionDate
        ? `A $${amount} lump sum today would move completion to ${projected.projectedCompletionDate}, keeping the same ongoing pace.`
        : label,
    insufficientDataReason: projected.isComplete ? null : projected.insufficientDataReason,
  };
}

function toUTCDateStringForNow(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Runs a single scenario against one goal. Never mutates `goal` or `transactions`. */
export function simulateScenario(
  goal: GoalInput,
  transactions: Transaction[],
  input: ScenarioInput,
  now: Date = new Date()
): ScenarioResult {
  const baseline = forecastGoal(goal, transactions, now);

  switch (input.type) {
    case "weekly_delta":
      return simulateWeeklyDelta(baseline, input, now);
    case "skip_payment":
      return simulateSkipPayment(baseline, transactions, now);
    case "cadence_change":
      return simulateCadenceChange(baseline, transactions, input, now);
    case "lump_sum":
      return simulateLumpSum(goal, transactions, baseline, input, now);
  }
}

/** Runs multiple scenarios against the same goal in one pass (shares the baseline forecast). */
export function simulateScenarios(
  goal: GoalInput,
  transactions: Transaction[],
  inputs: ScenarioInput[],
  now: Date = new Date()
): ScenarioResult[] {
  return inputs.map((input) => simulateScenario(goal, transactions, input, now));
}

/**
 * Convenience: the four scenario types the Sprint 28 brief calls out by
 * name, with reasonable defaults, run in one call for a goal's "what if"
 * panel. Callers wanting custom amounts should call `simulateScenarios`
 * directly instead.
 */
export function simulateStandardScenarios(
  goal: GoalInput,
  transactions: Transaction[],
  now: Date = new Date()
): ScenarioResult[] {
  const deposits = getDeposits(transactions);
  const stats = getDepositStats(deposits);
  const step = stats ? Math.max(5, Math.round(stats.average * 0.25)) : 20;

  return simulateScenarios(
    goal,
    transactions,
    [
      { type: "weekly_delta", amount: step },
      { type: "weekly_delta", amount: -step },
      { type: "skip_payment" },
      { type: "cadence_change", intervalDays: 14 },
    ],
    now
  );
}

// Re-exported so consumers of this module don't need a second import for the shared baseline type.
export type { GoalForecast };
export { averageDepositIntervalDays };
