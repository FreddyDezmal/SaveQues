/**
 * tests/unit/categoryIntelligence.test.ts
 * Sprint 24 — Phase 8: Category Intelligence.
 */
import { describe, it, expect } from "vitest";
import { computeCategoryIntelligence, isLikelyStalled } from "@/lib/categoryIntelligence";
import type { Transaction, SavingsGoal } from "@/lib/types";

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

function goal(overrides: Partial<SavingsGoal>): SavingsGoal {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    user_id: "u1",
    title: "Goal",
    category: "travel",
    goal_emoji: "✈️",
    target_amount: 1000,
    current_amount: 0,
    target_date: null,
    is_complete: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeCategoryIntelligence", () => {
  it("attributes totalSaved and percentOfTotalSaved correctly across categories", () => {
    const goals = [goal({ id: "g1", category: "travel" }), goal({ id: "g2", category: "home" })];
    const txs = [
      tx({ goal_id: "g1", amount: 300, created_at: "2026-02-01T00:00:00Z" }),
      tx({ goal_id: "g2", amount: 100, created_at: "2026-02-02T00:00:00Z" }),
    ];
    const result = computeCategoryIntelligence(goals, txs);
    const travel = result.categories.find((c) => c.categoryId === "travel")!;
    const home = result.categories.find((c) => c.categoryId === "home")!;

    expect(travel.totalSaved).toBe(300);
    expect(home.totalSaved).toBe(100);
    expect(travel.percentOfTotalSaved).toBeCloseTo(75, 5);
    expect(home.percentOfTotalSaved).toBeCloseTo(25, 5);
    expect(result.topSavingCategory).toBe("travel");
  });

  it("only counts deposits, ignoring withdrawals/goal_purchases/adjustments, per goal category", () => {
    const goals = [goal({ id: "g1", category: "gadget" })];
    const txs = [
      tx({ goal_id: "g1", amount: 500, transaction_type: "deposit" }),
      tx({ goal_id: "g1", amount: 200, transaction_type: "withdrawal" }),
    ];
    const result = computeCategoryIntelligence(goals, txs);
    const gadget = result.categories.find((c) => c.categoryId === "gadget")!;
    expect(gadget.totalSaved).toBe(500);
    expect(gadget.depositCount).toBe(1);
  });

  it("returns null aggregate fields (not zeros or NaN) when there is no data at all", () => {
    const result = computeCategoryIntelligence([], []);
    expect(result.topSavingCategory).toBeNull();
    expect(result.fastestCompletingCategory).toBeNull();
    expect(result.mostStalledCategory).toBeNull();
    for (const c of result.categories) {
      expect(c.percentOfTotalSaved).toBe(0);
      expect(c.medianDaysToComplete).toBeNull();
      expect(Number.isNaN(c.percentOfTotalSaved)).toBe(false);
    }
  });

  it("computes medianDaysToComplete using the goal-creation-to-latest-deposit proxy, and identifies the fastest category", () => {
    const goals = [
      goal({ id: "g1", category: "travel", is_complete: true, created_at: "2026-01-01T00:00:00Z" }),
      goal({ id: "g2", category: "home", is_complete: true, created_at: "2026-01-01T00:00:00Z" }),
    ];
    const txs = [
      tx({ goal_id: "g1", created_at: "2026-01-11T00:00:00Z" }), // 10 days
      tx({ goal_id: "g2", created_at: "2026-02-01T00:00:00Z" }), // 31 days
    ];
    const result = computeCategoryIntelligence(goals, txs);
    expect(result.categories.find((c) => c.categoryId === "travel")!.medianDaysToComplete).toBe(10);
    expect(result.categories.find((c) => c.categoryId === "home")!.medianDaysToComplete).toBe(31);
    expect(result.fastestCompletingCategory).toBe("travel");
  });

  it("excludes complete goals from likelyStalledCount even if long-inactive", () => {
    const g = goal({ id: "g1", category: "home", is_complete: true, created_at: "2020-01-01T00:00:00Z" });
    const result = computeCategoryIntelligence([g], [], new Date("2026-06-01T00:00:00Z"));
    expect(result.categories.find((c) => c.categoryId === "home")!.likelyStalledCount).toBe(0);
  });

  it("counts an incomplete goal with no recent deposits as likely stalled after the inactivity window", () => {
    const g = goal({ id: "g1", category: "home", is_complete: false, created_at: "2026-01-01T00:00:00Z" });
    const txs = [tx({ goal_id: "g1", created_at: "2026-01-05T00:00:00Z" })]; // last activity Jan 5
    const now = new Date("2026-06-01T00:00:00Z"); // ~147 days later, well past the 60-day threshold
    expect(isLikelyStalled(g, txs, now)).toBe(true);

    const result = computeCategoryIntelligence([g], txs, now);
    expect(result.categories.find((c) => c.categoryId === "home")!.likelyStalledCount).toBe(1);
    expect(result.mostStalledCategory).toBe("home");
  });

  it("does not flag a recently-active incomplete goal as stalled", () => {
    const g = goal({ id: "g1", category: "home", is_complete: false, created_at: "2026-01-01T00:00:00Z" });
    const txs = [tx({ goal_id: "g1", created_at: "2026-05-25T00:00:00Z" })];
    const now = new Date("2026-06-01T00:00:00Z"); // 7 days since last activity
    expect(isLikelyStalled(g, txs, now)).toBe(false);
  });
});
