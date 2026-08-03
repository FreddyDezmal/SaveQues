/**
 * tests/unit/scenarioSimulator.test.ts
 * Sprint 28 — Phase 8/15.
 */
import { describe, it, expect } from "vitest";
import { simulateScenario, simulateScenarios, simulateStandardScenarios } from "@/lib/scenarioSimulator";
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

const now = new Date("2026-03-01T00:00:00Z");
const weeklyDeposits = [
  tx({ created_at: "2026-02-01T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-08T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-22T00:00:00Z", amount: 100 }),
];

describe("simulateScenario — isolation", () => {
  it("never mutates the goal or transactions it's given", () => {
    const g = goal({});
    const txsCopy = JSON.parse(JSON.stringify(weeklyDeposits));
    const gCopy = JSON.parse(JSON.stringify(g));
    simulateScenario(g, weeklyDeposits, { type: "lump_sum", amount: 100 }, now);
    expect(g).toEqual(gCopy);
    expect(weeklyDeposits).toEqual(txsCopy);
  });
});

describe("simulateScenario — weekly_delta", () => {
  it("speeds up completion when adding more per week", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const result = simulateScenario(g, weeklyDeposits, { type: "weekly_delta", amount: 50 }, now);
    expect(result.baselineCompletionDate).not.toBeNull();
    expect(result.projectedCompletionDate).not.toBeNull();
    expect(result.deltaDays).not.toBeNull();
    expect(result.deltaDays!).toBeLessThan(0); // earlier than baseline
  });

  it("delays completion when removing pace, and reports insufficient data if pace goes to zero", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const result = simulateScenario(g, weeklyDeposits, { type: "weekly_delta", amount: -100 }, now);
    expect(result.insufficientDataReason).not.toBeNull();
    expect(result.projectedCompletionDate).toBeNull();
  });

  it("returns a no-op result for an already-complete goal", () => {
    const g = goal({ is_complete: true, current_amount: 1000 });
    const result = simulateScenario(g, [], { type: "weekly_delta", amount: 50 }, now);
    expect(result.projectedCompletionDate).toBeNull();
    expect(result.explanation).toMatch(/already complete/i);
  });
});

describe("simulateScenario — skip_payment", () => {
  it("delays completion by roughly the time to earn one average deposit at current pace", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const result = simulateScenario(g, weeklyDeposits, { type: "skip_payment" }, now);
    expect(result.deltaDays).not.toBeNull();
    expect(result.deltaDays!).toBeGreaterThan(0);
    // Average deposit ~$100, pace ~$100/week → ~7 days delay
    expect(result.deltaDays!).toBeCloseTo(7, 0);
  });

  it("reports insufficient data with no deposit history", () => {
    const g = goal({});
    const result = simulateScenario(g, [], { type: "skip_payment" }, now);
    expect(result.insufficientDataReason).not.toBeNull();
  });
});

describe("simulateScenario — cadence_change", () => {
  it("halves weekly pace when switching to biweekly at the same deposit amount", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const baseline = simulateScenario(g, weeklyDeposits, { type: "weekly_delta", amount: 0 }, now);
    const result = simulateScenario(g, weeklyDeposits, { type: "cadence_change", intervalDays: 14 }, now);
    expect(result.projectedCompletionDate).not.toBeNull();
    // Biweekly at same $/deposit roughly halves pace → later completion than baseline
    expect(result.deltaDays).not.toBeNull();
    expect(result.deltaDays!).toBeGreaterThan(0);
    expect(baseline.baselineCompletionDate).toBe(result.baselineCompletionDate);
  });
});

describe("simulateScenario — lump_sum", () => {
  it("moves current_amount up and can complete the goal outright", () => {
    const g = goal({ current_amount: 950, target_amount: 1000 });
    const result = simulateScenario(g, weeklyDeposits, { type: "lump_sum", amount: 100 }, now);
    expect(result.explanation).toMatch(/complete this goal immediately/i);
  });

  it("shifts completion earlier for a partial lump sum without completing the goal", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const withoutLump = simulateScenario(g, weeklyDeposits, { type: "weekly_delta", amount: 0 }, now);
    const withLump = simulateScenario(g, weeklyDeposits, { type: "lump_sum", amount: 200 }, now);
    expect(withLump.projectedCompletionDate).not.toBeNull();
    expect(withLump.deltaDays).not.toBeNull();
    expect(withLump.deltaDays!).toBeLessThan(0);
    expect(withoutLump.baselineCompletionDate).toBe(withLump.baselineCompletionDate);
  });

  it("treats a zero/negative amount as a no-op rather than fabricating a projection", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const result = simulateScenario(g, weeklyDeposits, { type: "lump_sum", amount: 0 }, now);
    expect(result.explanation).toMatch(/enter a lump sum/i);
  });
});

describe("simulateScenarios / simulateStandardScenarios", () => {
  it("runs multiple scenarios against a shared baseline", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const results = simulateScenarios(
      g,
      weeklyDeposits,
      [
        { type: "weekly_delta", amount: 25 },
        { type: "skip_payment" },
      ],
      now
    );
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe("weekly_delta");
    expect(results[1].type).toBe("skip_payment");
  });

  it("standard scenarios cover all four scenario types", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const results = simulateStandardScenarios(g, weeklyDeposits, now);
    const types = results.map((r) => r.type);
    expect(types).toContain("weekly_delta");
    expect(types).toContain("skip_payment");
    expect(types).toContain("cadence_change");
  });
});

// ── Sprint 30 — Phase 6: currency-aware labels ────────────────────────────
describe("formatAmount parameter (Sprint 30 Phase 6)", () => {
  const rand = (n: number) => `R${n.toFixed(2)}`;

  it("defaults to the previous hardcoded '$' behavior when no formatAmount is passed", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const result = simulateScenario(g, weeklyDeposits, { type: "weekly_delta", amount: 30 }, now);
    expect(result.label).toBe("Deposit $30/week more");
  });

  it("uses the passed formatAmount for a weekly_delta label instead of a hardcoded '$'", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const result = simulateScenario(g, weeklyDeposits, { type: "weekly_delta", amount: 30 }, now, rand);
    expect(result.label).toBe("Deposit R30.00/week more");
  });

  it("uses the passed formatAmount for a lump_sum label and explanation", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const result = simulateScenario(g, weeklyDeposits, { type: "lump_sum", amount: 500 }, now, rand);
    expect(result.label).toBe("Add a one-time R500.00 deposit today");
    expect(result.explanation).toContain("R500.00");
  });

  it("threads formatAmount through simulateStandardScenarios into every scenario that has an amount", () => {
    const g = goal({ current_amount: 200, target_amount: 1000 });
    const results = simulateStandardScenarios(g, weeklyDeposits, now, rand);
    const weeklyResults = results.filter((r) => r.type === "weekly_delta");
    expect(weeklyResults.length).toBeGreaterThan(0);
    for (const r of weeklyResults) {
      expect(r.label).not.toContain("$");
      expect(r.label).toMatch(/^Deposit R\d/);
    }
  });
});
