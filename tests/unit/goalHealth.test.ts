/**
 * tests/unit/goalHealth.test.ts
 * Sprint 19 — Phase 11.
 */
import { describe, it, expect } from "vitest";
import { computeGoalHealth } from "@/lib/goalHealth";
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

function goal(overrides: Partial<SavingsGoal>): Pick<SavingsGoal, "id" | "target_amount" | "current_amount" | "target_date" | "is_complete"> {
  return {
    id: "g1",
    target_amount: 1000,
    current_amount: 200,
    target_date: null,
    is_complete: false,
    ...overrides,
  };
}

describe("computeGoalHealth", () => {
  it("scores a completed goal as Excellent (100) trivially", () => {
    const result = computeGoalHealth(goal({ is_complete: true }), []);
    expect(result.score).toBe(100);
    expect(result.status).toBe("Excellent");
  });

  it("always totals exactly the sum of its own factor points, and stays within 0-100", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const txs = [
      tx({ created_at: "2026-02-01T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
    ];
    const result = computeGoalHealth(goal({}), txs, now);
    const sum = Math.round(result.factors.reduce((s, f) => s + f.points, 0));
    expect(result.score).toBe(sum);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("redistributes the 25 velocity points across other factors when there's no target_date", () => {
    const result = computeGoalHealth(goal({ target_date: null }), []);
    const maxTotal = result.factors.reduce((s, f) => s + f.maxPoints, 0);
    expect(maxTotal).toBe(100);
    const velocity = result.factors.find((f) => f.name === "Progress velocity")!;
    expect(velocity.maxPoints).toBe(0);
  });

  it("keeps maxPoints summing to 100 when a target_date IS set", () => {
    const result = computeGoalHealth(goal({ target_date: "2026-06-01" }), []);
    const maxTotal = result.factors.reduce((s, f) => s + f.maxPoints, 0);
    expect(maxTotal).toBe(100);
    const velocity = result.factors.find((f) => f.name === "Progress velocity")!;
    expect(velocity.maxPoints).toBe(25);
  });

  it("scores a stale, inactive goal lower than a recently and consistently funded one", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const activeTxs = [
      tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-22T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-28T00:00:00Z", amount: 100 }),
    ];
    const staleTxs = [tx({ created_at: "2025-10-01T00:00:00Z", amount: 100 })];

    const activeHealth = computeGoalHealth(goal({}), activeTxs, now);
    const staleHealth = computeGoalHealth(goal({}), staleTxs, now);
    expect(activeHealth.score).toBeGreaterThan(staleHealth.score);
  });

  it("penalises a goal approaching its deadline with low progress", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const closeAndBehind = computeGoalHealth(
      goal({ current_amount: 100, target_amount: 1000, target_date: "2026-03-15" }),
      [],
      now
    );
    const farAndBehind = computeGoalHealth(
      goal({ current_amount: 100, target_amount: 1000, target_date: "2027-01-01" }),
      [],
      now
    );
    const deadlineFactorClose = closeAndBehind.factors.find((f) => f.name === "Deadline pressure")!;
    const deadlineFactorFar = farAndBehind.factors.find((f) => f.name === "Deadline pressure")!;
    expect(deadlineFactorClose.points).toBeLessThan(deadlineFactorFar.points);
  });
});
