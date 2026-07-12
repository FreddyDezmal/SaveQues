/**
 * tests/unit/riskEngine.test.ts
 * Sprint 21 — Phase 15.
 */
import { describe, it, expect } from "vitest";
import { computeBehavioralRisk } from "@/lib/riskEngine";
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

describe("computeBehavioralRisk", () => {
  it("returns hasEnoughData=false with fewer than 4 deposits, and no factors", () => {
    const result = computeBehavioralRisk({ transactions: [tx({}), tx({})], streakDays: 0, longestStreak: 0 });
    expect(result.hasEnoughData).toBe(false);
    expect(result.factors).toEqual([]);
    expect(result.riskLevel).toBe("low");
  });

  it("flags abandonment risk for a long gap relative to typical rhythm", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const txs = [
      tx({ id: "1", created_at: "2026-01-01T00:00:00Z" }),
      tx({ id: "2", created_at: "2026-01-08T00:00:00Z" }),
      tx({ id: "3", created_at: "2026-01-15T00:00:00Z" }),
      tx({ id: "4", created_at: "2026-01-22T00:00:00Z" }), // weekly rhythm, then nothing for 5+ weeks
    ];
    const result = computeBehavioralRisk({ transactions: txs, streakDays: 0, longestStreak: 5, now });
    const abandonment = result.factors.find((f) => f.name === "Abandonment risk")!;
    expect(abandonment.triggered).toBe(true);
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it("flags collapsing streak when streakDays resets to 0 after a real streak", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const txs = [
      tx({ id: "1", created_at: "2026-02-01T00:00:00Z" }),
      tx({ id: "2", created_at: "2026-02-08T00:00:00Z" }),
      tx({ id: "3", created_at: "2026-02-15T00:00:00Z" }),
      tx({ id: "4", created_at: "2026-02-22T00:00:00Z" }),
    ];
    const result = computeBehavioralRisk({ transactions: txs, streakDays: 0, longestStreak: 14, now });
    const collapsing = result.factors.find((f) => f.name === "Collapsing streak")!;
    expect(collapsing.triggered).toBe(true);
    expect(result.recommendedInterventionType).toBe("streak_recovery");
  });

  it("reports no triggered factors and a non-alarming intervention for healthy, recent, regular activity", () => {
    const now = new Date("2026-02-08T12:00:00Z");
    const txs = [
      tx({ id: "1", amount: 100, created_at: "2026-01-01T00:00:00Z" }),
      tx({ id: "2", amount: 100, created_at: "2026-01-08T00:00:00Z" }),
      tx({ id: "3", amount: 100, created_at: "2026-01-15T00:00:00Z" }),
      tx({ id: "4", amount: 100, created_at: "2026-01-22T00:00:00Z" }),
      tx({ id: "5", amount: 100, created_at: "2026-01-29T00:00:00Z" }),
      tx({ id: "6", amount: 100, created_at: "2026-02-05T00:00:00Z" }),
    ];
    const result = computeBehavioralRisk({ transactions: txs, streakDays: 20, longestStreak: 20, now });
    expect(result.riskLevel).toBe("low");
    expect(["none", "motivational_celebration"]).toContain(result.recommendedInterventionType);
  });

  it("keeps riskScore within 0-100 regardless of how many factors trigger", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const txs = [
      tx({ id: "1", amount: 500, created_at: "2026-01-01T00:00:00Z" }),
      tx({ id: "2", amount: 10, created_at: "2026-01-02T00:00:00Z" }),
      tx({ id: "3", amount: 10, created_at: "2026-01-03T00:00:00Z" }),
      tx({ id: "4", amount: 10, created_at: "2026-01-04T00:00:00Z" }),
    ];
    const result = computeBehavioralRisk({ transactions: txs, streakDays: 0, longestStreak: 30, now });
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });
});
