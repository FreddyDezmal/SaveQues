/**
 * tests/unit/utils.test.ts
 *
 * Sprint 18 — Phase 3. Tests the misc pure helpers in lib/utils.ts.
 * getDaysRemaining/getWeeksRemaining/timeAgo all depend on "now" — using
 * vi.setSystemTime() to pin a fixed instant rather than asserting against
 * the real wall clock, which would make these tests flaky (and, for
 * timeAgo's day-boundary tests, a real 1-second scheduling delay in CI
 * could flip an assertion from "23h ago" to "1d ago").
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  cn,
  formatPercent,
  getDaysRemaining,
  getWeeksRemaining,
  getCategoryById,
  timeAgo,
  GOAL_CATEGORIES,
} from "@/lib/utils";

describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts (last one wins)", () => {
    // tailwind-merge's actual job: two conflicting padding utilities should
    // collapse to just the last one, not both being present in the output.
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values (conditional classNames pattern)", () => {
    expect(cn("base", false && "hidden", undefined, "visible")).toBe("base visible");
  });
});

describe("formatPercent", () => {
  it("rounds to the nearest whole percent", () => {
    expect(formatPercent(33.4)).toBe("33%");
    expect(formatPercent(33.6)).toBe("34%");
  });

  it("clamps at 100% even when the underlying value exceeds it (e.g. an overshot goal)", () => {
    expect(formatPercent(142)).toBe("100%");
  });

  it("does not clamp on the low end (a negative value passes through rounded, not floored at 0)", () => {
    // Documenting actual current behavior, not necessarily ideal behavior —
    // if a goal progress calculation ever produces a negative percentage
    // upstream, this function will NOT hide that bug by clamping to 0%.
    expect(formatPercent(-5)).toBe("-5%");
  });
});

describe("getDaysRemaining / getWeeksRemaining", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes whole days remaining until a future date", () => {
    expect(getDaysRemaining("2026-07-11T00:00:00Z")).toBe(10);
  });

  it("never returns a negative number for a date in the past", () => {
    expect(getDaysRemaining("2026-06-01T00:00:00Z")).toBe(0);
  });

  it("converts days to whole weeks, rounding down", () => {
    // 10 days = 1 whole week remaining, not 1.43
    expect(getWeeksRemaining("2026-07-11T00:00:00Z")).toBe(1);
  });

  it("never returns negative weeks for a past date", () => {
    expect(getWeeksRemaining("2026-01-01T00:00:00Z")).toBe(0);
  });
});

describe("getCategoryById", () => {
  it("returns the matching category", () => {
    expect(getCategoryById("travel").label).toBe("Travel");
  });

  it("falls back to the LAST category (custom) for an unknown id, not the first", () => {
    // Worth pinning explicitly: GOAL_CATEGORIES[GOAL_CATEGORIES.length - 1]
    // is "custom" specifically because it's the most sensible fallback for
    // an id that doesn't match anything — falling back to "emergency"
    // (the first entry) instead would be a confusing regression.
    const fallback = getCategoryById("not-a-real-category");
    expect(fallback.id).toBe("custom");
    expect(fallback.id).toBe(GOAL_CATEGORIES[GOAL_CATEGORIES.length - 1].id);
  });
});

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for anything under 60 seconds ago", () => {
    expect(timeAgo(new Date("2026-07-01T11:59:30Z").toISOString())).toBe("just now");
  });

  it("returns minutes for 1-59 minutes ago", () => {
    expect(timeAgo(new Date("2026-07-01T11:45:00Z").toISOString())).toBe("15m ago");
  });

  it("returns hours for 1-23 hours ago", () => {
    expect(timeAgo(new Date("2026-07-01T09:00:00Z").toISOString())).toBe("3h ago");
  });

  it("returns days at 24+ hours ago", () => {
    expect(timeAgo(new Date("2026-06-29T12:00:00Z").toISOString())).toBe("2d ago");
  });

  it("accepts an epoch-ms number as well as an ISO string (the exact consolidation this function exists for — see its doc comment)", () => {
    const fifteenMinutesAgoMs = new Date("2026-07-01T11:45:00Z").getTime();
    expect(timeAgo(fifteenMinutesAgoMs)).toBe("15m ago");
  });

  it("never returns a negative duration for a timestamp slightly in the future (clock skew tolerance)", () => {
    const oneSecondInFuture = new Date("2026-07-01T12:00:01Z").toISOString();
    expect(timeAgo(oneSecondInFuture)).toBe("just now");
  });
});
