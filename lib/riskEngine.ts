/**
 * lib/riskEngine.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 21 — Phase 4: Behavioral Risk Engine.
 *
 * Pure rule engine — no ML, no probability model. Every factor is a
 * documented threshold applied to a number already produced by
 * lib/analyticsEngine.ts, lib/trends.ts, lib/habits.ts, or lib/momentum.ts.
 * Read-only: this module never writes anything, and never touches streak,
 * XP, or balance logic — it only *reads* the streak numbers the caller
 * already has.
 */

import { getDeposits, daysSinceLastDeposit, averageDepositIntervalDays } from "@/lib/analyticsEngine";
import { compareRecentPeriods } from "@/lib/trends";
import { computeHabitProfile } from "@/lib/habits";
import type { Transaction } from "@/lib/types";

export type RiskLevel = "low" | "moderate" | "elevated" | "high";

export type InterventionType =
  | "smaller_deposit_suggestion"
  | "challenge_adjustment"
  | "target_extension"
  | "motivational_celebration"
  | "easier_weekly_goal"
  | "streak_recovery"
  | "none";

export interface RiskFactor {
  name: string;
  triggered: boolean;
  weight: number; // points this factor contributes to riskScore when triggered
  explanation: string;
}

export interface BehavioralRisk {
  riskScore: number; // 0-100, higher = more risk
  riskLevel: RiskLevel;
  factors: RiskFactor[];
  confidence: number; // 0-1, based on how much history is available
  recommendedInterventionType: InterventionType;
  hasEnoughData: boolean;
}

export interface RiskEngineInputs {
  transactions: Transaction[];
  streakDays: number;
  longestStreak: number;
  now?: Date;
}

const MIN_DEPOSITS_FOR_RISK_READ = 4;

function levelForScore(score: number): RiskLevel {
  if (score >= 70) return "high";
  if (score >= 45) return "elevated";
  if (score >= 20) return "moderate";
  return "low";
}

