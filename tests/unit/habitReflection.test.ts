/**
 * tests/unit/habitReflection.test.ts
 * Sprint 21 — Phase 15.
 */
import { describe, it, expect } from "vitest";
import { buildWeeklyBehaviorReflection } from "@/lib/habitReflection";
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
  profile: { streak_days: 3, longest_streak: 8 },
};

describe("buildWeeklyBehaviorReflection", () => {
  it("returns hasEnoughData=false with an encouraging, non-empty message for a brand-new user", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const result = buildWeeklyBehaviorReflection({ ...baseInputs, transactions: [], now });
    expect(result.hasEnoughData).toBe(false);
    expect(result.encouragement.length).toBeGreaterThan(0);
    expect(result.nextFocus).not.toBeNull();
  });

  it("reports a goal completion as the biggest win when one happened this week", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const txs = [tx({ id: "1", goal_id: "g1", amount: 100, created_at: "2026-03-12T00:00:00Z" })];
    const result = buildWeeklyBehaviorReflection({
      ...baseInputs,
      transactions: txs,
      goals: [{ id: "g1", is_complete: true }],
      now,
    });
    expect(result.biggestWin).toMatch(/goal/i);
  });

  it("returns a defined nextFocus string when there is enough weekly data", () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const txs = [
      tx({ id: "1", created_at: "2026-01-01T00:00:00Z" }),
      tx({ id: "2", created_at: "2026-01-08T00:00:00Z" }),
      tx({ id: "3", created_at: "2026-01-15T00:00:00Z" }),
      tx({ id: "4", created_at: "2026-02-01T00:00:00Z" }),
      tx({ id: "5", created_at: "2026-03-10T00:00:00Z" }),
      tx({ id: "6", created_at: "2026-03-28T00:00:00Z" }),
    ];
    const result = buildWeeklyBehaviorReflection({ ...baseInputs, transactions: txs, now });
    expect(result.hasEnoughData).toBe(true);
    expect(typeof result.nextFocus).toBe("string");
  });

  it("never returns an empty encouragement string, even with no deposits in the current week", () => {
    const now = new Date("2026-04-15T00:00:00Z");
    const txs = [
      tx({ id: "1", created_at: "2026-01-01T00:00:00Z" }),
      tx({ id: "2", created_at: "2026-01-08T00:00:00Z" }),
    ];
    const result = buildWeeklyBehaviorReflection({ ...baseInputs, transactions: txs, now });
    expect(result.encouragement).toBeDefined();
    expect(result.encouragement.length).toBeGreaterThan(0);
  });
});
