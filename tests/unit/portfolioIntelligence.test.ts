/**
 * tests/unit/portfolioIntelligence.test.ts
 * Sprint 28.5 — Phase 5/11.
 */
import { describe, it, expect } from "vitest";
import { computePortfolioIntelligence } from "@/lib/portfolioIntelligence";
import type { CategoryIntelligence } from "@/lib/categoryIntelligence";
import type { CashFlowProjection } from "@/lib/cashFlowProjection";
import type { Transaction } from "@/lib/types";

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    user_id: "u1",
    goal_id: "g1",
    amount: 100,
    note: null,
    transaction_type: "deposit",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function goal(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    title: "Goal",
    target_amount: 1000,
    current_amount: 200,
    target_date: null,
    is_complete: false,
    ...overrides,
  };
}

function categoryIntelligence(overrides: Partial<CategoryIntelligence> = {}): CategoryIntelligence {
  return {
    categories: [
      { categoryId: "travel", activeGoalCount: 1, completedGoalCount: 0, totalSaved: 500, medianDaysToComplete: null, likelyStalledCount: 0 } as any,
      { categoryId: "emergency", activeGoalCount: 0, completedGoalCount: 0, totalSaved: 0, medianDaysToComplete: null, likelyStalledCount: 0 } as any,
    ],
    topSavingCategory: "travel",
    fastestCompletingCategory: null,
    mostStalledCategory: null,
    ...overrides,
  };
}

function cashFlow(overrides: Partial<CashFlowProjection> = {}): CashFlowProjection {
  return {
    currentBalance: 500,
    weeklyPace: 100,
    projectedAdditionalSavings30Day: 400,
    projectedAdditionalSavings60Day: 800,
    projectedAdditionalSavingsQuarter: 1200,
    projectedBalance30Day: 900,
    projectedBalance60Day: 1300,
    projectedBalanceQuarter: 1700,
    fundableWithinQuarter: [],
    insufficientDataReason: null,
    ...overrides,
  };
}

const now = new Date("2026-03-01T00:00:00Z");
const weeklyDeposits = (goalId: string) => [
  tx({ goal_id: goalId, created_at: "2026-02-01T00:00:00Z", amount: 100 }),
  tx({ goal_id: goalId, created_at: "2026-02-08T00:00:00Z", amount: 100 }),
  tx({ goal_id: goalId, created_at: "2026-02-15T00:00:00Z", amount: 100 }),
  tx({ goal_id: goalId, created_at: "2026-02-22T00:00:00Z", amount: 100 }),
];

describe("computePortfolioIntelligence — strongest/weakest goal", () => {
  it("returns null for both when there are no active goals", () => {
    const result = computePortfolioIntelligence({
      goals: [],
      transactions: [],
      categoryIntelligence: categoryIntelligence(),
      cashFlow: cashFlow(),
      now,
    });
    expect(result.strongestGoal).toBeNull();
    expect(result.weakestGoal).toBeNull();
  });

  it("picks the highest and lowest goalHealth score among active goals", () => {
    const goals = [
      goal({ id: "strong", title: "Strong Goal", current_amount: 900, target_amount: 1000 }),
      goal({ id: "weak", title: "Weak Goal", current_amount: 10, target_amount: 1000 }),
    ];
    const transactions = [...weeklyDeposits("strong")];
    const result = computePortfolioIntelligence({
      goals,
      transactions,
      categoryIntelligence: categoryIntelligence(),
      cashFlow: cashFlow(),
      now,
    });
    expect(result.strongestGoal?.goalId).toBe("strong");
    expect(result.weakestGoal?.goalId).toBe("weak");
    expect(result.strongestGoal!.score).toBeGreaterThan(result.weakestGoal!.score);
  });

  it("excludes completed goals from the ranking", () => {
    const goals = [goal({ id: "done", is_complete: true, current_amount: 1000 })];
    const result = computePortfolioIntelligence({
      goals,
      transactions: [],
      categoryIntelligence: categoryIntelligence(),
      cashFlow: cashFlow(),
      now,
    });
    expect(result.strongestGoal).toBeNull();
  });

  it("every ranking includes a non-empty explanation, never a bare number", () => {
    const goals = [goal({ id: "g1" })];
    const result = computePortfolioIntelligence({
      goals,
      transactions: weeklyDeposits("g1"),
      categoryIntelligence: categoryIntelligence(),
      cashFlow: cashFlow(),
      now,
    });
    expect(result.strongestGoal!.explanation.length).toBeGreaterThan(0);
  });
});

