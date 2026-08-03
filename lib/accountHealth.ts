/**
 * lib/accountHealth.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 20 — Phase 9: Financial Health Dashboard (Account Health).
 *
 * Expands Sprint 19's per-goal `lib/goalHealth.ts` up to the account level.
 * Six documented, fixed-weight factors (100 points total, weights below).
 * Reuses lib/analyticsEngine.ts, lib/momentum.ts, and per-goal
 * lib/goalHealth.ts/lib/forecast.ts rather than re-deriving any of their
 * math — this module is aggregation + a genuinely new "forecast
 * reliability" factor, not a re-implementation.
 *
 * ── Scoring formula (100 points total) ──────────────────────────────────
 *   Consistency           20 pts — analyticsEngine.consistencyScore().
 *   Savings growth         20 pts — trend direction/magnitude, last 30 vs
 *                                   prior 30 days (lib/trends.ts).
 *   Goal completion        15 pts — completed / (completed + active) goals.
 *   Deposit frequency      15 pts — averageDepositsPerWeek, 1/week = full.
 *   Momentum               15 pts — lib/momentum.ts state, scaled.
 *   Forecast reliability   15 pts — share of active, target-dated goals
 *                                   currently on_track/ahead.
 *
 * Status bands match lib/goalHealth.ts for consistency across the app:
 * Excellent 85–100 · Good 65–84 · Needs Attention 40–64 · At Risk 0–39.
 */

import { getDeposits, consistencyScore, averageDepositsPerWeek } from "@/lib/analyticsEngine";
import { compareRecentPeriods } from "@/lib/trends";
import { getMomentumState } from "@/lib/momentum";
import { forecastGoal, type GoalForecast } from "@/lib/forecast";
import type { SavingsGoal, Transaction } from "@/lib/types";
import type { GoalHealthStatus } from "@/lib/goalHealth";

export interface AccountHealthFactor {
  name: string;
  points: number;
  maxPoints: number;
  explanation: string;
}

export interface AccountHealth {
  score: number;
  status: GoalHealthStatus;
  factors: AccountHealthFactor[];
  recommendations: string[];
  trend: "improving" | "stable" | "declining" | "unknown";
}

function statusForScore(score: number): GoalHealthStatus {
  if (score >= 85) return "Excellent";
  if (score >= 65) return "Good";
  if (score >= 40) return "Needs Attention";
  return "At Risk";
}

export interface AccountHealthInputs {
  transactions: Transaction[];
  goals: Pick<SavingsGoal, "id" | "target_amount" | "current_amount" | "target_date" | "is_complete">[];
  activityLog: { date: string; xp_earned: number }[];
  now?: Date;
  /**
   * Sprint 30 — Phase 10 (Performance audit): getFinancialIntelligence()
   * was calling forecastGoal() once per active goal here AND once per
   * active goal again inside lib/coaching.ts's goalMessages() — the same
   * function, same goal, same transactions, computed twice in one
   * request. Optional and additive: when the orchestrator has already
   * computed a goal's forecast, it passes it here instead of paying for
   * a second identical pass. Falls back to computing it internally (byte
   * -identical to the previous behavior) for any caller that doesn't
   * have one — e.g. any direct unit-test call, or callers computing
   * account health in isolation without also needing coaching messages.
   */
  forecastsByGoalId?: Map<string, GoalForecast>;
}

