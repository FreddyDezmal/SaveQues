/**
 * lib/forecast.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 19 — Phase 4: Goal Forecasting.
 *
 * Pure, deterministic, explainable arithmetic — no machine learning, per
 * the sprint brief. Pace is derived from the user's own recent deposit
 * history for the goal (lib/analyticsEngine.ts), then projected forward
 * linearly. That linearity is a deliberate simplification: it's the
 * assumption a user can actually verify and reason about ("if I keep doing
 * what I've been doing"), rather than a hidden model.
 *
 * All functions are pure and take `now` as a parameter so tests are
 * deterministic.
 */

import { getDeposits, weeklyTotals } from "@/lib/analyticsEngine";
import { utcDaysBetween } from "@/lib/dateUtils";
import type { SavingsGoal, Transaction } from "@/lib/types";

export interface GoalForecast {
  goalId: string;
  remaining: number;
  /** Deposits/week, averaged over the most recent `paceWindowWeeks` weeks that had activity. Null = not enough history. */
  currentWeeklyPace: number | null;
  /** Required deposits/week to hit target_date. Null when the goal has no target_date, or is already overdue. */
  requiredWeeklyPace: number | null;
  requiredMonthlyPace: number | null;
  /** "ahead" | "on_track" | "behind" | "unknown" — unknown when there's no target_date or no pace data. */
  paceStatus: "ahead" | "on_track" | "behind" | "unknown";
  /** Projected completion date (UTC "YYYY-MM-DD") at current pace. Null if pace is 0/unknown or goal is already complete. */
  projectedCompletionDate: string | null;
  estimatedDaysRemaining: number | null;
  estimatedWeeksRemaining: number | null;
  isComplete: boolean;
  /** Human-readable reason when a projection can't be made — never left silently blank. */
  insufficientDataReason: string | null;
}

export const PACE_WINDOW_WEEKS = 8;

/**
 * Average weekly pace over the most recent `PACE_WINDOW_WEEKS` weeks of a
 * deposit list's own history. Uses actual elapsed weeks of history (capped
 * at the window) so a deposit history that's only 2 weeks old isn't
 * diluted by 6 empty weeks it hasn't had a chance to exist in yet.
 *
 * Exported (Sprint 28 — Phase 10, Cash Flow Intelligence): the formula is
 * scope-agnostic — it was always "pace of whatever deposit list you hand
 * it," originally only ever called with one goal's deposits. Rather than
 * copy this formula into lib/cashFlowProjection.ts for portfolio-wide (all
 * goals') deposits, that module imports and reuses this directly.
 */
export function recentWeeklyPace(deposits: ReturnType<typeof getDeposits>, now: Date): number | null {
  if (deposits.length === 0) return null;
  const windowStart = new Date(now.getTime() - PACE_WINDOW_WEEKS * 7 * 86400000);
  const firstDepositDate = new Date(deposits[0].created_at);
  const effectiveStart = firstDepositDate > windowStart ? firstDepositDate : windowStart;
  const elapsedDays = Math.max(1, utcDaysBetween(effectiveStart, now));
  const inWindow = deposits.filter((d) => new Date(d.created_at).getTime() >= effectiveStart.getTime());
  if (inWindow.length === 0) return null;
  const total = inWindow.reduce((s, d) => s + Number(d.amount), 0);
  return total / (elapsedDays / 7);
}

function toUTCDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Builds a full forecast for one goal. `transactions` should already be
 * filtered to this goal's transactions (callers pass per-goal history, e.g.
 * from the goal detail page's existing transactions query).
 */
