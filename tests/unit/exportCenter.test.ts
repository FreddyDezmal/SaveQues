/**
 * tests/unit/exportCenter.test.ts
 * Sprint 24 — Phase 11: Export Centre.
 */
import { describe, it, expect } from "vitest";
import { toCSV, transactionsToCSV, goalsToCSV, buildAnnualReport } from "@/lib/exportCenter";
import type { Transaction, SavingsGoal, Profile } from "@/lib/types";

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    user_id: "u1",
    goal_id: "g1",
    amount: 100,
    note: null,
    transaction_type: "deposit",
    created_at: "2026-03-01T00:00:00Z",
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

describe("toCSV", () => {
  it("quotes fields containing commas, quotes, or newlines and doubles internal quotes", () => {
    const rows = [{ name: 'Say "hi", please\nthanks' }];
    const csv = toCSV(rows, [{ header: "Name", value: (r) => r.name }]);
    const [, dataLine] = csv.split("\r\n");
    expect(dataLine).toBe('"Say ""hi"", please\nthanks"');
  });

  it("leaves plain fields unquoted", () => {
    const csv = toCSV([{ name: "Simple" }], [{ header: "Name", value: (r) => r.name }]);
    expect(csv).toBe("Name\r\nSimple");
  });

  it("produces exactly one line per row plus the header", () => {
    const csv = toCSV([{ n: 1 }, { n: 2 }, { n: 3 }], [{ header: "N", value: (r) => String(r.n) }]);
    expect(csv.split("\r\n")).toHaveLength(4);
  });
});

describe("transactionsToCSV / goalsToCSV", () => {
  it("resolves goal title/category from the goals list, and handles a deleted goal gracefully", () => {
    const goals = [{ id: "g1", title: "Trip to Japan", category: "travel" }];
    const txs = [tx({ goal_id: "g1", amount: 250 }), tx({ goal_id: "missing", amount: 50 })];
    const csv = transactionsToCSV(txs, goals);
    expect(csv).toContain("Trip to Japan");
    expect(csv).toContain("travel");
    expect(csv).toContain("(deleted goal)");
  });

  it("includes progress percentage and complete status for goals", () => {
    const g = goal({ target_amount: 1000, current_amount: 250, is_complete: false });
    const csv = goalsToCSV([g]);
    expect(csv).toContain("25");
    expect(csv).toContain("No");
  });
});

describe("buildAnnualReport", () => {
  const profile: Pick<Profile, "created_at" | "xp_total"> = { created_at: "2025-06-01T00:00:00Z", xp_total: 1000 };

  it("zero-fills all 12 months even when deposits only occurred in a few", () => {
    const txs = [tx({ created_at: "2026-03-15T00:00:00Z", amount: 100 }), tx({ created_at: "2026-03-20T00:00:00Z", amount: 50 })];
    const report = buildAnnualReport({ profile, goals: [], transactions: txs, year: 2026 });
    expect(report.monthlyBreakdown).toHaveLength(12);
    expect(report.monthlyBreakdown.find((m) => m.monthKey === "2026-03")!.total).toBe(150);
    expect(report.monthlyBreakdown.find((m) => m.monthKey === "2026-01")!.total).toBe(0);
  });

  it("excludes deposits from other years from the year's total", () => {
    const txs = [
      tx({ created_at: "2025-12-31T23:59:59Z", amount: 999 }),
      tx({ created_at: "2026-01-01T00:00:00Z", amount: 100 }),
      tx({ created_at: "2027-01-01T00:00:00Z", amount: 999 }),
    ];
    const report = buildAnnualReport({ profile, goals: [], transactions: txs, year: 2026 });
    expect(report.totalSaved).toBe(100);
  });

  it("computes percentChangeFromPreviousYear correctly, and null when there's no prior-year data", () => {
    const txs = [tx({ created_at: "2025-06-01T00:00:00Z", amount: 100 }), tx({ created_at: "2026-06-01T00:00:00Z", amount: 150 })];
    const report = buildAnnualReport({ profile, goals: [], transactions: txs, year: 2026 });
    expect(report.totalSavedPreviousYear).toBe(100);
    expect(report.percentChangeFromPreviousYear).toBeCloseTo(50, 5);

    const reportNoHistory = buildAnnualReport({ profile, goals: [], transactions: [tx({ created_at: "2026-06-01T00:00:00Z" })], year: 2026 });
    expect(reportNoHistory.percentChangeFromPreviousYear).toBeNull();
  });

  it("counts a goal as completed in the year of its (proxy) completion timestamp, not its creation year", () => {
    const g = goal({ id: "g1", is_complete: true, created_at: "2025-11-01T00:00:00Z" });
    const txs = [tx({ id: "t1", goal_id: "g1", created_at: "2026-02-01T00:00:00Z" })]; // latest tx = completion proxy
    const report2025 = buildAnnualReport({ profile, goals: [g], transactions: txs, year: 2025 });
    const report2026 = buildAnnualReport({ profile, goals: [g], transactions: txs, year: 2026 });
    expect(report2025.goalsCompletedThisYear).toBe(0);
    expect(report2026.goalsCompletedThisYear).toBe(1);
  });

  it("category breakdown only reflects deposits made within the requested year", () => {
    const g = goal({ id: "g1", category: "home" });
    const txs = [
      tx({ goal_id: "g1", created_at: "2025-05-01T00:00:00Z", amount: 500 }),
      tx({ goal_id: "g1", created_at: "2026-05-01T00:00:00Z", amount: 200 }),
    ];
    const report = buildAnnualReport({ profile, goals: [g], transactions: txs, year: 2026 });
    const home = report.categoryBreakdown.find((c) => c.categoryId === "home")!;
    expect(home.totalSaved).toBe(200);
  });

  it("milestones are filtered to the requested year", () => {
    const txs = [tx({ created_at: "2026-01-05T00:00:00Z", amount: 50 })]; // first deposit -> a milestone in 2026
    const report2025 = buildAnnualReport({ profile, goals: [], transactions: txs, year: 2025 });
    const report2026 = buildAnnualReport({ profile, goals: [], transactions: txs, year: 2026 });
    expect(report2025.milestones.some((m) => m.type === "first_deposit")).toBe(false);
    expect(report2026.milestones.some((m) => m.type === "first_deposit")).toBe(true);
  });
});