describe("computePortfolioIntelligence — diversification (reused, not recomputed)", () => {
  it("passes through categoryIntelligence's own active category count, doesn't recount", () => {
    const result = computePortfolioIntelligence({
      goals: [],
      transactions: [],
      categoryIntelligence: categoryIntelligence(),
      cashFlow: cashFlow(),
      now,
    });
    expect(result.diversification.activeCategoryCount).toBe(1); // only "travel" has activeGoalCount > 0
    expect(result.diversification.totalCategoryCount).toBe(2);
  });

  it("explains a single-category spread distinctly from a zero-category spread", () => {
    const single = computePortfolioIntelligence({
      goals: [],
      transactions: [],
      categoryIntelligence: categoryIntelligence(),
      cashFlow: cashFlow(),
      now,
    });
    const zero = computePortfolioIntelligence({
      goals: [],
      transactions: [],
      categoryIntelligence: categoryIntelligence({
        categories: [{ categoryId: "travel", activeGoalCount: 0, completedGoalCount: 0, totalSaved: 0, medianDaysToComplete: null, likelyStalledCount: 0 } as any],
      }),
      cashFlow: cashFlow(),
      now,
    });
    expect(single.diversification.explanation).toMatch(/single category/i);
    expect(zero.diversification.explanation).toMatch(/no active goals/i);
  });
});

describe("computePortfolioIntelligence — quarter projection (reused, not recomputed)", () => {
  it("passes through cashFlow's own quarter figures unchanged", () => {
    const result = computePortfolioIntelligence({
      goals: [],
      transactions: [],
      categoryIntelligence: categoryIntelligence(),
      cashFlow: cashFlow({ projectedBalanceQuarter: 4242, projectedAdditionalSavingsQuarter: 999 }),
      now,
    });
    expect(result.quarterProjection.projectedBalance).toBe(4242);
    expect(result.quarterProjection.projectedAdditionalSavings).toBe(999);
  });

  it("surfaces cashFlow's own insufficientDataReason instead of a generic message when present", () => {
    const result = computePortfolioIntelligence({
      goals: [],
      transactions: [],
      categoryIntelligence: categoryIntelligence(),
      cashFlow: cashFlow({ insufficientDataReason: "No deposits recorded yet." }),
      now,
    });
    expect(result.quarterProjection.explanation).toBe("No deposits recorded yet.");
  });
});

describe("computePortfolioIntelligence — completion forecast & opportunity", () => {
  it("completionForecast picks the LATEST projected date among active goals", () => {
    const goals = [
      goal({ id: "soon", title: "Soon", current_amount: 950, target_amount: 1000 }),
      goal({ id: "later", title: "Later", current_amount: 50, target_amount: 5000 }),
    ];
    const transactions = [...weeklyDeposits("soon"), ...weeklyDeposits("later")];
    const result = computePortfolioIntelligence({
      goals,
      transactions,
      categoryIntelligence: categoryIntelligence(),
      cashFlow: cashFlow(),
      now,
    });
    expect(result.completionForecast?.goalId).toBe("later");
  });

  it("opportunity picks the SOONEST projected date — the inverse of completionForecast", () => {
    const goals = [
      goal({ id: "soon", title: "Soon", current_amount: 950, target_amount: 1000 }),
      goal({ id: "later", title: "Later", current_amount: 50, target_amount: 5000 }),
    ];
    const transactions = [...weeklyDeposits("soon"), ...weeklyDeposits("later")];
    const result = computePortfolioIntelligence({
      goals,
      transactions,
      categoryIntelligence: categoryIntelligence(),
      cashFlow: cashFlow(),
      now,
    });
    expect(result.opportunity?.goalId).toBe("soon");
    expect(result.opportunity?.goalId).not.toBe(result.completionForecast?.goalId);
  });

  it("returns null for both when no active goal has enough history to project a date", () => {
    const goals = [goal({ id: "g1" })];
    const result = computePortfolioIntelligence({
      goals,
      transactions: [],
      categoryIntelligence: categoryIntelligence(),
      cashFlow: cashFlow(),
      now,
    });
    expect(result.completionForecast).toBeNull();
    expect(result.opportunity).toBeNull();
  });
});
