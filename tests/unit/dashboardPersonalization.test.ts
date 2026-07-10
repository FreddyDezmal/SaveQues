/**
 * tests/unit/dashboardPersonalization.test.ts
 * Sprint 20 — Phase 12.
 */
import { describe, it, expect } from "vitest";
import { classifyJourneyStage, getDashboardSectionOrder } from "@/lib/dashboardPersonalization";

describe("classifyJourneyStage", () => {
  it("classifies a brand-new account as 'new'", () => {
    expect(classifyJourneyStage({ accountAgeDays: 1, depositCount: 0, completedGoalCount: 0 })).toBe("new");
  });

  it("classifies zero deposits as 'new' even on an older account", () => {
    expect(classifyJourneyStage({ accountAgeDays: 40, depositCount: 0, completedGoalCount: 0 })).toBe("new");
  });

  it("classifies an account under 30 days with some deposits as 'growing'", () => {
    expect(classifyJourneyStage({ accountAgeDays: 15, depositCount: 3, completedGoalCount: 0 })).toBe("growing");
  });

  it("classifies an established, not-yet-veteran account as 'experienced'", () => {
    expect(classifyJourneyStage({ accountAgeDays: 45, depositCount: 15, completedGoalCount: 1 })).toBe("experienced");
  });

  it("classifies a long-lived, high-completion account as 'veteran'", () => {
    expect(classifyJourneyStage({ accountAgeDays: 120, depositCount: 40, completedGoalCount: 4 })).toBe("veteran");
  });

  it("does not classify a 90+ day account with low activity as 'veteran'", () => {
    expect(classifyJourneyStage({ accountAgeDays: 120, depositCount: 5, completedGoalCount: 0 })).not.toBe("veteran");
  });
});

describe("getDashboardSectionOrder", () => {
  it("returns a non-empty, stage-specific order for every stage", () => {
    for (const stage of ["new", "growing", "experienced", "veteran"] as const) {
      const order = getDashboardSectionOrder(stage);
      expect(order.length).toBeGreaterThan(0);
    }
  });

  it("puts onboarding first for new users and forecasts/trends first for veterans", () => {
    expect(getDashboardSectionOrder("new")[0]).toBe("onboarding_prompts");
    expect(getDashboardSectionOrder("veteran")[0]).toBe("trends");
  });
});
