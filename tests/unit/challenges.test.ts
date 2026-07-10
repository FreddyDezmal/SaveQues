/**
 * tests/unit/challenges.test.ts
 * Sprint 20 — Phase 12.
 */
import { describe, it, expect } from "vitest";
import { generateWeeklyChallenges } from "@/lib/challenges";
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

describe("generateWeeklyChallenges", () => {
  it("never generates a 'beat your longest streak' challenge for a brand-new streak", () => {
    const challenges = generateWeeklyChallenges({
      transactions: [],
      goals: [],
      streakDays: 0,
      longestStreak: 0,
      xpTotal: 0,
    });
    expect(challenges.find((c) => c.id === "beat_longest_streak")).toBeUndefined();
  });

  it("marks the two-deposits challenge complete once 2+ deposits land in the current week", () => {
    const now = new Date("2026-03-18T12:00:00Z"); // Wednesday
    const txs = [
      tx({ id: "1", created_at: "2026-03-16T08:00:00Z" }), // Monday, same week
      tx({ id: "2", created_at: "2026-03-17T08:00:00Z" }), // Tuesday, same week
    ];
    const challenges = generateWeeklyChallenges({ transactions: txs, goals: [], streakDays: 0, longestStreak: 0, xpTotal: 0, now });
    const twoDeposits = challenges.find((c) => c.id === "two_deposits")!;
    expect(twoDeposits.isComplete).toBe(true);
    expect(twoDeposits.progress).toBe(1);
  });

  it("every challenge has a positive XP reward and an expiry date", () => {
    const challenges = generateWeeklyChallenges({
      transactions: [tx({})],
      goals: [{ id: "g1", is_complete: false }],
      streakDays: 5,
      longestStreak: 10,
      xpTotal: 500,
    });
    for (const c of challenges) {
      expect(c.xpReward).toBeGreaterThan(0);
      expect(c.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.progress).toBeGreaterThanOrEqual(0);
      expect(c.progress).toBeLessThanOrEqual(1);
    }
  });

  it("does not mark 'complete a goal' complete for a goal completed in a previous week", () => {
    const now = new Date("2026-03-18T12:00:00Z");
    const txs = [tx({ id: "1", goal_id: "g1", created_at: "2026-01-01T08:00:00Z" })];
    const challenges = generateWeeklyChallenges({
      transactions: txs,
      goals: [{ id: "g1", is_complete: true }, { id: "g2", is_complete: false }],
      streakDays: 0,
      longestStreak: 0,
      xpTotal: 0,
      now,
    });
    const completeGoal = challenges.find((c) => c.id === "complete_a_goal")!;
    expect(completeGoal.isComplete).toBe(false);
  });
});
