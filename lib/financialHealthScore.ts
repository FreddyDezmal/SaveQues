/**
 * lib/financialHealthScore.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 28 — Phase 5: Financial Health Score.
 *
 * AUDIT NOTE: lib/accountHealth.ts (Sprint 20 — Phase 9) already IS an
 * account-level financial health score — six documented, fixed-weight
 * factors (consistency, growth, completion, frequency, momentum, forecast
 * reliability) out of 100, with a 4-band status. The Sprint 28 brief asks
 * for two things that version doesn't have: (1) "emergency readiness" and
 * "goal diversification" factors, and (2) a finer 6-tier scale (Excellent
 * / Great / Healthy / Improving / Needs Attention / Critical) instead of
 * the existing 4-band one.
 *
 * `computeAccountHealth()` is used today by app/(app)/dashboard/page.tsx,
 * lib/interventions.ts (which looks up a factor by name), and
 * lib/portfolioSummary.ts. Widening its factor list or renaming its bands
 * in place would change point totals those call sites — and their tests
 * (tests/unit/accountHealth.test.ts, tests/unit/interventions.test.ts) —
 * depend on, for callers that never asked for the new factors. That's the
 * "replace working code because a new brief wants something slightly
 * different" trap. Per this project's own rule (extend, don't replace,
 * unless the existing thing is objectively wrong — it isn't), this file
 * is additive: `computeAccountHealth()` is untouched and still exactly
 * what it was; this module *reuses* its six factor scores (rescaled to
 * make room for the two new ones) and adds the two new factors on top.
 *
 * ── Scoring formula (100 points total) ───────────────────────────────────
 *   Consistency            15 pts — accountHealth's Consistency, rescaled 20→15.
 *   Savings growth & trend 15 pts — accountHealth's Savings growth, rescaled 20→15.
 *   Goal progress           15 pts — accountHealth's Goal completion, unchanged.
 *   Deposit regularity      10 pts — accountHealth's Deposit frequency, rescaled 15→10.
 *   Momentum                15 pts — accountHealth's Momentum, unchanged.
 *   Forecast reliability    10 pts — accountHealth's Forecast reliability, rescaled 15→10.
 *   Emergency readiness     10 pts — NEW. See computeEmergencyReadiness() below.
 *   Goal diversification    10 pts — NEW. See computeGoalDiversification() below.
 *
 * Rescaling is a straight proportional scale of the *already-computed*
 * point value (e.g. consistencyPoints * 15/20) — the underlying formula
 * in accountHealth.ts is never re-derived here, only its weight in the
 * total changes.
 *
 * ── Tier bands (deliberately distinct from goalHealth/accountHealth's
 *    4-band scale — this is a separate, finer surface for the Sprint 28
 *    dashboard card, not a replacement for the existing one) ────────────
 *   Excellent        90–100
 *   Great             80–89
 *   Healthy           65–79
 *   Improving         50–64
 *   Needs Attention   30–49
 *   Critical           0–29
 */

import { computeAccountHealth, type AccountHealth, type AccountHealthInputs, type AccountHealthFactor } from "@/lib/accountHealth";
import type { SavingsGoal } from "@/lib/types";
import type { GoalCategory } from "@/lib/utils";

export type FinancialHealthTier = "Excellent" | "Great" | "Healthy" | "Improving" | "Needs Attention" | "Critical";

export interface FinancialHealthScore {
  score: number;
  tier: FinancialHealthTier;
  factors: AccountHealthFactor[];
  recommendations: string[];
  trend: AccountHealth["trend"];
}

const EMERGENCY_CATEGORY: GoalCategory = "emergency";

