/**
 * tests/unit/weeklyReview.test.ts
 * Sprint 19 — Phase 11.
 */
import { describe, it, expect } from "vitest";
import { buildWeeklyReview } from "@/lib/weeklyReview";
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
  goals: [{ id: "g1", is_complete: false }],
  achievements: [] as { achievement_id: string; earned_at: string }[],
  activityLog: [] as { date: string; xp_earned: number; actions_count: number }[],
  profile: { streak_days: 5, longest_streak: 10 },
};

describe("buildWeeklyReview", () => {
  it("flags hasEnoughData=false and reports zero savings for a user with no deposits this week", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const review = buildWeeklyReview({ ...baseInputs, transactions: [], now });
    expect(review.hasEnoughData).toBe(false);
    expect(review.weeklySavings).toBe(0);
    expect(review.bestSavingDay).toBeNull();
  });

  it("sums this week's deposits and identifies the best saving day", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    const txs = [
      tx({ id: "1", amount: 100, created_at: "2026-03-10T08:00:00Z" }),
      tx({ id: "2", amount: 300, created_at: "2026-03-12T08:00:00Z" }),
      tx({ id: "3", amount: 50, created_at: "2026-03-12T09:00:00Z" }),
      // outside the 7-day window ending 2026-03-15
      tx({ id: "4", amount: 999, created_at: "2026-02-01T08:00:00Z" }),
    ];
    const review = buildWeeklyReview({ ...baseInputs, transactions: txs, now });
    expect(review.weeklySavings).toBe(450);
    expect(review.bestSavingDay).toEqual({ date: "2026-03-12", amount: 350 });
    expect(review.goalsProgressed).toBe(1);
  });

  it("carries through profile streak fields unchanged", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const review = buildWeeklyReview({ ...baseInputs, transactions: [], now });
    expect(review.currentStreak).toBe(5);
    expect(review.longestStreak).toBe(10);
  });

  it("counts achievements and XP only within the 7-day window", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const review = buildWeeklyReview({
      ...baseInputs,
      transactions: [],
      achievements: [
        { achievement_id: "a1", earned_at: "2026-03-12T00:00:00Z" }, // in window
        { achievement_id: "a2", earned_at: "2026-01-01T00:00:00Z" }, // out of window
      ],
      activityLog: [
        { date: "2026-03-12", xp_earned: 50, actions_count: 3 },
        { date: "2026-01-01", xp_earned: 999, actions_count: 99 },
      ],
      now,
    });
    expect(review.achievementsUnlocked).toHaveLength(1);
    expect(review.achievementsUnlocked[0].achievementId).toBe("a1");
    expect(review.xpEarned).toBe(50);
  });
});
