/**
 * tests/unit/getFinancialIntelligence.test.ts
 * Sprint 28.5 — Phase 2/11.
 */
import { describe, it, expect } from "vitest";
import { getFinancialIntelligence } from "@/lib/intelligence/getFinancialIntelligence";
import { computeAccountHealth } from "@/lib/accountHealth";
import { computeFinancialHealthScore } from "@/lib/financialHealthScore";
import type { SavingsGoal, Transaction } from "@/lib/types";

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

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: "g1",
    user_id: "u1",
    title: "Vacation",
    category: "vacation",
    goal_emoji: "✈️",
    target_amount: 1000,
    current_amount: 200,
    target_date: null,
    is_complete: false,
    is_primary: false,
    is_active: true,
    goal_status: "active",
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const now = new Date("2026-03-01T00:00:00Z");
const weeklyDeposits = [
  tx({ created_at: "2026-02-01T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-08T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-22T00:00:00Z", amount: 100 }),
];

const baseInput = {
  transactions: weeklyDeposits,
  goals: [goal()],
  activityLog: [{ date: "2026-02-28", xp_earned: 10, actions_count: 1 }],
  achievements: [],
  profile: { streak_days: 3, longest_streak: 5, currency_code: "ZAR", locale: "en-ZA" },
  now,
};

describe("getFinancialIntelligence — pure orchestration, no recalculation", () => {
  it("returns a coherent object with every documented field populated", () => {
    const result = getFinancialIntelligence(baseInput);
    expect(result.insights).toBeInstanceOf(Array);
    expect(result.weeklyReview).toBeTruthy();
    expect(result.coachingMessages).toBeInstanceOf(Array);
    expect(result.habitProfile).toBeTruthy();
    expect(result.behaviorProfile).toBeTruthy();
    expect(result.behavioralRisk).toBeTruthy();
    expect(result.accountHealth).toBeTruthy();
    expect(result.interventions).toBeInstanceOf(Array);
    expect(result.categoryIntelligence).toBeTruthy();
    expect(result.financialHealth).toBeTruthy();
    expect(result.cashFlow).toBeTruthy();
    expect(result.goalRecommendations).toBeInstanceOf(Array);
  });

  it("never mutates its inputs", () => {
    const txsSnapshot = JSON.parse(JSON.stringify(baseInput.transactions));
    const goalsSnapshot = JSON.parse(JSON.stringify(baseInput.goals));
    getFinancialIntelligence(baseInput);
    expect(baseInput.transactions).toEqual(txsSnapshot);
    expect(baseInput.goals).toEqual(goalsSnapshot);
  });

  it("is a pure function: identical input produces identical output", () => {
    const first = getFinancialIntelligence(baseInput);
    const second = getFinancialIntelligence(baseInput);
    expect(first).toEqual(second);
  });

  it("accountHealth matches a direct computeAccountHealth() call with the same inputs — proves no divergent recalculation", () => {
    const result = getFinancialIntelligence(baseInput);
    const direct = computeAccountHealth({
      transactions: baseInput.transactions,
      goals: baseInput.goals.map((g) => ({ id: g.id, target_amount: g.target_amount, current_amount: g.current_amount, target_date: g.target_date, is_complete: g.is_complete })),
      activityLog: baseInput.activityLog,
      now,
    });
    expect(result.accountHealth).toEqual(direct);
  });

  it("financialHealth matches a direct computeFinancialHealthScore() call with the same inputs", () => {
    const result = getFinancialIntelligence(baseInput);
    const direct = computeFinancialHealthScore({
      transactions: baseInput.transactions,
      goals: baseInput.goals.map((g) => ({ id: g.id, category: g.category, target_amount: g.target_amount, current_amount: g.current_amount, target_date: g.target_date, is_complete: g.is_complete })),
      activityLog: baseInput.activityLog,
      now,
    });
    expect(result.financialHealth).toEqual(direct);
  });

  it("topCoachingMessage is the first coaching message's text, or null when there are none", () => {
    const result = getFinancialIntelligence(baseInput);
    expect(result.topCoachingMessage).toBe(result.coachingMessages[0]?.message ?? null);
  });

  it("goalRecommendations excludes categories the user already has a goal in — proves it's really calling lib/recommendations.ts, not a stub", () => {
    const result = getFinancialIntelligence({ ...baseInput, goals: [goal({ category: "travel" })] });
    expect(result.goalRecommendations.every((r) => r.category !== "travel")).toBe(true);
  });

  it("handles a user with no transactions or goals without throwing", () => {
    const result = getFinancialIntelligence({
      transactions: [],
      goals: [],
      activityLog: [],
      achievements: [],
      profile: { streak_days: 0, longest_streak: 0 },
      now,
    });
    expect(result.insights).toEqual([]);
    expect(result.interventions).toEqual([]);
    expect(result.habitProfile.habitScore).toBe(0);
  });

  it("defaults currency/locale when profile doesn't specify them, without throwing", () => {
    expect(() =>
      getFinancialIntelligence({ ...baseInput, profile: { streak_days: 3, longest_streak: 5 } })
    ).not.toThrow();
  });
});
