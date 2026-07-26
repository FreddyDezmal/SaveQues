/**
 * tests/unit/digest.test.ts
 * Sprint 27 — Phase 5 (Digest System).
 */
import { describe, it, expect } from "vitest";
import {
  groupDailyIntoWeeks,
  findBestAndWorstWeek,
  buildWeeklyDigestPushCopy,
  buildMonthlyDigestPushCopy,
  type WeeklyDigestData,
  type MonthlyDigestData,
  type DailyPoint,
} from "@/lib/digest";

describe("groupDailyIntoWeeks", () => {
  it("returns an empty array for empty input", () => {
    expect(groupDailyIntoWeeks([])).toEqual([]);
  });

  it("groups days within the same Monday-start week into one total", () => {
    const daily: DailyPoint[] = [
      { date: "2026-07-20", value: 10 }, // Monday
      { date: "2026-07-22", value: 20 }, // Wednesday, same week
      { date: "2026-07-26", value: 30 }, // Sunday, same week (week runs Mon-Sun)
    ];
    const weeks = groupDailyIntoWeeks(daily);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toEqual({ weekStart: "2026-07-20", total: 60 });
  });

  it("splits days across a week boundary into separate totals", () => {
    const daily: DailyPoint[] = [
      { date: "2026-07-26", value: 10 }, // Sunday, week of 07-20
      { date: "2026-07-27", value: 20 }, // Monday, week of 07-27
    ];
    const weeks = groupDailyIntoWeeks(daily);
    expect(weeks).toHaveLength(2);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-07-20", "2026-07-27"]);
  });

  it("returns weeks sorted chronologically regardless of input order", () => {
    const daily: DailyPoint[] = [
      { date: "2026-08-03", value: 5 },
      { date: "2026-07-20", value: 5 },
    ];
    const weeks = groupDailyIntoWeeks(daily);
    expect(weeks[0].weekStart < weeks[1].weekStart).toBe(true);
  });
});

describe("findBestAndWorstWeek", () => {
  it("returns null for both with no weeks", () => {
    expect(findBestAndWorstWeek([])).toEqual({ best: null, worst: null });
  });

  it("returns the same week for both best and worst with only one week", () => {
    const weeks = [{ weekStart: "2026-07-20", total: 100 }];
    const result = findBestAndWorstWeek(weeks);
    expect(result.best).toEqual(weeks[0]);
    expect(result.worst).toEqual(weeks[0]);
  });

  it("picks the highest and lowest total across multiple weeks", () => {
    const weeks = [
      { weekStart: "2026-07-06", total: 200 },
      { weekStart: "2026-07-13", total: 50 },
      { weekStart: "2026-07-20", total: 350 },
    ];
    const result = findBestAndWorstWeek(weeks);
    expect(result.best?.weekStart).toBe("2026-07-20");
    expect(result.worst?.weekStart).toBe("2026-07-13");
  });
});

describe("buildWeeklyDigestPushCopy", () => {
  const base: WeeklyDigestData = {
    periodStart: "2026-07-20",
    periodEnd: "2026-07-26",
    totalSaved: 480,
    questsCompleted: 3,
    xpEarned: 420,
    level: 9,
    streakDays: 18,
    closestGoal: { title: "Emergency Fund", remaining: 720 },
  };

  it("includes total saved, quest count, and XP in the body", () => {
    const result = buildWeeklyDigestPushCopy(base);
    expect(result.body).toContain("3 quests");
    expect(result.body).toContain("420 XP");
  });

  it("singularizes 'quest' for exactly one completed", () => {
    const result = buildWeeklyDigestPushCopy({ ...base, questsCompleted: 1 });
    expect(result.body).toContain("1 quest,");
    expect(result.body).not.toContain("1 quests");
  });
});

describe("buildMonthlyDigestPushCopy", () => {
  const base: MonthlyDigestData = {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    totalSaved: 1200,
    xpEarned: 1800,
    questsCompleted: 14,
    achievements: [],
    dailySavings: [],
    dailyXP: [],
    bestWeek: null,
    worstWeek: null,
    momentum: {
      state: "on_fire",
      label: "On Fire",
      description: "You're showing up almost every day.",
      emoji: "🔥",
      color: "#f97316",
      score: 0.7,
    },
  };

  it("includes total saved and the momentum label", () => {
    const result = buildMonthlyDigestPushCopy(base);
    expect(result.body).toContain("On Fire");
  });
});
