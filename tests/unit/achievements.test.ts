/**
 * tests/unit/achievements.test.ts
 *
 * Sprint 18 — Phase 3. Tests checkAchievements() (lib/achievements.ts) —
 * the pure function that decides which achievements are newly unlocked.
 * The most important property under test isn't "does condition X unlock
 * achievement Y" (there are ~40 of these, mostly simple threshold checks)
 * but the two structural guarantees the whole system depends on:
 *   1. an already-earned achievement is never re-returned (idempotency —
 *      this is what makes it safe to call on every deposit/goal action)
 *   2. two DIFFERENT achievements can legitimately unlock from the same
 *      single check() call when their conditions both happen to be true
 *      at once (documented here explicitly, since it looks at first
 *      glance like it might be a bug — see the night_owl/early_bird case)
 */
import { describe, it, expect } from "vitest";
import { checkAchievements, getAlmostMessages } from "@/lib/achievements";

const baseParams = {
  streakDays: 0,
  totalSaved: 0,
  goalsCompleted: 0,
  activeGoals: 0,
  challengesCompleted: 0,
  dailyQuestsCompleted: 0,
  weeklyQuestsCompleted: 0,
  questChainsCompleted: 0,
  earnedIds: [] as string[],
};

describe("checkAchievements", () => {
  it("returns an empty array when no thresholds are met", () => {
    expect(checkAchievements(baseParams)).toEqual([]);
  });

  it("unlocks a simple threshold achievement when the condition is first met", () => {
    const result = checkAchievements({ ...baseParams, streakDays: 7 });
    expect(result.map((a) => a.id)).toContain("streak_7");
  });

  it("unlocks every threshold achievement that the value has passed, not just the highest one", () => {
    // A user who jumps straight to a 30-day streak (e.g. backfilled/synced
    // data) should get streak_1, streak_3, streak_7, streak_14, AND
    // streak_30 all at once, not just streak_30.
    const result = checkAchievements({ ...baseParams, streakDays: 30 });
    const ids = result.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(["streak_1", "streak_3", "streak_7", "streak_14", "streak_21", "streak_30"])
    );
    expect(ids).not.toContain("streak_45"); // not yet reached
  });

  it("CRITICAL — never re-awards an achievement already present in earnedIds, even though its condition is still true", () => {
    // This is the property that makes it safe to call checkAchievements on
    // every single deposit: without this, a user would be re-awarded
    // streak_7's XP bonus every day their streak stays above 7.
    const result = checkAchievements({
      ...baseParams,
      streakDays: 7,
      earnedIds: ["streak_1", "streak_3", "streak_7"],
    });
    const ids = result.map((a) => a.id);
    expect(ids).not.toContain("streak_1");
    expect(ids).not.toContain("streak_3");
    expect(ids).not.toContain("streak_7");
  });

  it("only returns the NEWLY crossed thresholds when some were already earned", () => {
    const result = checkAchievements({
      ...baseParams,
      streakDays: 14,
      earnedIds: ["streak_1", "streak_3", "streak_7"],
    });
    const ids = result.map((a) => a.id);
    expect(ids).toEqual(["streak_14"]);
  });

  it("treats a missing optional field as its documented safe default rather than throwing", () => {
    // transactionHour, transactionAmount, etc. are all optional — a caller
    // that only has streak/savings data (e.g. a nightly batch job with no
    // per-transaction context) must not crash checkAchievements.
    expect(() => checkAchievements(baseParams)).not.toThrow();
  });

  it("does NOT unlock early_bird or night_owl when transactionHour is omitted", () => {
    const result = checkAchievements(baseParams);
    const ids = result.map((a) => a.id);
    expect(ids).not.toContain("early_bird");
    expect(ids).not.toContain("night_owl");
  });

  it("legitimately unlocks BOTH early_bird and night_owl from the same call when the hour qualifies for both — not a bug, both conditions are independently true for hours 0-3", () => {
    const result = checkAchievements({ ...baseParams, transactionHour: 2 });
    const ids = result.map((a) => a.id);
    expect(ids).toContain("early_bird"); // hour < 6
    expect(ids).toContain("night_owl");  // 0 <= hour < 4
  });

  it("unlocks early_bird but NOT night_owl for an hour that only satisfies one condition", () => {
    const result = checkAchievements({ ...baseParams, transactionHour: 5 });
    const ids = result.map((a) => a.id);
    expect(ids).toContain("early_bird");
    expect(ids).not.toContain("night_owl");
  });

  it("first_save unlocks from totalSaved alone, without requiring transactionCount", () => {
    const result = checkAchievements({ ...baseParams, totalSaved: 10 });
    expect(result.map((a) => a.id)).toContain("first_save");
  });

  it("big_deposit requires the threshold amount on THIS transaction specifically, not lifetime total", () => {
    const result = checkAchievements({ ...baseParams, totalSaved: 50, transactionAmount: 1000 });
    expect(result.map((a) => a.id)).toContain("big_deposit");
  });

  it("speed_30 unlocks at exactly 30 days, and does not unlock when omitted (defaults to 999)", () => {
    const fast = checkAchievements({ ...baseParams, goalCompletedInDays: 30 });
    const noData = checkAchievements(baseParams);
    expect(fast.map((a) => a.id)).toContain("speed_30");
    expect(noData.map((a) => a.id)).not.toContain("speed_30");
  });
});

describe("getAlmostMessages — savings-proximity message currency awareness (Sprint 31, Phase 5)", () => {
  const almostParams = {
    streakDays: 0,
    totalSaved: 45, // 90% of the 50 target — within the 75% proximity window
    goalsCompleted: 0,
    challengesCompleted: 0,
    dailyQuestsCompleted: 0,
    earnedIds: [] as string[],
  };

  it("defaults to ZAR/en-ZA formatting when no currency is passed (previous hardcoded 'R' behavior, preserved)", () => {
    const [hint] = getAlmostMessages(almostParams);
    expect(hint.message).toMatch(/^R\D*5/); // "R" prefix, remaining = 5
  });

  it("uses the user's real currency when passed, instead of a hardcoded R", () => {
    const [hint] = getAlmostMessages({ ...almostParams, currencyCode: "USD", locale: "en-US" });
    expect(hint.message).toContain("$5");
    expect(hint.message).not.toMatch(/^R\d/);
  });

  it("never throws for any supported currency", () => {
    expect(() => getAlmostMessages({ ...almostParams, currencyCode: "JPY", locale: "ja-JP" })).not.toThrow();
  });
});
