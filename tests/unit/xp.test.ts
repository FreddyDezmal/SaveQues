/**
 * tests/unit/xp.test.ts
 *
 * Sprint 18 — Phase 3. Tests the pure XP/leveling functions in lib/xp.ts.
 * Focus is on the boundaries — exact xpRequired thresholds, streak
 * multiplier cutoffs, and the rounding behavior in getXPForAction() — since
 * boundary bugs here are the kind that silently under- or over-award XP
 * for months before anyone notices a level-up happened one deposit too
 * early or late.
 */
import { describe, it, expect } from "vitest";
import {
  getLevelFromXP,
  calculateStreakMultiplier,
  getXPForAction,
  getStreakMultiplierLabel,
  LEVELS,
} from "@/lib/xp";

describe("getLevelFromXP", () => {
  it("returns level 1 at exactly 0 XP", () => {
    const result = getLevelFromXP(0);
    expect(result.level).toBe(1);
    expect(result.title).toBe("Savings Seedling");
    expect(result.progressPercent).toBe(0);
  });

  it("does NOT level up one XP below the threshold", () => {
    // Level 2 requires exactly 120 XP — 119 must still be level 1.
    const result = getLevelFromXP(119);
    expect(result.level).toBe(1);
  });

  it("levels up at exactly the threshold XP, not one above it", () => {
    const result = getLevelFromXP(120);
    expect(result.level).toBe(2);
    expect(result.title).toBe("Coin Keeper");
  });

  it("assigns the correct tier at a tier boundary (level 10 -> 11 crosses beginner -> apprentice)", () => {
    const level10 = getLevelFromXP(4400);
    const level11 = getLevelFromXP(5600);
    expect(level10.tier).toBe("beginner");
    expect(level11.tier).toBe("apprentice");
  });

  it("caps at level 50 and reports 100% progress regardless of how far past max XP", () => {
    const atMax = getLevelFromXP(493000);
    const wayPastMax = getLevelFromXP(10_000_000);
    expect(atMax.level).toBe(50);
    expect(atMax.progressPercent).toBe(100);
    expect(wayPastMax.level).toBe(50);
    expect(wayPastMax.progressPercent).toBe(100);
    expect(wayPastMax.title).toBe("Legendary Saver");
  });

  it("computes progressPercent as the fraction of the way to the NEXT level, not total progress", () => {
    // Level 1 (0 XP) -> Level 2 (120 XP). Halfway there = 60 XP.
    const result = getLevelFromXP(60);
    expect(result.level).toBe(1);
    expect(result.progressPercent).toBe(50);
  });

  it("LEVELS array is sorted ascending by xpRequired (a corrupted ordering would silently break getLevelFromXP's linear scan)", () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].xpRequired).toBeGreaterThan(LEVELS[i - 1].xpRequired);
    }
  });
});

describe("calculateStreakMultiplier", () => {
  it("returns 1.0 (no bonus) below the 7-day threshold", () => {
    expect(calculateStreakMultiplier(0)).toBe(1.0);
    expect(calculateStreakMultiplier(6)).toBe(1.0);
  });

  it.each([
    [7, 1.25],
    [13, 1.25], // still 1.25 — must not accidentally jump early to the 14-day tier
    [14, 1.5],
    [29, 1.5],
    [30, 2.0],
    [65, 2.0],
    [66, 3.0],
    [365, 3.0], // far past the top tier — must not overflow past 3.0
  ])("streak of %i days -> %fx multiplier", (days, expected) => {
    expect(calculateStreakMultiplier(days)).toBe(expected);
  });
});

describe("getXPForAction", () => {
  it("returns the base XP unmodified with no streak", () => {
    expect(getXPForAction("LOG_SAVING")).toBe(50);
    expect(getXPForAction("GOAL_COMPLETE")).toBe(1000);
  });

  it("applies the streak multiplier and rounds to the nearest integer", () => {
    // 50 * 1.25 = 62.5 -> rounds to 63 (JS Math.round rounds .5 up).
    // This exact half-integer case is worth pinning explicitly: a future
    // change to round-half-to-even (banker's rounding) would silently
    // shave 1 XP off this specific action/streak combination.
    expect(getXPForAction("LOG_SAVING", 7)).toBe(63);
  });

  it("applies the top-tier 3x multiplier correctly for a large base value", () => {
    expect(getXPForAction("STREAK_100", 66)).toBe(15000);
  });
});

describe("getStreakMultiplierLabel", () => {
  it("returns an empty string below the bonus threshold (no badge shown in the UI)", () => {
    expect(getStreakMultiplierLabel(6)).toBe("");
  });

  it("returns the correct label at each tier boundary", () => {
    expect(getStreakMultiplierLabel(7)).toBe("1.25× Streak Bonus");
    expect(getStreakMultiplierLabel(14)).toBe("1.5× Streak Bonus");
    expect(getStreakMultiplierLabel(30)).toBe("2× Streak Bonus!");
    expect(getStreakMultiplierLabel(66)).toBe("3× Streak Bonus!");
  });
});
