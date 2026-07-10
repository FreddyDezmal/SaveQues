/**
 * tests/unit/forecast.test.ts
 * Sprint 19 — Phase 11.
 */
import { describe, it, expect } from "vitest";
import { forecastGoal, whatIfWeeklyDelta } from "@/lib/forecast";
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

describe("forecastGoal", () => {
  it("returns a fully-complete forecast for a completed goal, without projecting anything further", () => {
    const result = forecastGoal(goal({ is_complete: true, current_amount: 1000 }), []);
    expect(result.isComplete).toBe(true);
    expect(result.remaining).toBe(0);
    expect(result.projectedCompletionDate).toBeNull();
  });

  it("reports insufficient data when there are no deposits yet", () => {
    const result = forecastGoal(goal({}), []);
    expect(result.projectedCompletionDate).toBeNull();
    expect(result.insufficientDataReason).toMatch(/no deposits/i);
  });

  it("projects a completion date from a positive recent pace", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const txs = [
      tx({ created_at: "2026-02-01T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-08T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-22T00:00:00Z", amount: 100 }),
    ];
    // 4 weeks of R100/week pace, remaining = 800 - 400... let's use current_amount 200, target 1000 → remaining 800
    const result = forecastGoal(goal({ current_amount: 200, target_amount: 1000 }), txs, now);
    expect(result.currentWeeklyPace).not.toBeNull();
    expect(result.currentWeeklyPace!).toBeCloseTo(100, 0);
    expect(result.projectedCompletionDate).not.toBeNull();
    expect(result.estimatedWeeksRemaining).toBeCloseTo(8, 0); // 800 remaining / 100 per week
  });

  it("computes required pace against a target date and flags pace status", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const txs = [
      tx({ created_at: "2025-12-04T00:00:00Z", amount: 200 }),
      tx({ created_at: "2025-12-11T00:00:00Z", amount: 200 }),
      tx({ created_at: "2025-12-18T00:00:00Z", amount: 200 }),
      tx({ created_at: "2025-12-25T00:00:00Z", amount: 200 }),
    ];
    // remaining = 1000 - 200 = 800, target date 4 weeks out → required pace = 200/week
    // actual recent pace ~200/week → on_track
    const result = forecastGoal(
      goal({ current_amount: 200, target_amount: 1000, target_date: "2026-01-29" }),
      txs,
      now
    );
    expect(result.requiredWeeklyPace).not.toBeNull();
    expect(result.requiredWeeklyPace!).toBeCloseTo(200, 0);
    expect(result.paceStatus).toBe("on_track");
  });

  it("leaves required pace null when the target date has already passed", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const result = forecastGoal(goal({ target_date: "2026-01-01" }), [], now);
    expect(result.requiredWeeklyPace).toBeNull();
  });
});

describe("whatIfWeeklyDelta", () => {
  it("returns null when there's no baseline pace", () => {
    const base = forecastGoal(goal({}), []);
    expect(whatIfWeeklyDelta(base, 50)).toBeNull();
  });

  it("projects an earlier completion date for a positive delta", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const txs = [
      tx({ created_at: "2026-02-08T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-22T00:00:00Z", amount: 100 }),
    ];
    const base = forecastGoal(goal({ current_amount: 200, target_amount: 1000 }), txs, now);
    const withMore = whatIfWeeklyDelta(base, 50, now)!;
    const withLess = whatIfWeeklyDelta(base, -50, now)!;
    expect(new Date(withMore.projectedCompletionDate!).getTime()).toBeLessThan(
      new Date(base.projectedCompletionDate!).getTime()
    );
    expect(new Date(withLess.projectedCompletionDate!).getTime()).toBeGreaterThan(
      new Date(base.projectedCompletionDate!).getTime()
    );
  });

  it("returns a null completion date (not a crash) when the adjusted pace is non-positive", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const txs = [tx({ created_at: "2026-02-22T00:00:00Z", amount: 50 })];
    const base = forecastGoal(goal({ current_amount: 200, target_amount: 1000 }), txs, now);
    const result = whatIfWeeklyDelta(base, -1000, now)!;
    expect(result.projectedCompletionDate).toBeNull();
  });
});
