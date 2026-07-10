/**
 * tests/unit/heatmap.test.ts
 * Sprint 20 — Phase 12.
 */
import { describe, it, expect } from "vitest";
import { buildSavingsHeatmap, summarizeHeatmap } from "@/lib/heatmap";
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

describe("buildSavingsHeatmap", () => {
  it("produces exactly 30 cells for the 'month' range, all level 0 with no deposits", () => {
    const cells = buildSavingsHeatmap([], "month", new Date("2026-03-15T00:00:00Z"));
    expect(cells).toHaveLength(30);
    expect(cells.every((c) => c.level === 0)).toBe(true);
  });

  it("produces 90 cells for 'quarter' and 365 for 'year'", () => {
    expect(buildSavingsHeatmap([], "quarter", new Date("2026-03-15T00:00:00Z"))).toHaveLength(90);
    expect(buildSavingsHeatmap([], "year", new Date("2026-03-15T00:00:00Z"))).toHaveLength(365);
  });

  it("gives the day with the highest deposit total the highest level", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const txs = [
      tx({ id: "1", amount: 10, created_at: "2026-03-01T00:00:00Z" }),
      tx({ id: "2", amount: 50, created_at: "2026-03-05T00:00:00Z" }),
      tx({ id: "3", amount: 100, created_at: "2026-03-08T00:00:00Z" }),
      tx({ id: "4", amount: 500, created_at: "2026-03-10T00:00:00Z" }),
      tx({ id: "5", amount: 900, created_at: "2026-03-12T00:00:00Z" }),
    ];
    const cells = buildSavingsHeatmap(txs, "month", now);
    const best = cells.find((c) => c.date === "2026-03-12")!;
    const worst = cells.find((c) => c.date === "2026-03-01")!;
    expect(best.level).toBeGreaterThan(worst.level);
    expect(best.level).toBe(4);
  });

  it("never assigns a positive level to a day with no deposits", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const txs = [tx({ id: "1", amount: 100, created_at: "2026-03-10T00:00:00Z" })];
    const cells = buildSavingsHeatmap(txs, "month", now);
    const emptyDay = cells.find((c) => c.date === "2026-03-11")!;
    expect(emptyDay.level).toBe(0);
  });
});

describe("summarizeHeatmap", () => {
  it("computes activeDays/total/bestDay correctly", () => {
    const cells = [
      { date: "2026-03-01", amount: 0, level: 0 as const },
      { date: "2026-03-02", amount: 100, level: 2 as const },
      { date: "2026-03-03", amount: 300, level: 4 as const },
    ];
    const summary = summarizeHeatmap(cells);
    expect(summary.activeDays).toBe(2);
    expect(summary.total).toBe(400);
    expect(summary.bestDay?.date).toBe("2026-03-03");
  });
});
