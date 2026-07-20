/**
 * lib/goalHealth.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 19 — Phase 5: Goal Health.
 *
 * Produces a 0–100 health score per goal from five independently-documented,
 * fixed-weight factors (no arbitrary/hidden weighting — every point is
 * accounted for below). Built on lib/analyticsEngine.ts and lib/forecast.ts
 * rather than re-deriving pace/consistency itself.
 *
 * ── Scoring formula (100 points total) ──────────────────────────────────
 *   Recent activity      30 pts  — deposited within the last 14 days (full),
 *                                  within 30 days (half), else 0.
 *   Deposit frequency     20 pts — scaled from averageDepositsPerWeek,
 *                                  1 deposit/week = full marks, 0 = 0.
 *   Progress velocity     25 pts — currentWeeklyPace vs requiredWeeklyPace
 *                                  (only scored if the goal has a target_date;
 *                                  otherwise these 25 pts are redistributed
 *                                  proportionally across the other factors so
 *                                  the score still totals out of 100).
 *   Consistency           15 pts — analyticsEngine.consistencyScore() / 100.
 *   Deadline pressure     10 pts — penalises goals with a close target_date
 *                                  and low progress; full marks if no
 *                                  target_date, or plenty of runway.
 *
 * Status bands: Excellent 85–100 · Good 65–84 · Needs Attention 40–64 · At Risk 0–39.
 */

import {
  getDeposits,
  averageDepositsPerWeek,
  consistencyScore,
  daysSinceLastDeposit,
} from "@/lib/analyticsEngine";
import { forecastGoal } from "@/lib/forecast";
import { utcDaysBetween } from "@/lib/dateUtils";
import type { SavingsGoal, Transaction } from "@/lib/types";

export type GoalHealthStatus = "Excellent" | "Good" | "Needs Attention" | "At Risk";

export interface GoalHealthFactor {
  name: string;
  points: number;
  maxPoints: number;
  explanation: string;
}

export interface GoalHealth {
  goalId: string;
  score: number;
  status: GoalHealthStatus;
  factors: GoalHealthFactor[];
}

function statusForScore(score: number): GoalHealthStatus {
  if (score >= 85) return "Excellent";
  if (score >= 65) return "Good";
  if (score >= 40) return "Needs Attention";
  return "At Risk";
}

export function computeGoalHealth(
  goal: Pick<SavingsGoal, "id" | "target_amount" | "current_amount" | "target_date" | "is_complete">,
  transactions: Transaction[],
  now: Date = new Date()
): GoalHealth {
  if (goal.is_complete) {
    return {
      goalId: goal.id,
      score: 100,
      status: "Excellent",
      factors: [{ name: "Completed", points: 100, maxPoints: 100, explanation: "This goal has already been completed." }],
    };
  }

  const deposits = getDeposits(transactions);
  const hasTargetDate = !!goal.target_date;

  // Redistribute the 25 "progress velocity" points across the remaining
  // four factors when there's no target_date to measure velocity against,
  // so the score always totals out of 100 with no hidden weighting.
  const velocityMax = hasTargetDate ? 25 : 0;
  const redistribution = hasTargetDate ? 0 : 25 / 4;
  const activityMax = 30 + redistribution;
  const frequencyMax = 20 + redistribution;
  const consistencyMax = 15 + redistribution;
  const deadlineMax = 10 + redistribution;

  // ── Recent activity (up to activityMax) ──────────────────────────────────
  const sinceLast = daysSinceLastDeposit(deposits, now);
  let activityPoints = 0;
  let activityExplanation: string;
  if (sinceLast === null) {
    activityExplanation = "No deposits recorded yet for this goal.";
  } else if (sinceLast <= 14) {
    activityPoints = activityMax;
    activityExplanation = `Last deposit was ${sinceLast} day(s) ago.`;
  } else if (sinceLast <= 30) {
    activityPoints = activityMax / 2;
    activityExplanation = `Last deposit was ${sinceLast} days ago — getting stale.`;
  } else {
    activityExplanation = `No deposit in ${sinceLast} days.`;
  }

  // ── Deposit frequency (up to frequencyMax) ───────────────────────────────
  const perWeek = averageDepositsPerWeek(deposits);
  const frequencyPoints = perWeek === null ? 0 : Math.min(frequencyMax, (perWeek / 1) * frequencyMax);
  const frequencyExplanation =
    perWeek === null ? "Not enough deposits yet to measure frequency." : `Averaging ${perWeek.toFixed(1)} deposit(s)/week.`;

  // ── Progress velocity (up to velocityMax; 0 if no target_date) ──────────
  let velocityPoints = 0;
  let velocityExplanation = "No target date set, so pace can't be compared to a deadline.";
  if (hasTargetDate) {
    const forecast = forecastGoal(goal, transactions, now);
    if (forecast.currentWeeklyPace !== null && forecast.requiredWeeklyPace !== null) {
      const ratio = forecast.currentWeeklyPace / forecast.requiredWeeklyPace;
      velocityPoints = Math.max(0, Math.min(velocityMax, ratio * velocityMax));
      velocityExplanation =
        ratio >= 1
          ? `Current pace meets or beats the pace needed to hit the target date.`
          : `Current pace is ${Math.round(ratio * 100)}% of the pace needed to hit the target date.`;
    } else {
      velocityExplanation = "Not enough deposit history yet to compare pace against the target date.";
    }
  }

  // ── Consistency (up to consistencyMax) ───────────────────────────────────
  const consistency = consistencyScore(deposits);
  const consistencyPoints = consistency === null ? consistencyMax * 0.5 : (consistency / 100) * consistencyMax;
  const consistencyExplanation =
    consistency === null ? "Not enough deposits yet to measure consistency." : `Consistency score: ${consistency}/100.`;

  // ── Deadline pressure (up to deadlineMax) ────────────────────────────────
  let deadlinePoints = deadlineMax;
  let deadlineExplanation = "No target date set.";
  if (hasTargetDate) {
    const daysToTarget = utcDaysBetween(now, new Date(goal.target_date as string));
    const progressPct = Number(goal.target_amount) > 0 ? Number(goal.current_amount) / Number(goal.target_amount) : 0;
    if (daysToTarget < 0) {
      deadlinePoints = 0;
      deadlineExplanation = "Target date has passed.";
    } else if (daysToTarget <= 30 && progressPct < 0.8) {
      deadlinePoints = deadlineMax * 0.3;
      deadlineExplanation = `Target date is ${daysToTarget} days away with ${Math.round(progressPct * 100)}% saved — approaching deadline.`;
    } else {
      deadlineExplanation = `Target date is ${daysToTarget} days away — comfortable runway.`;
    }
  }

  const factors: GoalHealthFactor[] = [
    { name: "Recent activity", points: round1(activityPoints), maxPoints: activityMax, explanation: activityExplanation },
    { name: "Deposit frequency", points: round1(frequencyPoints), maxPoints: frequencyMax, explanation: frequencyExplanation },
    { name: "Progress velocity", points: round1(velocityPoints), maxPoints: velocityMax, explanation: velocityExplanation },
    { name: "Consistency", points: round1(consistencyPoints), maxPoints: consistencyMax, explanation: consistencyExplanation },
    { name: "Deadline pressure", points: round1(deadlinePoints), maxPoints: deadlineMax, explanation: deadlineExplanation },
  ];

  const score = Math.round(factors.reduce((s, f) => s + f.points, 0));

  return { goalId: goal.id, score: Math.max(0, Math.min(100, score)), status: statusForScore(score), factors };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
