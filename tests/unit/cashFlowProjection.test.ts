/**
 * tests/unit/cashFlowProjection.test.ts
 * Sprint 28 — Phase 10/15.
 */
import { describe, it, expect } from "vitest";
import { projectCashFlow, lifetimeDeposited } from "@/lib/cashFlowProjection";
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

const now = new Date("2026-03-01T00:00:00Z");
const weeklyDeposits = [
  tx({ created_at: "2026-02-01T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-08T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-22T00:00:00Z", amount: 100 }),
];

describe("projectCashFlow", () => {
  it("reports insufficient data with no deposit history", () => {
    const result = projectCashFlow([], [], now);
    expect(result.weeklyPace).toBeNull();
    expect(result.insufficientDataReason).toMatch(/no deposits/i);
    expect(result.projectedBalanceQuarter).toBeNull();
  });

  it("sums current_amount across goals for currentBalance, independent of pace data", () => {
    const goals = [
      { id: "g1", target_amount: 1000, current_amount: 300, is_complete: false },
      { id: "g2", target_amount: 500, current_amount: 500, is_complete: true },
    ];
    const result = projectCashFlow([], goals, now);
    expect(result.currentBalance).toBe(800);
  });

  it("projects 30/60/90-day additional savings proportionally from weekly pace", () => {
    const result = projectCashFlow(weeklyDeposits, [], now);
    expect(result.weeklyPace).not.toBeNull();
    expect(result.projectedAdditionalSavings30Day).not.toBeNull();
    expect(result.projectedAdditionalSavingsQuarter).not.toBeNull();
    // Quarter (90 days) window should project roughly 3x the 30-day window.
    expect(result.projectedAdditionalSavingsQuarter!).toBeCloseTo(result.projectedAdditionalSavings30Day! * 3, 0);
  });

  it("adds projected additional savings on top of currentBalance for projected balances", () => {
    const goals = [{ id: "g1", target_amount: 1000, current_amount: 200, is_complete: false }];
    const result = projectCashFlow(weeklyDeposits, goals, now);
    expect(result.projectedBalance30Day).toBeCloseTo(result.currentBalance + result.projectedAdditionalSavings30Day!, 5);
  });

  it("lists active goals fundable within the quarter without double-counting across goals in its own explanation", () => {
    const goals = [
      { id: "small", target_amount: 250, current_amount: 200, is_complete: false }, // remaining 50, easily fundable
      { id: "huge", target_amount: 100000, current_amount: 0, is_complete: false }, // not fundable
    ];
    const result = projectCashFlow(weeklyDeposits, goals, now);
    const ids = result.fundableWithinQuarter.map((g) => g.goalId);
    expect(ids).toContain("small");
    expect(ids).not.toContain("huge");
  });

  it("excludes completed and zero-remaining goals from fundableWithinQuarter", () => {
    const goals = [
      { id: "done", target_amount: 100, current_amount: 100, is_complete: true },
      { id: "already-there", target_amount: 100, current_amount: 100, is_complete: false },
    ];
    const result = projectCashFlow(weeklyDeposits, goals, now);
    expect(result.fundableWithinQuarter).toHaveLength(0);
  });
});

describe("lifetimeDeposited", () => {
  it("sums only deposit-type transactions", () => {
    const txs = [
      tx({ amount: 100, transaction_type: "deposit" }),
      tx({ amount: 50, transaction_type: "withdrawal" }),
      tx({ amount: 200, transaction_type: "deposit" }),
    ];
    expect(lifetimeDeposited(txs)).toBe(300);
  });
});
