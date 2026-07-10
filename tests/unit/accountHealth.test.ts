/**
 * tests/unit/accountHealth.test.ts
 * Sprint 20 — Phase 12.
 */
import { describe, it, expect } from "vitest";
import { computeAccountHealth } from "@/lib/accountHealth";
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

describe("computeAccountHealth", () => {
  it("keeps factor maxPoints summing to exactly 100", () => {
    const result = computeAccountHealth({ transactions: [], goals: [], activityLog: [] });
    const maxTotal = result.factors.reduce((s, f) => s + f.maxPoints, 0);
    expect(maxTotal).toBe(100);
  });

  it("keeps score within 0-100 and consistent with its own factor sum", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const txs = [
      tx({ created_at: "2026-02-01T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-08T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-22T00:00:00Z", amount: 100 }),
    ];
    const result = computeAccountHealth({
      transactions: txs,
      goals: [{ id: "g1", target_amount: 1000, current_amount: 400, target_date: "2026-06-01", is_complete: false }],
      activityLog: [],
      now,
    });
    const sum = Math.round(result.factors.reduce((s, f) => s + f.points, 0));
    expect(result.score).toBe(sum);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("caps recommendations at 3", () => {
    const result = computeAccountHealth({
      transactions: [],
      goals: [],
      activityLog: [],
    });
    expect(result.recommendations.length).toBeLessThanOrEqual(3);
  });

  it("reports an 'unknown' trend with no prior-period data", () => {
    const result = computeAccountHealth({ transactions: [], goals: [], activityLog: [] });
    expect(result.trend).toBe("unknown");
  });
});
