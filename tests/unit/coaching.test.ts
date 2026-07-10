/**
 * tests/unit/coaching.test.ts
 * Sprint 19 — Phase 11.
 */
import { describe, it, expect } from "vitest";
import { generateCoachingMessages, coachingMessagesForGoal } from "@/lib/coaching";
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

function goal(overrides: Partial<SavingsGoal>): Pick<SavingsGoal, "id" | "title" | "target_amount" | "current_amount" | "target_date" | "is_complete"> {
  return {
    id: "g1",
    title: "New Laptop",
    target_amount: 1000,
    current_amount: 800,
    target_date: null,
    is_complete: false,
    ...overrides,
  };
}

describe("generateCoachingMessages", () => {
  it("produces no messages for a completed goal", () => {
    const messages = coachingMessagesForGoal(goal({ is_complete: true }), []);
    expect(messages).toEqual([]);
  });

  it("surfaces an 'almost there' message when few deposits remain at recent pace", () => {
    const txs = [
      tx({ created_at: "2026-02-01T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-08T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
    ];
    // remaining = 1000 - 800 = 200, avg of last 3 = 100 -> 2 deposits away
    const messages = coachingMessagesForGoal(goal({ current_amount: 800 }), txs);
    const almost = messages.find((m) => m.id === "almost_there");
    expect(almost).toBeDefined();
    expect(almost!.message).toContain("New Laptop");
  });

  it("never produces a message that references a target date when none is set", () => {
    const txs = [tx({ created_at: "2026-02-01T00:00:00Z", amount: 100 })];
    const messages = coachingMessagesForGoal(goal({ target_date: null }), txs);
    for (const m of messages) {
      expect(m.message.toLowerCase()).not.toContain("target date");
    }
  });

  it("sorts messages by priority, highest first", () => {
    const txs = [
      tx({ created_at: "2026-02-01T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-08T00:00:00Z", amount: 100 }),
      tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
    ];
    const messages = generateCoachingMessages({
      transactions: txs,
      goals: [goal({ current_amount: 800 })],
      transactionsByGoal: { g1: txs },
    });
    const priorities = messages.map((m) => m.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });
});
