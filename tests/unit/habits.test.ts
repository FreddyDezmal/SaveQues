/**
 * tests/unit/habits.test.ts
 * Sprint 21 — Phase 15.
 */
import { describe, it, expect } from "vitest";
import { computeHabitProfile } from "@/lib/habits";
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

describe("computeHabitProfile", () => {
  it("flags hasEnoughData=false with fewer than 5 deposits", () => {
    const profile = computeHabitProfile([tx({}), tx({})]);
    expect(profile.hasEnoughData).toBe(false);
    expect(profile.habitScore).toBe(0);
  });

  it("classifies a perfectly weekly rhythm as 'weekly'", () => {
    const txs = Array.from({ length: 8 }, (_, i) =>
      tx({ id: String(i), created_at: new Date(Date.UTC(2026, 0, 5 + i * 7, 10)).toISOString() })
    );
    const profile = computeHabitProfile(txs);
    expect(profile.depositRhythm.type).toBe("weekly");
    expect(profile.habitScore).toBeGreaterThan(70);
  });

  it("classifies wildly irregular deposits as 'irregular'", () => {
    const offsets = [0, 1, 45, 46, 47, 90];
    const txs = offsets.map((o, i) => tx({ id: String(i), created_at: new Date(Date.UTC(2026, 0, 1 + o, 10)).toISOString() }));
    const profile = computeHabitProfile(txs);
    expect(profile.depositRhythm.type).toBe("irregular");
  });

  it("identifies the strongest saving hour only with enough samples and no tie", () => {
    // 3 deposits at hour 9, 2 at hour 20 — clear winner, 5 total (meets MIN_DEPOSITS)
    const txs = [
      tx({ id: "1", created_at: new Date(Date.UTC(2026, 0, 1, 9)).toISOString() }),
      tx({ id: "2", created_at: new Date(Date.UTC(2026, 0, 2, 9)).toISOString() }),
      tx({ id: "3", created_at: new Date(Date.UTC(2026, 0, 3, 9)).toISOString() }),
      tx({ id: "4", created_at: new Date(Date.UTC(2026, 0, 4, 20)).toISOString() }),
      tx({ id: "5", created_at: new Date(Date.UTC(2026, 0, 5, 20)).toISOString() }),
    ];
    const profile = computeHabitProfile(txs);
    expect(profile.strongestSavingHour?.hour).toBe(9);
    expect(profile.preferredSavingWindow).toBe("morning");
  });

  it("returns insufficient_data for consistencyTrend with fewer than 6 deposits", () => {
    const txs = Array.from({ length: 5 }, (_, i) => tx({ id: String(i), created_at: new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString() }));
    const profile = computeHabitProfile(txs);
    expect(profile.consistencyTrend).toBe("insufficient_data");
  });

  it("never returns a negative or NaN habitScore", () => {
    const txs = Array.from({ length: 10 }, (_, i) => tx({ id: String(i), created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), amount: 10 + i }));
    const profile = computeHabitProfile(txs);
    expect(Number.isNaN(profile.habitScore)).toBe(false);
    expect(profile.habitScore).toBeGreaterThanOrEqual(0);
  });
});