function tierForScore(score: number): FinancialHealthTier {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Great";
  if (score >= 65) return "Healthy";
  if (score >= 50) return "Improving";
  if (score >= 30) return "Needs Attention";
  return "Critical";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function rescale(factors: AccountHealthFactor[], name: string, newMax: number): { points: number; factor: AccountHealthFactor } {
  const original = factors.find((f) => f.name === name);
  if (!original) {
    // Defensive only — every name here is one accountHealth.ts has always
    // returned since Sprint 20. Never fabricate a score if that ever
    // changes; surface it as an honest zero with a clear explanation
    // instead of silently guessing.
    return {
      points: 0,
      factor: { name, points: 0, maxPoints: newMax, explanation: `"${name}" factor not found in account health — check lib/accountHealth.ts for a rename.` },
    };
  }
  const points = original.maxPoints === 0 ? 0 : (original.points / original.maxPoints) * newMax;
  return { points, factor: { name: original.name, points: round1(points), maxPoints: newMax, explanation: original.explanation } };
}

type GoalInput = Pick<SavingsGoal, "id" | "target_amount" | "current_amount" | "target_date" | "is_complete" | "category">;

/**
 * Emergency readiness (10 pts): does the user have a goal in the
 * "emergency" category, and how funded is it? A user with no emergency
 * fund goal at all scores 0 here (with a recommendation) rather than a
 * fabricated neutral default — an emergency fund either exists or it
 * doesn't, there's no honest "not enough data" middle ground the way
 * there is for e.g. consistency.
 */
function computeEmergencyReadiness(goals: GoalInput[]): { points: number; factor: AccountHealthFactor; recommendation: string | null } {
  const emergencyGoals = goals.filter((g) => g.category === EMERGENCY_CATEGORY);

  if (emergencyGoals.length === 0) {
    return {
      points: 0,
      factor: {
        name: "Emergency readiness",
        points: 0,
        maxPoints: 10,
        explanation: "No emergency fund goal set up yet.",
      },
      recommendation: "Consider starting an emergency fund goal — even a small one improves financial resilience.",
    };
  }

  // If there are several (unusual but possible), use the best-funded one —
  // readiness is about having *a* working safety net, not summing several.
  let bestRatio = 0;
  for (const g of emergencyGoals) {
    const target = Number(g.target_amount);
    if (target <= 0) continue;
    const ratio = Math.min(1, Number(g.current_amount) / target);
    if (ratio > bestRatio) bestRatio = ratio;
  }

  const points = bestRatio * 10;
  const percent = Math.round(bestRatio * 100);
  return {
    points,
    factor: {
      name: "Emergency readiness",
      points: round1(points),
      maxPoints: 10,
      explanation: `Emergency fund is ${percent}% funded.`,
    },
    recommendation: bestRatio < 0.5 ? "Your emergency fund is under halfway funded — consider prioritizing it." : null,
  };
}

/**
 * Goal diversification (10 pts): number of distinct categories among the
 * user's active goals. Scaled linearly, 1 category → 2.5 pts, 4+
 * categories → full 10 pts. Completed/inactive goals aren't counted —
 * this measures current spread of *active* saving effort, not history.
 */
function computeGoalDiversification(goals: GoalInput[]): { points: number; factor: AccountHealthFactor } {
  const activeGoals = goals.filter((g) => !g.is_complete);
  if (activeGoals.length === 0) {
    return {
      points: 0,
      factor: { name: "Goal diversification", points: 0, maxPoints: 10, explanation: "No active goals to measure diversification against." },
    };
  }

  const categories = new Set(activeGoals.map((g) => g.category));
  const points = Math.min(10, (categories.size / 4) * 10);
  return {
    points,
    factor: {
      name: "Goal diversification",
      points: round1(points),
      maxPoints: 10,
      explanation: `Active goals span ${categories.size} categor${categories.size === 1 ? "y" : "ies"}.`,
    },
  };
}

export interface FinancialHealthInputs extends Omit<AccountHealthInputs, "goals"> {
  goals: GoalInput[];
  /**
   * Sprint 28.5 — Phase 8 (Performance): optional. If the caller already
   * computed AccountHealth for these exact inputs (e.g.
   * lib/intelligence/getFinancialIntelligence.ts, which needs its own
   * `accountHealth` field for lib/interventions.ts too), pass it here to
   * skip a second, otherwise-identical computeAccountHealth() call.
   * Omit it and this function computes it internally exactly as before —
   * every existing caller (including every test) keeps working unchanged.
   */
  accountHealth?: AccountHealth;
}

export function computeFinancialHealthScore(inputs: FinancialHealthInputs): FinancialHealthScore {
  const base = inputs.accountHealth ?? computeAccountHealth(inputs);

  const consistency = rescale(base.factors, "Consistency", 15);
  const growth = rescale(base.factors, "Savings growth", 15);
  const progress = rescale(base.factors, "Goal completion", 15);
  const regularity = rescale(base.factors, "Deposit frequency", 10);
  const momentum = rescale(base.factors, "Momentum", 15);
  const forecastReliability = rescale(base.factors, "Forecast reliability", 10);
  const emergency = computeEmergencyReadiness(inputs.goals);
  const diversification = computeGoalDiversification(inputs.goals);

  const factors: AccountHealthFactor[] = [
    consistency.factor,
    { ...growth.factor, name: "Savings growth & trend" },
    { ...progress.factor, name: "Goal progress" },
    { ...regularity.factor, name: "Deposit regularity" },
    momentum.factor,
    forecastReliability.factor,
    emergency.factor,
    diversification.factor,
  ];

  const score = Math.round(factors.reduce((s, f) => s + f.points, 0));

  const recommendations = [...base.recommendations];
  if (emergency.recommendation) recommendations.unshift(emergency.recommendation);

  return {
    score: Math.max(0, Math.min(100, score)),
    tier: tierForScore(score),
    factors,
    recommendations: recommendations.slice(0, 4),
    trend: base.trend,
  };
}
