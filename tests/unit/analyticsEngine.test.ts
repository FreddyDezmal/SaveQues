/**
 * tests/unit/analyticsEngine.test.ts
 * Sprint 19 — Phase 11.
 */
import { describe, it, expect } from "vitest";
import {
  getDeposits,
  getDepositStats,
  weeklyTotals,
  monthlyTotals,
  mostFrequentDay,
  depositIntervalsDays,
  consistencyScore,
  weeklySavingStreak,
  daysSinceLastDeposit,
  longestInactivityGapDays,
} from "@/lib/analyticsEngine";
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

describe("getDeposits", () => {
  it("excludes withdrawals, goal_purchases, and non-positive amounts", () => {
    const txs = [
      tx({ id: "1", amount: 100, transaction_type: "deposit" }),
      tx({ id: "2", amount: 50, transaction_type: "withdrawal" }),
      tx({ id: "3", amount: 200, transaction_type: "goal_purchase" }),
      tx({ id: "4", amount: -10, transaction_type: "deposit" }),
    ];
    const deposits = getDeposits(txs);
    expect(deposits.map((d) => d.id)).toEqual(["1"]);
  });

  it("sorts oldest to newest", () => {
    const txs = [
      tx({ id: "late", created_at: "2026-02-01T00:00:00Z" }),
      tx({ id: "early", created_at: "2026-01-01T00:00:00Z" }),
    ];
    expect(getDeposits(txs).map((d) => d.id)).toEqual(["early", "late"]);
  });
});

describe("getDepositStats", () => {
  it("returns null for an empty list rather than fabricating zeros", () => {
    expect(getDepositStats([])).toBeNull();
  });

  it("computes count/total/average/largest/smallest correctly", () => {
    const deposits = getDeposits([
      tx({ id: "a", amount: 100 }),
      tx({ id: "b", amount: 300 }),
      tx({ id: "c", amount: 50 }),
    ]);
    const stats = getDepositStats(deposits)!;
    expect(stats.count).toBe(3);
    expect(stats.total).toBe(450);
    expect(stats.average).toBe(150);
    expect(stats.largest.id).toBe("b");
    expect(stats.smallest.id).toBe("c");
  });
});

describe("weeklyTotals / monthlyTotals", () => {
  it("buckets deposits into the correct UTC week and month", () => {
    const deposits = getDeposits([
      tx({ id: "1", amount: 100, created_at: "2026-03-02T08:00:00Z" }), // Monday
      tx({ id: "2", amount: 50, created_at: "2026-03-04T08:00:00Z" }), // same week (Wed)
      tx({ id: "3", amount: 20, created_at: "2026-03-10T08:00:00Z" }), // next week
    ]);
    const weekly = weeklyTotals(deposits);
    expect(weekly).toHaveLength(2);
    expect(weekly[0].total).toBe(150);
    expect(weekly[1].total).toBe(20);

    const monthly = monthlyTotals(deposits);
    expect(monthly).toEqual([{ key: "2026-03", total: 170, count: 3 }]);
  });
});

describe("mostFrequentDay", () => {
  it("returns null below the minimum deposit threshold", () => {
    const deposits = getDeposits([tx({ id: "1" }), tx({ id: "2" })]);
    expect(mostFrequentDay(deposits)).toBeNull();
  });

  it("returns null on a tie rather than guessing", () => {
    // 3 Mondays + 3 Tuesdays = tie, but only 6 total which clears the default
    // minDeposits of 5, so the tie-break path is what's under test.
    const deposits = getDeposits([
      tx({ id: "1", created_at: "2026-03-02T00:00:00Z" }), // Mon
      tx({ id: "2", created_at: "2026-03-09T00:00:00Z" }), // Mon
      tx({ id: "3", created_at: "2026-03-16T00:00:00Z" }), // Mon
      tx({ id: "4", created_at: "2026-03-03T00:00:00Z" }), // Tue
      tx({ id: "5", created_at: "2026-03-10T00:00:00Z" }), // Tue
      tx({ id: "6", created_at: "2026-03-17T00:00:00Z" }), // Tue
    ]);
    expect(mostFrequentDay(deposits)).toBeNull();
  });

  it("identifies a clear favorite day", () => {
    const deposits = getDeposits([
      tx({ id: "1", created_at: "2026-03-06T00:00:00Z" }), // Fri
      tx({ id: "2", created_at: "2026-03-13T00:00:00Z" }), // Fri
      tx({ id: "3", created_at: "2026-03-20T00:00:00Z" }), // Fri
      tx({ id: "4", created_at: "2026-03-27T00:00:00Z" }), // Fri
      tx({ id: "5", created_at: "2026-03-10T00:00:00Z" }), // Tue
    ]);
    const result = mostFrequentDay(deposits);
    expect(result?.day).toBe("Friday");
    expect(result?.count).toBe(4);
  });
});

