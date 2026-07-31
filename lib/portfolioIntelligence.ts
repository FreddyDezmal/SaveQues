/**
 * lib/portfolioIntelligence.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 28.5 — Phase 5: Portfolio Intelligence.
 *
 * AUDIT NOTE: lib/portfolioSummary.ts (Sprint 20) already exists and is
 * already wired into app/(app)/portfolio/page.tsx — it's explicit in its
 * own docstring that it's "pure aggregation... deliberately does not add
 * any new statistics." This file is NOT a second version of that. It
 * answers questions portfolioSummary.ts structurally can't: every field
 * there is a single portfolio-wide number computed by an existing
 * portfolio-scoped engine (computeAccountHealth, buildMonthlyReport,
 * computeFinancialPersonality). "Which of my goals is strongest" and
 * "when will my last active goal finish" require running a *per-goal*
 * engine (lib/goalHealth.ts, lib/forecast.ts) once per goal and comparing
 * — a shape of computation nothing existing does at portfolio scope.
 *
 * Everything this file can get from an existing portfolio-scoped module
 * without recomputing, it takes as a parameter instead of calling the
 * engine itself:
 *   - Diversification comes from lib/categoryIntelligence.ts's own
 *     `categories[].activeGoalCount` — not recounted here.
 *   - Quarter projection comes from lib/cashFlowProjection.ts's own
 *     `projectedBalanceQuarter`/`projectedAdditionalSavingsQuarter` —
 *     not recomputed here.
 * The caller (app/(app)/portfolio/page.tsx) already computes both for
 * other reasons, so this function takes them as inputs rather than importing
 * and re-running those modules a second time.
 */

import { computeGoalHealth, type GoalHealthStatus } from "@/lib/goalHealth";
import { forecastGoal } from "@/lib/forecast";
import type { CategoryIntelligence } from "@/lib/categoryIntelligence";
import type { CashFlowProjection } from "@/lib/cashFlowProjection";
import type { SavingsGoal, Transaction } from "@/lib/types";

type GoalInput = Pick<SavingsGoal, "id" | "title" | "target_amount" | "current_amount" | "target_date" | "is_complete">;

export interface GoalHealthRanking {
  goalId: string;
  title: string;
  score: number;
  status: GoalHealthStatus;
  explanation: string;
}

export interface PortfolioCompletionForecast {
  goalId: string;
  title: string;
  projectedCompletionDate: string;
}

export interface PortfolioOpportunity {
  goalId: string;
  title: string;
  reason: string;
}

export interface PortfolioIntelligence {
  /** Highest-scoring active goal by lib/goalHealth.ts's own score, or null if there are no active goals. */
  strongestGoal: GoalHealthRanking | null;
  /** Lowest-scoring active goal, or null. Same goal as strongestGoal only when there's exactly one active goal. */
  weakestGoal: GoalHealthRanking | null;
  /** Straight from categoryIntelligence — see this file's own docstring for why it isn't recomputed. */
  diversification: {
    activeCategoryCount: number;
    totalCategoryCount: number;
    explanation: string;
  };
  /** Straight from cashFlowProjection — see this file's own docstring. */
  quarterProjection: {
    projectedBalance: number | null;
    projectedAdditionalSavings: number | null;
    explanation: string;
  };
  /**
   * The active goal with the LATEST projected completion date among goals
   * that have one — i.e. "assuming every active goal keeps its own current
   * pace, this is the last one still running." Null if no active goal has
   * enough deposit history to project a date yet.
   */
  completionForecast: PortfolioCompletionForecast | null;
  /**
   * The active goal projected to finish SOONEST — framed as an
   * opportunity because finishing it frees up whatever capacity was going
   * toward it for other goals. Deliberately not a duplicate of
   * `strongestGoal`: a goal can be nearly done (soonest completion)
   * without having this portfolio's best consistency/frequency/velocity
   * score, and vice versa.
   */
  opportunity: PortfolioOpportunity | null;
}

export interface PortfolioIntelligenceInputs {
  goals: GoalInput[];
  transactions: Transaction[];
  categoryIntelligence: CategoryIntelligence;
  cashFlow: CashFlowProjection;
  now?: Date;
}

export function computePortfolioIntelligence(inputs: PortfolioIntelligenceInputs): PortfolioIntelligence {
  const now = inputs.now ?? new Date();
  const activeGoals = inputs.goals.filter((g) => !g.is_complete);

  const transactionsByGoal: Record<string, Transaction[]> = {};
  for (const t of inputs.transactions) {
    (transactionsByGoal[t.goal_id] ??= []).push(t);
  }

  const rankings: GoalHealthRanking[] = activeGoals.map((g) => {
    const health = computeGoalHealth(g, transactionsByGoal[g.id] ?? [], now);
    const weakestFactor = [...health.factors].sort((a, b) => a.points / a.maxPoints - b.points / b.maxPoints)[0];
    return {
      goalId: g.id,
      title: g.title,
      score: health.score,
      status: health.status,
      explanation: weakestFactor?.explanation ?? `Goal health score: ${health.score}/100.`,
    };
  });

  let strongestGoal: GoalHealthRanking | null = null;
  let weakestGoal: GoalHealthRanking | null = null;
  for (const r of rankings) {
    if (!strongestGoal || r.score > strongestGoal.score) strongestGoal = r;
    if (!weakestGoal || r.score < weakestGoal.score) weakestGoal = r;
  }

  const activeCategoryCount = inputs.categoryIntelligence.categories.filter((c) => c.activeGoalCount > 0).length;
  const totalCategoryCount = inputs.categoryIntelligence.categories.length;
  const diversification = {
    activeCategoryCount,
    totalCategoryCount,
    explanation:
      activeCategoryCount === 0
        ? "No active goals yet to measure spread across categories."
        : activeCategoryCount === 1
          ? "All active goals are in a single category."
          : `Active goals span ${activeCategoryCount} of ${totalCategoryCount} categories.`,
  };

  const quarterProjection = {
    projectedBalance: inputs.cashFlow.projectedBalanceQuarter,
    projectedAdditionalSavings: inputs.cashFlow.projectedAdditionalSavingsQuarter,
    explanation:
      inputs.cashFlow.insufficientDataReason ??
      `At your recent pace, projected balance in 90 days.`,
  };

  const forecasts = activeGoals
    .map((g) => ({ goal: g, forecast: forecastGoal(g, transactionsByGoal[g.id] ?? [], now) }))
    .filter((f) => f.forecast.projectedCompletionDate !== null);

  let completionForecast: PortfolioCompletionForecast | null = null;
  let opportunity: PortfolioOpportunity | null = null;
  let opportunitySoonestDate = "9999-99-99";
  for (const f of forecasts) {
    const date = f.forecast.projectedCompletionDate as string;
    if (!completionForecast || date > completionForecast.projectedCompletionDate) {
      completionForecast = { goalId: f.goal.id, title: f.goal.title, projectedCompletionDate: date };
    }
    if (!opportunity || date < opportunitySoonestDate) {
      opportunitySoonestDate = date;
      opportunity = {
        goalId: f.goal.id,
        title: f.goal.title,
        reason: `Projected to finish ${date} — the soonest of your active goals at current pace.`,
      };
    }
  }

  return { strongestGoal, weakestGoal, diversification, quarterProjection, completionForecast, opportunity };
}
