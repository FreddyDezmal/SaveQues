/**
 * lib/adaptiveGoals.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 21 — Phase 6: Adaptive Goals.
 *
 * Every recommendation is arithmetic on top of lib/forecast.ts (Sprint 19)
 * — this module does not recompute pace or projected completion, it only
 * decides what to *suggest* given the forecast's numbers, and always shows
 * the numbers behind the suggestion (the "mathematical justification" the
 * brief asks for).
 */

import { forecastGoal, type GoalForecast } from "@/lib/forecast";
import { utcDaysBetween } from "@/lib/dateUtils";
import type { SavingsGoal, Transaction } from "@/lib/types";

export type AdaptiveGoalActionType =
  | "split_goal"
  | "extend_deadline"
  | "increase_pace"
  | "reduce_pace"
  | "milestone_checkpoint";

export interface AdaptiveGoalRecommendation {
  goalId: string;
  type: AdaptiveGoalActionType;
  title: string;
  justification: string; // includes the actual numbers behind the suggestion
}

export interface AdaptiveGoalsInputs {
  goal: Pick<SavingsGoal, "id" | "title" | "target_amount" | "current_amount" | "target_date" | "is_complete">;
  transactions: Transaction[]; // this goal's transactions only
  now?: Date;
}

/**
 * Milestone checkpoints at 25/50/75% of target — always offered for any
 * goal with real progress and no completed goal, since they're free
 * (no risk of being wrong) and genuinely useful regardless of pace.
 */
function milestoneCheckpoints(goal: AdaptiveGoalsInputs["goal"]): AdaptiveGoalRecommendation | null {
  const target = Number(goal.target_amount);
  const current = Number(goal.current_amount);
  if (target <= 0) return null;
  const progressPct = (current / target) * 100;
  const checkpoints = [25, 50, 75];
  const next = checkpoints.find((c) => progressPct < c);
  if (!next) return null;
  const amountToNext = Math.round(target * (next / 100) - current);
  return {
    goalId: goal.id,
    type: "milestone_checkpoint",
    title: `Next checkpoint: ${next}%`,
    justification: `Currently at ${Math.round(progressPct)}% (${Math.round(current)} of ${Math.round(target)}). ${amountToNext} more reaches the ${next}% checkpoint.`,
  };
}

export function generateAdaptiveGoalRecommendations(inputs: AdaptiveGoalsInputs): AdaptiveGoalRecommendation[] {
  const now = inputs.now ?? new Date();
  const { goal } = inputs;
  const recommendations: AdaptiveGoalRecommendation[] = [];

  if (goal.is_complete) return [];

  const forecast: GoalForecast = forecastGoal(goal, inputs.transactions, now);

  // ── Extend deadline ────────────────────────────────────────────────────
  // Behind pace with a real target date and a real (positive) current pace.
  if (goal.target_date && forecast.paceStatus === "behind" && forecast.currentWeeklyPace && forecast.currentWeeklyPace > 0) {
    const weeksAtCurrentPace = forecast.remaining / forecast.currentWeeklyPace;
    const daysAtCurrentPace = Math.ceil(weeksAtCurrentPace * 7);
    const impliedNewDate = new Date(now.getTime() + daysAtCurrentPace * 86400000);
    const currentTargetDaysAway = utcDaysBetween(now, new Date(goal.target_date));
    recommendations.push({
      goalId: goal.id,
      type: "extend_deadline",
      title: "Extend the target date",
      justification: `At the current pace of ${Math.round(forecast.currentWeeklyPace)}/week, this goal would complete around ${impliedNewDate.toISOString().slice(0, 10)} — about ${Math.max(0, daysAtCurrentPace - currentTargetDaysAway)} days after the current target date.`,
    });
  }

  // ── Increase pace ─────────────────────────────────────────────────────
  if (goal.target_date && forecast.paceStatus === "behind" && forecast.requiredWeeklyPace !== null && forecast.currentWeeklyPace !== null) {
    const gap = forecast.requiredWeeklyPace - forecast.currentWeeklyPace;
    if (gap > 0) {
      recommendations.push({
        goalId: goal.id,
        type: "increase_pace",
        title: "Increase weekly deposits",
        justification: `Hitting the target date needs ${Math.round(forecast.requiredWeeklyPace)}/week; the current pace is ${Math.round(forecast.currentWeeklyPace)}/week — an increase of about ${Math.round(gap)}/week would close the gap.`,
      });
    }
  }

  // ── Reduce pace ───────────────────────────────────────────────────────
  // Meaningfully ahead of what's needed — a real, positive suggestion (redirect
  // the surplus elsewhere), not a criticism.
  if (goal.target_date && forecast.paceStatus === "ahead" && forecast.requiredWeeklyPace !== null && forecast.currentWeeklyPace !== null) {
    const surplus = forecast.currentWeeklyPace - forecast.requiredWeeklyPace;
    if (surplus > 0 && forecast.requiredWeeklyPace > 0 && surplus / forecast.requiredWeeklyPace >= 0.3) {
      recommendations.push({
        goalId: goal.id,
        type: "reduce_pace",
        title: "Room to ease off — or redirect the surplus",
        justification: `Current pace is ${Math.round(forecast.currentWeeklyPace)}/week against a required ${Math.round(forecast.requiredWeeklyPace)}/week — about ${Math.round(surplus)}/week of surplus that could go toward another goal without missing this target date.`,
      });
    }
  }

  // ── Split goal ────────────────────────────────────────────────────────
  // Large remaining amount relative to demonstrated pace: more than 26
  // weeks (half a year) to complete at the current rate. Splitting a big,
  // distant goal into two smaller ones is a well-known way to make
  // progress feel real sooner.
  if (forecast.currentWeeklyPace && forecast.currentWeeklyPace > 0 && forecast.estimatedWeeksRemaining && forecast.estimatedWeeksRemaining > 26) {
    recommendations.push({
      goalId: goal.id,
      type: "split_goal",
      title: "Consider splitting this into two goals",
      justification: `At the current pace, this goal is projected to take about ${Math.round(forecast.estimatedWeeksRemaining)} weeks — splitting the remaining ${Math.round(forecast.remaining)} into two milestones would give a completion (and a celebration) roughly halfway through.`,
    });
  }

  // ── Milestone checkpoint (always offered when relevant) ──────────────
  const checkpoint = milestoneCheckpoints(goal);
  if (checkpoint) recommendations.push(checkpoint);

  return recommendations;
}
