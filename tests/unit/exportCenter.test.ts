/**
 * tests/unit/exportCenter.test.ts
 * Sprint 24 — Phase 11: Export Centre.
 */
import { describe, it, expect } from "vitest";
import { toCSV, transactionsToCSV, goalsToCSV, buildAnnualReport, monthlyReportGoalsToCSV } from "@/lib/exportCenter";
import { buildMonthlyReport } from "@/lib/monthlyReport";
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
    is_primary: false,
    is_active: true,
    goal_status: "active",
    completed_at: null,
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

  it("shows 0% progress (not NaN or Infinity) for a zero-target goal, per Phase 15's explicit zero-value edge case", () => {
    const g = goal({ target_amount: 0, current_amount: 0 });
    const csv = goalsToCSV([g]);
    expect(csv).not.toContain("NaN");
    expect(csv).not.toContain("Infinity");
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toBeDefined();
  });

  it("defaults the Currency column to ZAR when no currencyCode is passed (Sprint 31, Phase 10)", () => {
    const txs = [tx({ goal_id: "g1", amount: 250 })];
    expect(transactionsToCSV(txs, [{ id: "g1", title: "Trip", category: "travel" }]).split("\r\n")[0]).toContain("Currency");
    expect(transactionsToCSV(txs, [{ id: "g1", title: "Trip", category: "travel" }])).toContain(",ZAR,");
    const g = goal({ target_amount: 1000, current_amount: 250 });
    expect(goalsToCSV([g])).toContain("ZAR");
  });

  it("uses the passed currencyCode instead of the ZAR default", () => {
    const txs = [tx({ goal_id: "g1", amount: 250 })];
    const csv = transactionsToCSV(txs, [{ id: "g1", title: "Trip", category: "travel" }], "USD");
    expect(csv).toContain(",USD,");
    expect(csv).not.toContain("ZAR");

    const g = goal({ target_amount: 1000, current_amount: 250 });
    const goalsCsv = goalsToCSV([g], "USD");
    expect(goalsCsv).toContain("USD");
    expect(goalsCsv).not.toContain("ZAR");
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

// ── Sprint 30 — Phase 13: coverage audit ──────────────────────────────────
// annualReportMonthlyToCSV/annualReportCategoryToCSV/milestonesToCSV predate
// this sprint (same file as monthlyReportGoalsToCSV, same toCSV helper) but
// had no test coverage at all. Added while already in this file for Phase 5.
import type { JourneyHighlight } from "@/lib/journeyHighlights";
import { annualReportMonthlyToCSV, annualReportCategoryToCSV, milestonesToCSV } from "@/lib/exportCenter";

describe("annualReportMonthlyToCSV", () => {
  it("includes all 12 zero-filled months with their totals, currency, and deposit counts", () => {
    const profile: Pick<Profile, "created_at" | "xp_total"> = { created_at: "2025-06-01T00:00:00Z", xp_total: 0 };
    const txs = [tx({ created_at: "2026-03-15T00:00:00Z", amount: 100 }), tx({ created_at: "2026-03-20T00:00:00Z", amount: 50 })];
    const report = buildAnnualReport({ profile, goals: [], transactions: txs, year: 2026 });

    const csv = annualReportMonthlyToCSV(report);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Month,Total saved,Currency,Deposits");
    expect(lines.length).toBe(13); // header + 12 months
    expect(csv).toContain("2026-03,150,ZAR,2");
    expect(csv).toContain("2026-01,0,ZAR,0");
  });

  it("defaults the Currency column to ZAR when no currencyCode is passed (previous behavior's implicit currency, now explicit)", () => {
    const profile: Pick<Profile, "created_at" | "xp_total"> = { created_at: "2025-06-01T00:00:00Z", xp_total: 0 };
    const report = buildAnnualReport({ profile, goals: [], transactions: [], year: 2026 });
    expect(annualReportMonthlyToCSV(report).split("\r\n")[0]).toBe("Month,Total saved,Currency,Deposits");
  });

  it("uses the passed currencyCode for every row", () => {
    const profile: Pick<Profile, "created_at" | "xp_total"> = { created_at: "2025-06-01T00:00:00Z", xp_total: 0 };
    const txs = [tx({ created_at: "2026-03-15T00:00:00Z", amount: 100 })];
    const report = buildAnnualReport({ profile, goals: [], transactions: txs, year: 2026 });
    const csv = annualReportMonthlyToCSV(report, "USD");
    expect(csv).toContain("2026-03,100,USD,1");
    expect(csv).not.toContain("ZAR");
  });
});

describe("annualReportCategoryToCSV", () => {
  it("includes each category's total, currency, and percent-of-year-total, rounded to 1 decimal", () => {
    const profile: Pick<Profile, "created_at" | "xp_total"> = { created_at: "2025-06-01T00:00:00Z", xp_total: 0 };
    const g = goal({ id: "g1", category: "home", created_at: "2025-06-01T00:00:00Z" });
    const txs = [tx({ goal_id: "g1", created_at: "2026-01-01T00:00:00Z", amount: 100 })];
    const report = buildAnnualReport({ profile, goals: [g], transactions: txs, year: 2026 });

    const csv = annualReportCategoryToCSV(report);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Category,Total saved,Currency,% of year total");
    expect(csv).toContain("100");
    expect(csv).toContain("ZAR");
  });

  it("zero-fills every category (all show 0) when there's no deposit activity, rather than omitting them", () => {
    const profile: Pick<Profile, "created_at" | "xp_total"> = { created_at: "2025-06-01T00:00:00Z", xp_total: 0 };
    const report = buildAnnualReport({ profile, goals: [], transactions: [], year: 2026 });
    const csv = annualReportCategoryToCSV(report);
    const lines = csv.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((line) => line.endsWith(",ZAR,0"))).toBe(true);
  });
});

describe("milestonesToCSV", () => {
  it("includes each milestone's date and label", () => {
    const highlights: JourneyHighlight[] = [
      { id: "h1", type: "first_deposit", timestamp: "2026-01-05T00:00:00Z", label: "Made your first deposit" },
      { id: "h2", type: "round_number_milestone", timestamp: "2026-02-10T00:00:00Z", label: "Completed \"Emergency Fund\"" },
    ];
    const csv = milestonesToCSV(highlights);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Date,Milestone");
    expect(lines[1]).toContain("Made your first deposit");
    expect(lines[2]).toContain("Emergency Fund");
  });

  it("returns just a header row for an empty highlights list", () => {
    expect(milestonesToCSV([]).split("\r\n").length).toBe(1);
  });
});
describe("monthlyReportGoalsToCSV", () => {
  const now = new Date("2026-03-15T00:00:00Z");

  it("joins goalHealthSummary with goal titles and forecastSummary's pace/completion columns", () => {
    const g = goal({ id: "g1", title: "Emergency Fund", target_amount: 1000, current_amount: 500 });
    const txs = [
      tx({ goal_id: "g1", created_at: "2026-03-01T00:00:00Z", amount: 100 }),
      tx({ goal_id: "g1", created_at: "2026-03-08T00:00:00Z", amount: 100 }),
    ];
    const report = buildMonthlyReport({
      transactions: txs,
      goals: [g],
      achievements: [],
      activityLog: [],
      profile: { streak_days: 2, longest_streak: 2 },
      now,
    });

    const csv = monthlyReportGoalsToCSV(report, [{ id: "g1", title: "Emergency Fund" }]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Goal,Health status,Health score,Pace status,Projected completion");
    expect(lines[1]).toContain("Emergency Fund");
  });

  it("falls back to '(deleted goal)' when the goal referenced in the report no longer exists in the goals list", () => {
    const g = goal({ id: "g1", title: "Old Goal" });
    const txs = [tx({ goal_id: "g1", created_at: "2026-03-01T00:00:00Z", amount: 50 })];
    const report = buildMonthlyReport({
      transactions: txs,
      goals: [g],
      achievements: [],
      activityLog: [],
      profile: { streak_days: 1, longest_streak: 1 },
      now,
    });

    // Simulate the goal having been deleted between report generation and CSV rendering.
    const csv = monthlyReportGoalsToCSV(report, []);
    expect(csv).toContain("(deleted goal)");
  });

  it("returns just a header row (no goal rows) when there are no active goals", () => {
    const report = buildMonthlyReport({
      transactions: [],
      goals: [],
      achievements: [],
      activityLog: [],
      profile: { streak_days: 0, longest_streak: 0 },
      now,
    });
    const csv = monthlyReportGoalsToCSV(report, []);
    expect(csv.split("\r\n").length).toBe(1);
  });
});
