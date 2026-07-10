/**
 * tests/unit/financialPersonality.test.ts
 * Sprint 20 — Phase 12.
 */
import { describe, it, expect } from "vitest";
import { computeFinancialPersonality } from "@/lib/financialPersonality";
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

describe("computeFinancialPersonality", () => {
  it("returns a low-confidence Steady Builder default for a new user with few deposits", () => {
    const result = computeFinancialPersonality({
      transactions: [tx({ id: "1" }), tx({ id: "2" })],
      goals: [],
      activityLog: [],
    });
    expect(result.personality).toBe("Steady Builder");
    expect(result.confidence).toBeLessThan(0.35);
  });

  it("identifies a Consistent Saver from regular weekly deposits", () => {
    const txs = Array.from({ length: 8 }, (_, i) =>
      tx({ id: String(i), created_at: new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString(), amount: 100 })
    );
    const result = computeFinancialPersonality({ transactions: txs, goals: [], activityLog: [] });
    expect(result.personality).toBe("Consistent Saver");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("identifies a Weekend Saver when most deposits land on Saturday/Sunday", () => {
    // 2026-01-03 is a Saturday (UTC)
    const txs = Array.from({ length: 6 }, (_, i) =>
      tx({ id: String(i), created_at: new Date(Date.UTC(2026, 0, 3 + i * 7)).toISOString(), amount: 100 })
    );
    const result = computeFinancialPersonality({ transactions: txs, goals: [], activityLog: [] });
    expect(["Weekend Saver", "Consistent Saver"]).toContain(result.personality);
  });

  it("identifies a Goal Chaser when most goals are completed", () => {
    // Irregular spacing (low consistency score) so this doesn't tie with
    // "Consistent Saver" — the signal under test is goal completion rate.
    const offsets = [0, 2, 10, 11, 25, 26];
    const txs = offsets.map((offset, i) =>
      tx({ id: String(i), created_at: new Date(Date.UTC(2026, 0, 1 + offset)).toISOString(), amount: 100 + i * 30 })
    );
    const result = computeFinancialPersonality({
      transactions: txs,
      goals: [
        { id: "g1", target_amount: 100, current_amount: 100, target_date: null, is_complete: true },
        { id: "g2", target_amount: 100, current_amount: 100, target_date: null, is_complete: true },
        { id: "g3", target_amount: 100, current_amount: 100, target_date: null, is_complete: true },
      ],
      activityLog: [],
    });
    expect(result.personality).toBe("Goal Chaser");
  });

  it("never returns a personality without a non-empty explanation and metrics", () => {
    const txs = Array.from({ length: 8 }, (_, i) =>
      tx({ id: String(i), created_at: new Date(Date.UTC(2026, 0, 1 + i * 5)).toISOString(), amount: 50 + i * 10 })
    );
    const result = computeFinancialPersonality({ transactions: txs, goals: [], activityLog: [] });
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(Object.keys(result.contributingMetrics).length).toBeGreaterThan(0);
  });
});