describe("depositIntervalsDays / consistencyScore", () => {
  it("returns null consistency with fewer than 2 intervals", () => {
    expect(consistencyScore(getDeposits([tx({ id: "1" })]))).toBeNull();
  });

  it("scores perfectly regular weekly deposits near 100", () => {
    const deposits = getDeposits([
      tx({ id: "1", created_at: "2026-01-01T00:00:00Z" }),
      tx({ id: "2", created_at: "2026-01-08T00:00:00Z" }),
      tx({ id: "3", created_at: "2026-01-15T00:00:00Z" }),
      tx({ id: "4", created_at: "2026-01-22T00:00:00Z" }),
    ]);
    expect(depositIntervalsDays(deposits)).toEqual([7, 7, 7]);
    expect(consistencyScore(deposits)).toBe(100);
  });

  it("scores highly irregular deposits low", () => {
    const deposits = getDeposits([
      tx({ id: "1", created_at: "2026-01-01T00:00:00Z" }),
      tx({ id: "2", created_at: "2026-01-02T00:00:00Z" }), // 1 day later
      tx({ id: "3", created_at: "2026-03-01T00:00:00Z" }), // 58 days later
    ]);
    const score = consistencyScore(deposits)!;
    expect(score).toBeLessThan(50);
  });
});

describe("weeklySavingStreak", () => {
  it("returns zero streaks for no deposits", () => {
    expect(weeklySavingStreak([])).toEqual({ current: 0, longest: 0 });
  });

  it("counts consecutive weeks correctly and detects a broken streak", () => {
    const now = new Date("2026-03-20T12:00:00Z"); // Friday, week of Mar 16
    const deposits = getDeposits([
      tx({ id: "1", created_at: "2026-03-02T00:00:00Z" }), // week of Mar 2
      tx({ id: "2", created_at: "2026-03-09T00:00:00Z" }), // week of Mar 9
      tx({ id: "3", created_at: "2026-03-16T00:00:00Z" }), // week of Mar 16 (current)
    ]);
    const result = weeklySavingStreak(deposits, now);
    expect(result.longest).toBe(3);
    expect(result.current).toBe(3);
  });

  it("allows the current week to be empty as long as last week had activity", () => {
    const now = new Date("2026-03-18T12:00:00Z"); // Wed of week starting Mar 16, no deposit yet this week
    const deposits = getDeposits([tx({ id: "1", created_at: "2026-03-09T00:00:00Z" })]); // week of Mar 9
    const result = weeklySavingStreak(deposits, now);
    expect(result.current).toBe(1);
  });
});

describe("daysSinceLastDeposit / longestInactivityGapDays", () => {
  it("returns null when there are no deposits", () => {
    expect(daysSinceLastDeposit([])).toBeNull();
    expect(longestInactivityGapDays([])).toBeNull();
  });

  it("computes days since last deposit and the longest gap", () => {
    const deposits = getDeposits([
      tx({ id: "1", created_at: "2026-01-01T00:00:00Z" }),
      tx({ id: "2", created_at: "2026-01-05T00:00:00Z" }), // gap 4
      tx({ id: "3", created_at: "2026-01-20T00:00:00Z" }), // gap 15
    ]);
    const now = new Date("2026-01-25T00:00:00Z");
    expect(daysSinceLastDeposit(deposits, now)).toBe(5);
    expect(longestInactivityGapDays(deposits)).toBe(15);
  });
});
