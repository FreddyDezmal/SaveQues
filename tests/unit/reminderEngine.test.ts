/**
 * tests/unit/reminderEngine.test.ts
 * Sprint 27 — Phase 3 (Smart Reminder Engine).
 */
import { describe, it, expect } from "vitest";
import {
  goalProgressFraction,
  goalRemainingAmount,
  goalDaysRemaining,
  pickNearestGoal,
  shouldSendGoalAlmostComplete,
  shouldSendGoalDeadlineApproaching,
  buildSmartSavingsReminderCopy,
  buildStreakReminderCopy,
  buildGoalAlmostCompleteCopy,
  buildGoalDeadlineCopy,
  buildMissedWeeklyDepositCopy,
  buildGroupQuestEndingCopy,
  isWithinQuietHours,
  isVacationActive,
  type ReminderGoalSnapshot,
} from "@/lib/reminderEngine";

function goal(overrides: Partial<ReminderGoalSnapshot> = {}): ReminderGoalSnapshot {
  return {
    id: "g1",
    title: "Emergency Fund",
    goalEmoji: "🎯",
    targetAmount: 1000,
    currentAmount: 200,
    targetDate: null,
    isPrimary: false,
    ...overrides,
  };
}

describe("goalProgressFraction", () => {
  it("computes a clamped 0-1 fraction", () => {
    expect(goalProgressFraction(goal({ currentAmount: 500, targetAmount: 1000 }))).toBe(0.5);
    expect(goalProgressFraction(goal({ currentAmount: 5000, targetAmount: 1000 }))).toBe(1);
    expect(goalProgressFraction(goal({ currentAmount: -50, targetAmount: 1000 }))).toBe(0);
  });

  it("is safe against a zero or missing target amount", () => {
    expect(goalProgressFraction(goal({ targetAmount: 0 }))).toBe(0);
  });
});

describe("goalRemainingAmount", () => {
  it("never returns negative", () => {
    expect(goalRemainingAmount(goal({ currentAmount: 1200, targetAmount: 1000 }))).toBe(0);
  });
  it("returns the gap otherwise", () => {
    expect(goalRemainingAmount(goal({ currentAmount: 880, targetAmount: 1000 }))).toBe(120);
  });
});

describe("goalDaysRemaining", () => {
  it("returns null when there's no target date", () => {
    expect(goalDaysRemaining(goal({ targetDate: null }))).toBeNull();
  });
  it("counts whole UTC days to the deadline", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    expect(goalDaysRemaining(goal({ targetDate: "2026-07-23" }), now)).toBe(3);
  });
  it("goes negative once the deadline has passed", () => {
    const now = new Date("2026-07-25T00:00:00.000Z");
    expect(goalDaysRemaining(goal({ targetDate: "2026-07-23" }), now)).toBe(-2);
  });
});

describe("pickNearestGoal", () => {
  const now = new Date("2026-07-20T00:00:00.000Z");

  it("returns null for an empty list", () => {
    expect(pickNearestGoal([], now)).toBeNull();
  });

  it("ignores completed goals", () => {
    const g = goal({ id: "done", currentAmount: 1000, targetAmount: 1000 });
    expect(pickNearestGoal([g], now)).toBeNull();
  });

  it("prefers the explicit primary goal over deadline or progress", () => {
    const primary = goal({ id: "primary", isPrimary: true, currentAmount: 10, targetAmount: 1000 });
    const soonerDeadline = goal({ id: "soon", targetDate: "2026-07-21" });
    expect(pickNearestGoal([soonerDeadline, primary], now)?.id).toBe("primary");
  });

  it("falls back to the soonest deadline when no goal is primary", () => {
    const far = goal({ id: "far", targetDate: "2026-12-01" });
    const near = goal({ id: "near", targetDate: "2026-07-22" });
    expect(pickNearestGoal([far, near], now)?.id).toBe("near");
  });

  it("falls back to highest progress when nothing has a deadline", () => {
    const behind = goal({ id: "behind", currentAmount: 100, targetAmount: 1000 });
    const ahead = goal({ id: "ahead", currentAmount: 800, targetAmount: 1000 });
    expect(pickNearestGoal([behind, ahead], now)?.id).toBe("ahead");
  });
});

describe("shouldSendGoalAlmostComplete", () => {
  it("is false below the threshold", () => {
    expect(shouldSendGoalAlmostComplete(goal({ currentAmount: 500, targetAmount: 1000 }))).toBe(false);
  });
  it("is true at or above 90% but not yet complete", () => {
    expect(shouldSendGoalAlmostComplete(goal({ currentAmount: 900, targetAmount: 1000 }))).toBe(true);
    expect(shouldSendGoalAlmostComplete(goal({ currentAmount: 950, targetAmount: 1000 }))).toBe(true);
  });
  it("is false once the goal is actually complete", () => {
    expect(shouldSendGoalAlmostComplete(goal({ currentAmount: 1000, targetAmount: 1000 }))).toBe(false);
  });
});

describe("shouldSendGoalDeadlineApproaching", () => {
  const now = new Date("2026-07-20T00:00:00.000Z");

  it("is false with no deadline", () => {
    expect(shouldSendGoalDeadlineApproaching(goal({ targetDate: null }), now)).toBe(false);
  });
  it("is true within the default 3-day window", () => {
    expect(shouldSendGoalDeadlineApproaching(goal({ targetDate: "2026-07-22" }), now)).toBe(true);
  });
  it("is false outside the window", () => {
    expect(shouldSendGoalDeadlineApproaching(goal({ targetDate: "2026-08-01" }), now)).toBe(false);
  });
  it("is false once the deadline is already in the past", () => {
    expect(shouldSendGoalDeadlineApproaching(goal({ targetDate: "2026-07-01" }), now)).toBe(false);
  });
  it("is false for a goal that's already complete, even if the deadline is close", () => {
    const complete = goal({ targetDate: "2026-07-21", currentAmount: 1000, targetAmount: 1000 });
    expect(shouldSendGoalDeadlineApproaching(complete, now)).toBe(false);
  });
});

