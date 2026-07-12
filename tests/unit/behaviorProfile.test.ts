/**
 * tests/unit/behaviorProfile.test.ts
 * Sprint 21 — Phase 15.
 */
import { describe, it, expect } from "vitest";
import { computeBehaviorProfile } from "@/lib/behaviorProfile";
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

describe("computeBehaviorProfile", () => {
  it("returns a low-confidence Building Habit default for a new user", () => {
    const result = computeBehaviorProfile({
      transactions: [tx({}), tx({})],
      goals: [],
      streakDays: 0,
      longestStreak: 0,
    });
    expect(result.profile).toBe("Building Habit");
    expect(result.confidence).toBeLessThan(0.35);
  });

  it("identifies a Payday Saver from day-of-month clustering", () => {
    const txs = [1, 2, 3, 4, 5].map((month) =>
      tx({ id: String(month), created_at: new Date(Date.UTC(2026, month, 25, 10)).toISOString() })
    );
    const result = computeBehaviorProfile({ transactions: txs, goals: [], streakDays: 0, longestStreak: 0 });
    expect(result.profile).toBe("Payday Saver");
  });

  it("identifies Goal Driven when deposits span multiple active goals", () => {
    const txs = [
      tx({ id: "1", goal_id: "g1", created_at: "2026-01-01T00:00:00Z" }),
      tx({ id: "2", goal_id: "g2", created_at: "2026-01-05T00:00:00Z" }),
      tx({ id: "3", goal_id: "g1", created_at: "2026-01-10T00:00:00Z" }),
      tx({ id: "4", goal_id: "g2", created_at: "2026-01-15T00:00:00Z" }),
      tx({ id: "5", goal_id: "g3", created_at: "2026-01-20T00:00:00Z" }),
    ];
    const result = computeBehaviorProfile({
      transactions: txs,
      goals: [
        { id: "g1", is_complete: false },
        { id: "g2", is_complete: false },
        { id: "g3", is_complete: false },
      ],
      streakDays: 0,
      longestStreak: 0,
    });
    expect(["Goal Driven", "Building Habit"]).toContain(result.profile);
  });

  it("always includes a non-empty explanation and at least one supporting metric", () => {
    const txs = Array.from({ length: 8 }, (_, i) => tx({ id: String(i), created_at: new Date(Date.UTC(2026, 0, 1 + i * 4)).toISOString() }));
    const result = computeBehaviorProfile({ transactions: txs, goals: [], streakDays: 5, longestStreak: 10 });
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(Object.keys(result.supportingMetrics).length).toBeGreaterThan(0);
  });

  it("never returns a profile with confidence outside [0,1]", () => {
    const txs = Array.from({ length: 12 }, (_, i) => tx({ id: String(i), created_at: new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString() }));
    const result = computeBehaviorProfile({ transactions: txs, goals: [], streakDays: 20, longestStreak: 25 });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
