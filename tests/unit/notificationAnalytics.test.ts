/**
 * tests/unit/notificationAnalytics.test.ts
 * Sprint 27 — Phase 11 (Notification Analytics).
 */
import { describe, it, expect } from "vitest";
import {
  countEngagement,
  computeEngagementRates,
  computeEngagementBreakdown,
  computeEngagementByType,
  type NotificationLogRow,
} from "@/lib/notificationAnalytics";

function row(overrides: Partial<NotificationLogRow> = {}): NotificationLogRow {
  return {
    notification_type: "streak_at_risk",
    sent_at: "2026-07-20T10:00:00.000Z",
    delivered_at: null,
    clicked_at: null,
    read_at: null,
    dismissed_at: null,
    converted_at: null,
    ...overrides,
  };
}

describe("countEngagement", () => {
  it("counts zero for everything on an empty array", () => {
    expect(countEngagement([])).toEqual({
      sent: 0, delivered: 0, opened: 0, clicked: 0, dismissed: 0, converted: 0, ignored: 0,
    });
  });

  it("counts each column independently", () => {
    const rows = [
      row({ delivered_at: "t" }),
      row({ delivered_at: "t", read_at: "t" }),
      row({ delivered_at: "t", clicked_at: "t" }),
      row({ delivered_at: "t", dismissed_at: "t" }),
      row({ delivered_at: "t", clicked_at: "t", converted_at: "t" }),
    ];
    const counts = countEngagement(rows);
    expect(counts.sent).toBe(5);
    expect(counts.delivered).toBe(5);
    expect(counts.opened).toBe(1);
    expect(counts.clicked).toBe(2);
    expect(counts.dismissed).toBe(1);
    expect(counts.converted).toBe(1);
  });

  it("classifies a row as ignored only when delivered but nothing else happened", () => {
    const ignored = row({ delivered_at: "t" });
    const notIgnoredClicked = row({ delivered_at: "t", clicked_at: "t" });
    const notIgnoredUndelivered = row(); // never delivered — not "ignored", just never shown
    const counts = countEngagement([ignored, notIgnoredClicked, notIgnoredUndelivered]);
    expect(counts.ignored).toBe(1);
  });

  it("does not count an undelivered row as ignored", () => {
    const counts = countEngagement([row()]); // delivered_at null
    expect(counts.ignored).toBe(0);
  });
});

describe("computeEngagementRates", () => {
  it("is all zeros (not NaN/Infinity) with zero sent", () => {
    const rates = computeEngagementRates({ sent: 0, delivered: 0, opened: 0, clicked: 0, dismissed: 0, converted: 0, ignored: 0 });
    expect(Object.values(rates).every((v) => v === "0")).toBe(true);
  });

  it("computes click rate against delivered, not sent", () => {
    const rates = computeEngagementRates({ sent: 10, delivered: 5, opened: 0, clicked: 5, dismissed: 0, converted: 0, ignored: 0 });
    expect(rates.click_rate).toBe("100.0"); // 5/5 delivered clicked, not 5/10 sent
  });

  it("computes conversion rate against clicked, not sent or delivered", () => {
    const rates = computeEngagementRates({ sent: 100, delivered: 50, opened: 0, clicked: 10, dismissed: 0, converted: 5, ignored: 0 });
    expect(rates.conversion_rate).toBe("50.0"); // 5/10 clicked converted
  });

  it("is safe against a zero denominator for a rate whose specific denominator is zero", () => {
    const rates = computeEngagementRates({ sent: 10, delivered: 0, opened: 0, clicked: 0, dismissed: 0, converted: 0, ignored: 0 });
    expect(rates.click_rate).toBe("0"); // delivered=0, would be 0/0 without the guard
  });
});

describe("computeEngagementBreakdown", () => {
  it("combines counts and rates into one object", () => {
    const breakdown = computeEngagementBreakdown([row({ delivered_at: "t", clicked_at: "t" })]);
    expect(breakdown.sent).toBe(1);
    expect(breakdown.click_rate).toBe("100.0");
  });
});

describe("computeEngagementByType", () => {
  it("groups rows by notification_type and computes a breakdown per group", () => {
    const rows = [
      row({ notification_type: "streak_at_risk", delivered_at: "t", clicked_at: "t" }),
      row({ notification_type: "streak_at_risk", delivered_at: "t" }),
      row({ notification_type: "achievement_unlocked", delivered_at: "t", clicked_at: "t" }),
    ];
    const byType = computeEngagementByType(rows);
    expect(byType).toHaveLength(2);
    const streak = byType.find((t) => t.type === "streak_at_risk")!;
    expect(streak.sent).toBe(2);
    expect(streak.clicked).toBe(1);
    const achievement = byType.find((t) => t.type === "achievement_unlocked")!;
    expect(achievement.sent).toBe(1);
    expect(achievement.click_rate).toBe("100.0");
  });

  it("returns an empty array for no rows", () => {
    expect(computeEngagementByType([])).toEqual([]);
  });
});