describe("buildSmartSavingsReminderCopy", () => {
  it("prefers goal-remaining-amount copy when a goal is available", () => {
    const result = buildSmartSavingsReminderCopy({
      nearestGoal: goal({ title: "Emergency Fund", currentAmount: 880, targetAmount: 1000 }),
      level: { level: 11, xpTotal: 4200, currentLevelXP: 4000, nextLevelXP: 4500 },
    });
    expect(result.body).toContain("Emergency Fund");
    expect(result.body).not.toContain("XP");
  });

  it("falls back to XP-to-next-level copy when there's no goal", () => {
    const result = buildSmartSavingsReminderCopy({
      nearestGoal: null,
      level: { level: 11, xpTotal: 4420, currentLevelXP: 4000, nextLevelXP: 4500 },
    });
    expect(result.body).toContain("80 XP");
    expect(result.body).toContain("Level 12");
  });

  it("falls back to a generic nudge when neither signal is available", () => {
    const result = buildSmartSavingsReminderCopy({ nearestGoal: null, level: null });
    expect(result.title).toContain("Daily quest");
  });

  it("does not divide by zero at max level", () => {
    const result = buildSmartSavingsReminderCopy({
      nearestGoal: null,
      level: { level: 50, xpTotal: 999999, currentLevelXP: 900000, nextLevelXP: 900000 },
    });
    expect(result.title).toContain("Daily quest");
  });
});

describe("buildStreakReminderCopy", () => {
  it("includes the actual streak length in both title and body", () => {
    const result = buildStreakReminderCopy(34);
    expect(result.title).toContain("34");
    expect(result.body).toContain("34-day streak");
  });
});

describe("buildGoalAlmostCompleteCopy", () => {
  it("includes remaining amount and percentage", () => {
    const result = buildGoalAlmostCompleteCopy(goal({ currentAmount: 900, targetAmount: 1000, title: "New Laptop" }));
    expect(result.title).toContain("90%");
    expect(result.body).toContain("New Laptop");
  });
});

describe("buildGoalDeadlineCopy", () => {
  it("says 'today' when zero days remain", () => {
    const result = buildGoalDeadlineCopy(goal(), 0);
    expect(result.title).toContain("today");
  });
  it("pluralizes days correctly", () => {
    expect(buildGoalDeadlineCopy(goal(), 1).title).toContain("1 day");
    expect(buildGoalDeadlineCopy(goal(), 3).title).toContain("3 days");
  });
});

describe("buildMissedWeeklyDepositCopy", () => {
  it("references the nearest goal when one exists", () => {
    const result = buildMissedWeeklyDepositCopy(goal({ title: "Vacation Fund" }));
    expect(result.body).toContain("Vacation Fund");
  });
  it("falls back to generic copy with no goal", () => {
    const result = buildMissedWeeklyDepositCopy(null);
    expect(result.body).not.toContain("undefined");
  });
});

describe("buildGroupQuestEndingCopy", () => {
  it("mentions the quest title and group name", () => {
    const result = buildGroupQuestEndingCopy("The Savers Club", "Weekend Sprint", 1);
    expect(result.title).toContain("Weekend Sprint");
    expect(result.body).toContain("The Savers Club");
  });
  it("says 'today' for a same-day deadline", () => {
    expect(buildGroupQuestEndingCopy("Group", "Quest", 0).title).toContain("today");
  });
});

describe("isWithinQuietHours", () => {
  it("is always false when disabled, regardless of hour", () => {
    expect(isWithinQuietHours(23, false, 22, 7)).toBe(false);
  });

  it("handles a same-day window (e.g. 13-15) with plain between semantics", () => {
    expect(isWithinQuietHours(14, true, 13, 15)).toBe(true);
    expect(isWithinQuietHours(15, true, 13, 15)).toBe(false); // end is exclusive
    expect(isWithinQuietHours(12, true, 13, 15)).toBe(false);
  });

  it("handles an overnight window (e.g. 22-7) that wraps midnight", () => {
    expect(isWithinQuietHours(23, true, 22, 7)).toBe(true);
    expect(isWithinQuietHours(3, true, 22, 7)).toBe(true);
    expect(isWithinQuietHours(6, true, 22, 7)).toBe(true);
    expect(isWithinQuietHours(7, true, 22, 7)).toBe(false); // end is exclusive
    expect(isWithinQuietHours(12, true, 22, 7)).toBe(false);
  });

  it("treats a zero-width window (start === end) as never active", () => {
    expect(isWithinQuietHours(10, true, 9, 9)).toBe(false);
  });
});

describe("isVacationActive", () => {
  it("is false when vacation mode is off", () => {
    expect(isVacationActive(false, "2026-08-01", "2026-07-23")).toBe(false);
  });

  it("is true indefinitely when no end date is set", () => {
    expect(isVacationActive(true, null, "2026-12-31")).toBe(true);
  });

  it("is true while today is on or before the end date", () => {
    expect(isVacationActive(true, "2026-08-01", "2026-07-23")).toBe(true);
    expect(isVacationActive(true, "2026-08-01", "2026-08-01")).toBe(true);
  });

  it("auto-expires the day after the end date", () => {
    expect(isVacationActive(true, "2026-08-01", "2026-08-02")).toBe(false);
  });
});