export function computeBehavioralRisk(inputs: RiskEngineInputs): BehavioralRisk {
  const now = inputs.now ?? new Date();
  const deposits = getDeposits(inputs.transactions);

  if (deposits.length < MIN_DEPOSITS_FOR_RISK_READ) {
    return {
      riskScore: 0,
      riskLevel: "low",
      factors: [],
      confidence: 0,
      recommendedInterventionType: "none",
      hasEnoughData: false,
    };
  }

  const habits = computeHabitProfile(inputs.transactions, now);
  const sinceLast = daysSinceLastDeposit(deposits, now);
  const typicalInterval = averageDepositIntervalDays(deposits);
  const cmp30 = compareRecentPeriods(inputs.transactions, 30, now);

  const factors: RiskFactor[] = [];

  // ── Declining consistency (25 pts) ───────────────────────────────────
  const decliningConsistency = habits.consistencyTrend === "declining";
  factors.push({
    name: "Declining consistency",
    triggered: decliningConsistency,
    weight: 25,
    explanation: decliningConsistency
      ? "Consistency has dropped comparing the first half of saving history to the second half."
      : "Consistency is stable or improving.",
  });

  // ── Abandonment risk (25 pts) ─────────────────────────────────────────
  // Triggered when the gap since the last deposit is at least 3x the
  // user's own typical interval (relative to their own rhythm, not a flat
  // number of days) — and at least 14 days regardless, so a naturally
  // monthly saver isn't flagged after 10 quiet days.
  const abandonmentThreshold = typicalInterval ? Math.max(14, typicalInterval * 3) : 21;
  const abandonmentRisk = sinceLast !== null && sinceLast >= abandonmentThreshold;
  factors.push({
    name: "Abandonment risk",
    triggered: abandonmentRisk,
    weight: 25,
    explanation:
      sinceLast === null
        ? "No deposits yet."
        : abandonmentRisk
          ? `${sinceLast} days since the last deposit — well beyond this user's typical ${typicalInterval?.toFixed(1) ?? "n/a"}-day rhythm.`
          : `${sinceLast} days since the last deposit — within the user's typical rhythm.`,
  });

  // ── Inactivity (15 pts) ────────────────────────────────────────────────
  // A softer, earlier signal than abandonment: 2x the typical interval, or 10 days, whichever is larger.
  const inactivityThreshold = typicalInterval ? Math.max(10, typicalInterval * 2) : 10;
  const inactivity = !abandonmentRisk && sinceLast !== null && sinceLast >= inactivityThreshold;
  factors.push({
    name: "Inactivity",
    triggered: inactivity,
    weight: 15,
    explanation: inactivity
      ? `${sinceLast} days of inactivity — longer than usual, though not yet at abandonment-risk levels.`
      : "Recent activity is within the user's normal range.",
  });

  // ── Saving fatigue (15 pts) ────────────────────────────────────────────
  // Deposit amounts trending down, not just frequency — distinct from
  // "rapidly decreasing deposits" below, which is about the last-30-day
  // total, not the per-deposit size.
  const recentDeposits = deposits.slice(-6);
  const earlierDeposits = deposits.slice(-12, -6);
  let savingFatigue = false;
  if (recentDeposits.length >= 3 && earlierDeposits.length >= 3) {
    const recentAvg = recentDeposits.reduce((s, d) => s + Number(d.amount), 0) / recentDeposits.length;
    const earlierAvg = earlierDeposits.reduce((s, d) => s + Number(d.amount), 0) / earlierDeposits.length;
    savingFatigue = earlierAvg > 0 && recentAvg < earlierAvg * 0.6;
  }
  factors.push({
    name: "Saving fatigue",
    triggered: savingFatigue,
    weight: 15,
    explanation: savingFatigue
      ? "Recent deposit amounts are noticeably smaller than earlier ones — a possible sign of saving fatigue."
      : "Deposit amounts are stable or growing.",
  });

  // ── Collapsing streak (10 pts) ─────────────────────────────────────────
  const collapsingStreak = inputs.longestStreak >= 7 && inputs.streakDays === 0;
  factors.push({
    name: "Collapsing streak",
    triggered: collapsingStreak,
    weight: 10,
    explanation: collapsingStreak
      ? `Streak reset to 0 after a personal best of ${inputs.longestStreak} days.`
      : "Streak is intact or was never a strong habit to begin with.",
  });

  // ── Rapidly decreasing deposits (10 pts) ───────────────────────────────
  const rapidDecrease = cmp30.percentChange !== null && cmp30.percentChange <= -40 && cmp30.previousCount > 0;
  factors.push({
    name: "Rapidly decreasing deposits",
    triggered: rapidDecrease,
    weight: 10,
    explanation: rapidDecrease
      ? `Total saved is down ${Math.round(Math.abs(cmp30.percentChange!))}% over the last 30 days vs. the 30 days before that.`
      : "30-day saving total is stable or growing.",
  });

  const riskScore = Math.min(100, factors.reduce((s, f) => (f.triggered ? s + f.weight : s), 0));
  const riskLevel = levelForScore(riskScore);
  const confidence = Math.min(1, deposits.length / 15);

  let recommendedInterventionType: InterventionType = "none";
  if (collapsingStreak) recommendedInterventionType = "streak_recovery";
  else if (abandonmentRisk) recommendedInterventionType = "streak_recovery";
  else if (savingFatigue) recommendedInterventionType = "smaller_deposit_suggestion";
  else if (inactivity) recommendedInterventionType = "easier_weekly_goal";
  else if (decliningConsistency || rapidDecrease) recommendedInterventionType = "challenge_adjustment";
  else if (riskScore === 0) recommendedInterventionType = "motivational_celebration";

  return { riskScore, riskLevel, factors, confidence, recommendedInterventionType, hasEnoughData: true };
}
