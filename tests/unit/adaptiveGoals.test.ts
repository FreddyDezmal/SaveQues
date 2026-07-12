/**
 * tests/unit/adaptiveGoals.test.ts
 * Sprint 21 — Phase 15.
 */
import { describe, it, expect } from "vitest";
import { generateAdaptiveGoalRecommendations } from "@/lib/adaptiveGoals";
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

function goal(overrides: Partial<SavingsGoal>): Pick<SavingsGoal, "id" | "title" | "target_amount" | "current_amount" | "target_date" | "is_complete"> {
  return {
    id: "g1",
    title: "Test Goal",
    target_amount: 1000,
    current_amount: 200,
    target_date: null,
    is_complete: false,
    ...overrides,
  };
}

describe("generateAdaptiveGoalRecommendations", () => {
  it("returns no recommendations for a completed goal", () => {
    const result = generateAdaptiveGoalRecommendations({ goal: goal({ is_complete: true }), transactions: [] });
    expect(result).toEqual([]);
  });

  it("suggests increase_pace and extend_deadline when behind pace with a target date", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const txs = [
      tx({ created_at: "2026-02-01T00:00:00Z", amount: 50 }),
      tx({ created_at: "2026-02-15T00:00:00Z", amount: 50 }),
    ];
    // remaining = 800, target date 4 weeks out => required pace 200/week, actual pace ~25/week => behind
    const result = generateAdaptiveGoalRecommendations({
      goal: goal({ current_amount: 200, target_amount: 1000, target_date: "2026-03-29" }),
      transactions: txs,
      now,
    });
    const types = result.map((r) => r.type);
    expect(types).toContain("increase_pace");
    expect(types).toContain("extend_deadline");
  });

  it("every justification includes actual numbers, not a generic message", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const txs = [tx({ created_at: "2026-02-15T00:00:00Z", amount: 50 })];
    const result = generateAdaptiveGoalRecommendations({
      goal: goal({ current_amount: 200, target_amount: 1000, target_date: "2026-03-15" }),
      transactions: txs,
      now,
    });
    for (const r of result) {
      expect(r.justification).toMatch(/\d/);
    }
  });

  it("suggests a milestone_checkpoint for a goal under 25% progress", () => {
    const result = generateAdaptiveGoalRecommendations({
      goal: goal({ current_amount: 100, target_amount: 1000 }),
      transactions: [],
    });
    const checkpoint = result.find((r) => r.type === "milestone_checkpoint");
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.justification).toContain("25%");
  });

  it("does not suggest split_goal for a goal on track to finish soon", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const txs = [
      tx({ created_at: "2026-02-01T00:00:00Z", amount: 500 }),
      tx({ created_at: "2026-02-08T00:00:00Z", amount: 500 }),
    ];
    const result = generateAdaptiveGoalRecommendations({
      goal: goal({ current_amount: 900, target_amount: 1000 }),
      transactions: txs,
      now,
    });
    expect(result.find((r) => r.type === "split_goal")).toBeUndefined();
  });
});