export function computeAccountHealth(inputs: AccountHealthInputs): AccountHealth {
  const now = inputs.now ?? new Date();
  const deposits = getDeposits(inputs.transactions);
  const recommendations: string[] = [];

  // ── Consistency (20) ──────────────────────────────────────────────────
  const consistency = consistencyScore(deposits);
  const consistencyPoints = consistency === null ? 10 : (consistency / 100) * 20;
  if (consistency !== null && consistency < 50) recommendations.push("Try depositing on a regular schedule to improve consistency.");

  // ── Savings growth (20) ───────────────────────────────────────────────
  const cmp = compareRecentPeriods(inputs.transactions, 30, now);
  let growthPoints = 10; // neutral default when there's no prior-period baseline
  let growthExplanation = "Not enough history yet to compare month-over-month growth.";
  if (cmp.percentChange !== null) {
    const clamped = Math.max(-50, Math.min(50, cmp.percentChange));
    growthPoints = 10 + (clamped / 50) * 10; // maps -50%..+50% to 0..20
    growthExplanation =
      cmp.percentChange >= 0
        ? `Saving is up ${Math.round(cmp.percentChange)}% over the last 30 days.`
        : `Saving is down ${Math.round(Math.abs(cmp.percentChange))}% over the last 30 days.`;
    if (cmp.percentChange < -10) recommendations.push("Recent saving has slowed — even a small deposit keeps momentum going.");
  }

  // ── Goal completion (15) ──────────────────────────────────────────────
  const completed = inputs.goals.filter((g) => g.is_complete).length;
  const totalGoals = inputs.goals.length;
  const completionRatio = totalGoals > 0 ? completed / totalGoals : null;
  const completionPoints = completionRatio === null ? 7.5 : completionRatio * 15;
  if (totalGoals === 0) recommendations.push("Create a goal to start tracking progress toward something specific.");

  // ── Deposit frequency (15) ─────────────────────────────────────────────
  const perWeek = averageDepositsPerWeek(deposits);
  const frequencyPoints = perWeek === null ? 0 : Math.min(15, (perWeek / 1) * 15);
  if (perWeek !== null && perWeek < 0.5) recommendations.push("Deposits are infrequent — smaller, more frequent deposits tend to build stronger habits than occasional large ones.");

  // ── Momentum (15) ───────────────────────────────────────────────────────
  const momentum = getMomentumState(inputs.activityLog);
  const momentumPoints = momentum.score * 15;

  // ── Forecast reliability (15) ───────────────────────────────────────────
  const activeGoalsWithTarget = inputs.goals.filter((g) => !g.is_complete && g.target_date);
  let forecastPoints = 7.5; // neutral default with nothing to measure
  let forecastExplanation = "No active goals with a target date to measure forecast reliability against.";
  if (activeGoalsWithTarget.length > 0) {
    // Perf fix (code review): this used to re-filter the user's entire
    // transaction list once per goal (O(goals × transactions)). For a
    // power user with many goals and years of history that's a lot of
    // repeated scanning for something a single grouping pass already
    // gives us. Group once, then look each goal's transactions up by id.
    const transactionsByGoalId = new Map<string, Transaction[]>();
    for (const t of inputs.transactions) {
      if (!t.goal_id) continue;
      const bucket = transactionsByGoalId.get(t.goal_id);
      if (bucket) bucket.push(t);
      else transactionsByGoalId.set(t.goal_id, [t]);
    }

    const onTrackCount = activeGoalsWithTarget.filter((g) => {
      const f = inputs.forecastsByGoalId?.get(g.id) ?? forecastGoal(g, transactionsByGoalId.get(g.id) ?? [], now);
      return f.paceStatus === "on_track" || f.paceStatus === "ahead";
    }).length;
    const ratio = onTrackCount / activeGoalsWithTarget.length;
    forecastPoints = ratio * 15;
    forecastExplanation = `${onTrackCount} of ${activeGoalsWithTarget.length} target-dated goals are on pace.`;
    if (ratio < 0.5) recommendations.push("Some goals are behind pace — consider adjusting either the deposit amount or the target date.");
  }

  const factors: AccountHealthFactor[] = [
    { name: "Consistency", points: round1(consistencyPoints), maxPoints: 20, explanation: consistency === null ? "Not enough deposits yet to measure consistency." : `Consistency score: ${consistency}/100.` },
    { name: "Savings growth", points: round1(growthPoints), maxPoints: 20, explanation: growthExplanation },
    { name: "Goal completion", points: round1(completionPoints), maxPoints: 15, explanation: totalGoals > 0 ? `${completed} of ${totalGoals} goals completed.` : "No goals created yet." },
    { name: "Deposit frequency", points: round1(frequencyPoints), maxPoints: 15, explanation: perWeek === null ? "Not enough deposits yet to measure frequency." : `Averaging ${perWeek.toFixed(1)} deposit(s)/week.` },
    { name: "Momentum", points: round1(momentumPoints), maxPoints: 15, explanation: `Momentum: ${momentum.label}.` },
    { name: "Forecast reliability", points: round1(forecastPoints), maxPoints: 15, explanation: forecastExplanation },
  ];

  const score = Math.round(factors.reduce((s, f) => s + f.points, 0));

  let trend: AccountHealth["trend"] = "unknown";
  if (cmp.percentChange !== null) {
    if (cmp.percentChange > 5) trend = "improving";
    else if (cmp.percentChange < -5) trend = "declining";
    else trend = "stable";
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    status: statusForScore(score),
    factors,
    recommendations: recommendations.slice(0, 3),
    trend,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}