/**
 * tests/unit/interventions.test.ts
 * Sprint 21 — Phase 15.
 */
import { describe, it, expect } from "vitest";
import { generateInterventions } from "@/lib/interventions";
import type { BehavioralRisk } from "@/lib/riskEngine";
import type { BehaviorProfile } from "@/lib/behaviorProfile";
import type { AccountHealth } from "@/lib/accountHealth";

function baseRisk(overrides: Partial<BehavioralRisk> = {}): BehavioralRisk {
  return {
    riskScore: 0,
    riskLevel: "low",
    factors: [],
    confidence: 1,
    recommendedInterventionType: "none",
    hasEnoughData: true,
    ...overrides,
  };
}

function baseProfile(): BehaviorProfile {
  return { profile: "Building Habit", confidence: 0.5, explanation: "test", supportingMetrics: {} };
}

function baseHealth(overrides: Partial<AccountHealth> = {}): AccountHealth {
  return {
    score: 80,
    status: "Good",
    factors: [
      { name: "Consistency", points: 16, maxPoints: 20, explanation: "" },
      { name: "Savings growth", points: 16, maxPoints: 20, explanation: "" },
      { name: "Goal completion", points: 12, maxPoints: 15, explanation: "" },
      { name: "Deposit frequency", points: 12, maxPoints: 15, explanation: "" },
      { name: "Momentum", points: 12, maxPoints: 15, explanation: "" },
      { name: "Forecast reliability", points: 12, maxPoints: 15, explanation: "" },
    ],
    recommendations: [],
    trend: "stable",
    ...overrides,
  };
}

describe("generateInterventions", () => {
  it("returns an empty array when risk.hasEnoughData is false", () => {
    const result = generateInterventions({
      behaviorProfile: baseProfile(),
      risk: baseRisk({ hasEnoughData: false }),
      accountHealth: baseHealth(),
      coachingMessages: [],
    });
    expect(result).toEqual([]);
  });

  it("prioritizes streak_recovery above everything else when a collapsing streak is triggered", () => {
    const risk = baseRisk({
      riskScore: 60,
      factors: [
        { name: "Collapsing streak", triggered: true, weight: 10, explanation: "reset after 14 days" },
        { name: "Saving fatigue", triggered: true, weight: 15, explanation: "smaller deposits" },
      ],
    });
    const result = generateInterventions({ behaviorProfile: baseProfile(), risk, accountHealth: baseHealth(), coachingMessages: [] });
    expect(result[0].type).toBe("streak_recovery");
  });

  it("never returns more than 3 interventions", () => {
    const risk = baseRisk({
      riskScore: 90,
      factors: [
        { name: "Collapsing streak", triggered: true, weight: 10, explanation: "x" },
        { name: "Saving fatigue", triggered: true, weight: 15, explanation: "x" },
        { name: "Inactivity", triggered: true, weight: 15, explanation: "x" },
        { name: "Declining consistency", triggered: true, weight: 25, explanation: "x" },
      ],
    });
    const result = generateInterventions({
      behaviorProfile: baseProfile(),
      risk,
      accountHealth: baseHealth({ factors: baseHealth().factors.map((f) => (f.name === "Forecast reliability" ? { ...f, points: 3 } : f)) }),
      coachingMessages: [],
    });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("every intervention includes a non-empty reason, evidence, and expectedBenefit", () => {
    const risk = baseRisk({ riskScore: 25, factors: [{ name: "Inactivity", triggered: true, weight: 15, explanation: "12 days quiet" }] });
    const result = generateInterventions({ behaviorProfile: baseProfile(), risk, accountHealth: baseHealth(), coachingMessages: [] });
    for (const i of result) {
      expect(i.reason.length).toBeGreaterThan(0);
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.expectedBenefit.length).toBeGreaterThan(0);
    }
  });

  it("suggests a motivational_celebration only when risk is truly zero with no other triggers", () => {
    const result = generateInterventions({
      behaviorProfile: baseProfile(),
      risk: baseRisk({ riskScore: 0, factors: [] }),
      accountHealth: baseHealth(),
      coachingMessages: [],
    });
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("motivational_celebration");
  });
});
