/**
 * tests/unit/recommendations.test.ts
 * Sprint 20 — Phase 12.
 */
import { describe, it, expect } from "vitest";
import { generateGoalRecommendations } from "@/lib/recommendations";
import type { Transaction } from "@/lib/types";

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    user_id: "u1",
    goal_id: "g1",
    amount: 200,
    note: null,
    transaction_type: "deposit",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("generateGoalRecommendations", () => {
  it("excludes categories the user already has a goal in", () => {
    const recs = generateGoalRecommendations({
      transactions: [],
      goals: [{ id: "g1", category: "emergency", is_complete: false }],
    });
    expect(recs.find((r) => r.category === "emergency")).toBeUndefined();
  });

  it("returns at most maxResults recommendations", () => {
    const recs = generateGoalRecommendations({ transactions: [], goals: [], maxResults: 2 });
    expect(recs.length).toBeLessThanOrEqual(2);
  });

  it("every recommendation has a positive target, duration, and weekly saving", () => {
    const recs = generateGoalRecommendations({ transactions: [], goals: [], maxResults: 9 });
    for (const r of recs) {
      expect(r.suggestedTarget).toBeGreaterThan(0);
      expect(r.suggestedDurationWeeks).toBeGreaterThan(0);
      expect(r.suggestedWeeklySaving).toBeGreaterThan(0);
    }
  });

  it("sorts easiest recommendations first", () => {
    const txs = [tx({ id: "1", amount: 500 }), tx({ id: "2", amount: 500, created_at: "2026-02-01T00:00:00Z" })];
    const recs = generateGoalRecommendations({ transactions: txs, goals: [], maxResults: 9 });
    const order: Record<string, number> = { easy: 0, moderate: 1, ambitious: 2 };
    const difficulties = recs.map((r) => order[r.difficulty]);
    expect(difficulties).toEqual([...difficulties].sort((a, b) => a - b));
  });
});