export function forecastGoal(
  goal: Pick<SavingsGoal, "id" | "target_amount" | "current_amount" | "target_date" | "is_complete">,
  transactions: Transaction[],
  now: Date = new Date()
): GoalForecast {
  const remaining = Math.max(0, Number(goal.target_amount) - Number(goal.current_amount));
  const isComplete = goal.is_complete || remaining === 0;

  if (isComplete) {
    return {
      goalId: goal.id,
      remaining: 0,
      currentWeeklyPace: null,
      requiredWeeklyPace: null,
      requiredMonthlyPace: null,
      paceStatus: "unknown",
      projectedCompletionDate: null,
      estimatedDaysRemaining: 0,
      estimatedWeeksRemaining: 0,
      isComplete: true,
      insufficientDataReason: null,
    };
  }

  const deposits = getDeposits(transactions);
  const currentWeeklyPace = recentWeeklyPace(deposits, now);

  let requiredWeeklyPace: number | null = null;
  let requiredMonthlyPace: number | null = null;
  if (goal.target_date) {
    const weeksUntilTarget = utcDaysBetween(now, new Date(goal.target_date)) / 7;
    if (weeksUntilTarget > 0) {
      requiredWeeklyPace = remaining / weeksUntilTarget;
      requiredMonthlyPace = requiredWeeklyPace * (30 / 7);
    }
    // weeksUntilTarget <= 0 (overdue target date): leave both null rather
    // than reporting a nonsensical/negative required pace.
  }

  let paceStatus: GoalForecast["paceStatus"] = "unknown";
  if (currentWeeklyPace !== null && requiredWeeklyPace !== null) {
    const ratio = currentWeeklyPace / requiredWeeklyPace;
    if (ratio >= 1.1) paceStatus = "ahead";
    else if (ratio >= 0.9) paceStatus = "on_track";
    else paceStatus = "behind";
  }

  let projectedCompletionDate: string | null = null;
  let estimatedDaysRemaining: number | null = null;
  let estimatedWeeksRemaining: number | null = null;
  let insufficientDataReason: string | null = null;

  if (currentWeeklyPace === null || currentWeeklyPace <= 0) {
    insufficientDataReason =
      deposits.length === 0
        ? "No deposits recorded yet for this goal, so a completion date can't be projected."
        : "Recent deposits aren't showing a positive saving pace, so a completion date can't be projected.";
  } else {
    const weeksRemaining = remaining / currentWeeklyPace;
    estimatedWeeksRemaining = weeksRemaining;
    estimatedDaysRemaining = Math.ceil(weeksRemaining * 7);
    projectedCompletionDate = toUTCDateString(new Date(now.getTime() + estimatedDaysRemaining * 86400000));
  }

  return {
    goalId: goal.id,
    remaining,
    currentWeeklyPace,
    requiredWeeklyPace,
    requiredMonthlyPace,
    paceStatus,
    projectedCompletionDate,
    estimatedDaysRemaining,
    estimatedWeeksRemaining,
    isComplete: false,
    insufficientDataReason,
  };
}

/**
 * "What if" projection: re-runs the projection assuming the weekly pace is
 * adjusted by `deltaPerWeek` (positive = saving more, negative = saving
 * less). Returns null if there's no baseline pace to adjust, or if the
 * adjusted pace would be zero or negative.
 */
export function whatIfWeeklyDelta(
  forecast: GoalForecast,
  deltaPerWeek: number,
  now: Date = new Date()
): { adjustedWeeklyPace: number; projectedCompletionDate: string | null } | null {
  if (forecast.currentWeeklyPace === null || forecast.isComplete) return null;
  const adjustedWeeklyPace = forecast.currentWeeklyPace + deltaPerWeek;
  if (adjustedWeeklyPace <= 0) return { adjustedWeeklyPace, projectedCompletionDate: null };
  const weeksRemaining = forecast.remaining / adjustedWeeklyPace;
  const days = Math.ceil(weeksRemaining * 7);
  return { adjustedWeeklyPace, projectedCompletionDate: toUTCDateString(new Date(now.getTime() + days * 86400000)) };
}

/** Re-exported for convenience so callers building custom pace views don't need a second import. */
export { weeklyTotals };
