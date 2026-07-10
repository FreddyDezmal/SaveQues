/**
 * tests/unit/insights.test.ts
 * Sprint 19 — Phase 11.
 */
import { describe, it, expect } from "vitest";
import { generateInsights } from "@/lib/insights";
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

describe("generateInsights", () => {
  it("returns an empty array for a brand-new user with no deposits", () => {
    expect(generateInsights([])).toEqual([]);
  });

  it("suppresses the average-deposit insight below 3 deposits", () => {
    const insights = generateInsights([tx({ id: "1" }), tx({ id: "2" })]);
    expect(insights.find((i) => i.type === "average_deposit")).toBeUndefined();
  });

  it("includes an average-deposit insight with 3+ deposits, with the correct amount", () => {
    const insights = generateInsights(
      [tx({ id: "1", amount: 100 }), tx({ id: "2", amount: 200 }), tx({ id: "3", amount: 300 })],
      { currencyCode: "USD", locale: "en-US" }
    );
    const avg = insights.find((i) => i.type === "average_deposit");
    expect(avg).toBeDefined();
    expect(avg!.message).toContain("200");
  });

  it("never fabricates a favorite-day insight from fewer than 5 deposits", () => {
    const insights = generateInsights([
      tx({ id: "1", created_at: "2026-03-06T00:00:00Z" }),
      tx({ id: "2", created_at: "2026-03-13T00:00:00Z" }),
    ]);
    expect(insights.find((i) => i.type === "favorite_day")).toBeUndefined();
  });

  it("does not report a trend change with no history in the previous period", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const insights = generateInsights(
      [tx({ id: "1", amount: 100, created_at: "2026-03-10T00:00:00Z" })],
      { now }
    );
    expect(insights.find((i) => i.type === "trend_change")).toBeUndefined();
  });
});
