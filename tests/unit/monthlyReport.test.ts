/**
 * tests/unit/monthlyReport.test.ts
 * Sprint 20 — Phase 12.
 */
import { describe, it, expect } from "vitest";
import { buildMonthlyReport } from "@/lib/monthlyReport";
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

const baseInputs = {
  goals: [] as { id: string; title: string; target_amount: number; current_amount: number; target_date: string | null; is_complete: boolean }[],
  achievements: [] as { achievement_id: string; earned_at: string }[],
  activityLog: [] as { date: string; xp_earned: number }[],
  profile: { streak_days: 3, longest_streak: 7 },
};

describe("buildMonthlyReport", () => {
  it("flags hasEnoughData=false for a month with no deposits", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const report = buildMonthlyReport({ ...baseInputs, transactions: [], now });
    expect(report.hasEnoughData).toBe(false);
    expect(report.monthlySavings).toBe(0);
  });

  it("sums only this month's deposits into monthlySavings", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const txs = [
      tx({ id: "1", amount: 100, created_at: "2026-03-01T00:00:00Z" }),
      tx({ id: "2", amount: 200, created_at: "2026-03-10T00:00:00Z" }),
      tx({ id: "3", amount: 999, created_at: "2026-02-15T00:00:00Z" }), // previous month
    ];
    const report = buildMonthlyReport({ ...baseInputs, transactions: txs, now });
    expect(report.monthlySavings).toBe(300);
  });

  it("computes a percent change against the previous month when data exists in both", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const txs = [
      tx({ id: "1", amount: 200, created_at: "2026-03-05T00:00:00Z" }),
      tx({ id: "2", amount: 100, created_at: "2026-02-05T00:00:00Z" }),
    ];
    const report = buildMonthlyReport({ ...baseInputs, transactions: txs, now });
    expect(report.savingsChangeFromPreviousMonth.percent).toBe(100);
  });

  it("carries streak fields through unchanged", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const report = buildMonthlyReport({ ...baseInputs, transactions: [], now });
    expect(report.currentStreak).toBe(3);
    expect(report.longestStreak).toBe(7);
  });

  it("reports a topMilestone when a goal completes this month, even with no deposits this month", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const txs = [tx({ id: "1", goal_id: "g1", amount: 100, created_at: "2026-03-10T00:00:00Z" })];
    const report = buildMonthlyReport({
      ...baseInputs,
      transactions: txs,
      goals: [{ id: "g1", title: "New Bike", target_amount: 100, current_amount: 100, target_date: null, is_complete: true }],
      now,
    });
    expect(report.goalsCompleted).toBe(1);
    expect(report.topMilestone).toContain("New Bike");
  });

  // ── Sprint 30 — Phase 8: explainability audit ────────────────────────
  describe("topMilestone's largest-deposit amount (Phase 8 fix)", () => {
    it("defaults to a bare rounded number when no formatAmount is passed, matching the previous behavior exactly", () => {
      const now = new Date("2026-03-15T00:00:00Z");
      const txs = [tx({ id: "1", goal_id: "g1", amount: 250, created_at: "2026-03-10T00:00:00Z" })];
      const report = buildMonthlyReport({ ...baseInputs, transactions: txs, now });
      expect(report.topMilestone).toBe("Largest deposit this month: 250");
    });

    it("uses the passed formatAmount instead of a bare number", () => {
      const now = new Date("2026-03-15T00:00:00Z");
      const txs = [tx({ id: "1", goal_id: "g1", amount: 250, created_at: "2026-03-10T00:00:00Z" })];
      const report = buildMonthlyReport({
        ...baseInputs,
        transactions: txs,
        now,
        formatAmount: (n) => `R${n.toFixed(2)}`,
      });
      expect(report.topMilestone).toBe("Largest deposit this month: R250.00");
    });
  });
});
