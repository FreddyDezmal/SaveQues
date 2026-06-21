/**
 * tests/unit/notifications.test.ts
 *
 * Sprint 11 — Phase 5: scheduler unit tests.
 *
 * Tests shouldNotifyUserNow(), the pure gating-decision function extracted
 * from runDailyNotificationScheduler() in this sprint specifically so it
 * could be tested directly. This is the exact mechanism Phase 1's
 * investigation centered on: the once-daily-cron-with-overdue-fallback
 * design from migration 017, which the original Scaling Audit incorrectly
 * claimed was broken. These tests assert the behavior Phase 1 verified by
 * reading the code — codifying that verification so a future change to
 * this function can't silently reintroduce the bug the audit worried about.
 */

import { describe, it, expect } from "vitest";
import { shouldNotifyUserNow, todayInTZ, currentHourInTZ } from "@/lib/notifications";

describe("shouldNotifyUserNow", () => {
  it("skips a user already notified today (their local date)", () => {
    const result = shouldNotifyUserNow({
      today: "2026-06-21",
      localHour: 20,
      notificationHour: 20,
      lastNotificationSentDate: "2026-06-21", // same as `today`
      yesterdayInTZ: "2026-06-20",
    });
    expect(result).toBe(false);
  });

  it("skips a user whose local time has not yet reached their preferred hour, and is not overdue", () => {
    const result = shouldNotifyUserNow({
      today: "2026-06-21",
      localHour: 14,             // 2 PM local
      notificationHour: 20,      // wants 8 PM
      lastNotificationSentDate: "2026-06-20", // notified yesterday — not overdue
      yesterdayInTZ: "2026-06-20",
    });
    expect(result).toBe(false);
  });

  it("notifies a user whose local time has reached their preferred hour", () => {
    const result = shouldNotifyUserNow({
      today: "2026-06-21",
      localHour: 20,
      notificationHour: 20,
      lastNotificationSentDate: "2026-06-20",
      yesterdayInTZ: "2026-06-20",
    });
    expect(result).toBe(true);
  });

  it("notifies a user whose local time is PAST their preferred hour", () => {
    const result = shouldNotifyUserNow({
      today: "2026-06-21",
      localHour: 23,
      notificationHour: 20,
      lastNotificationSentDate: "2026-06-20",
      yesterdayInTZ: "2026-06-20",
    });
    expect(result).toBe(true);
  });

  it("CRITICAL — the overdue fallback fires even when local time is BEFORE the preferred hour, " +
     "if the user has never been notified — this is the mechanism that makes a once-daily cron " +
     "correct for every timezone, the exact claim Phase 1 verified against the original Scaling Audit", () => {
    const result = shouldNotifyUserNow({
      today: "2026-06-21",
      localHour: 3,               // 3 AM local — cron landed at a bad time for this user
      notificationHour: 20,       // they want 8 PM, nowhere close
      lastNotificationSentDate: null, // never notified
      yesterdayInTZ: "2026-06-20",
    });
    expect(result).toBe(true);
  });

  it("CRITICAL — the overdue fallback also fires when the last notification was before yesterday, " +
     "even if local time is before the preferred hour — guarantees at least one notification per day", () => {
    const result = shouldNotifyUserNow({
      today: "2026-06-21",
      localHour: 3,
      notificationHour: 20,
      lastNotificationSentDate: "2026-06-19", // two days ago — before yesterday
      yesterdayInTZ: "2026-06-20",
    });
    expect(result).toBe(true);
  });

  it("does NOT treat 'notified yesterday' as overdue — only 'notified before yesterday' or never", () => {
    // This is the boundary case that distinguishes "working as designed"
    // from "notifies everyone every single run regardless of hour" — if
    // this assertion ever flips to true, the overdue fallback has become
    // too aggressive and the once-daily cadence guarantee is broken.
    const result = shouldNotifyUserNow({
      today: "2026-06-21",
      localHour: 3,
      notificationHour: 20,
      lastNotificationSentDate: "2026-06-20", // exactly yesterday
      yesterdayInTZ: "2026-06-20",
    });
    expect(result).toBe(false);
  });
});

describe("todayInTZ", () => {
  it("returns a YYYY-MM-DD formatted date string", () => {
    const result = todayInTZ("UTC");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to UTC-based formatting without throwing on an invalid timezone string", () => {
    // The fallback path (catch block) must never throw — record_app_open()'s
    // SQL-side equivalent fallback (migration 029) depends on the same
    // principle: a malformed timezone value must degrade gracefully, not
    // break the caller. This test covers the TypeScript-side helper;
    // migration 029's own header includes the SQL-side manual verification
    // steps for the BEGIN/EXCEPTION fallback in record_app_open() itself.
    expect(() => todayInTZ("Not/A/Real/Timezone")).not.toThrow();
  });

  it("offsets correctly by dayOffset", () => {
    const today = todayInTZ("UTC", 0);
    const yesterday = todayInTZ("UTC", -1);
    expect(new Date(today).getTime() - new Date(yesterday).getTime()).toBe(86400000);
  });
});

describe("currentHourInTZ", () => {
  it("returns an integer between 0 and 23", () => {
    const hour = currentHourInTZ("UTC");
    expect(Number.isInteger(hour)).toBe(true);
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
  });

  it("does not throw on an invalid timezone string", () => {
    expect(() => currentHourInTZ("Not/A/Real/Timezone")).not.toThrow();
  });
});