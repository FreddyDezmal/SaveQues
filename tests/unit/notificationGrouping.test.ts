/**
 * tests/unit/notificationGrouping.test.ts
 *
 * Sprint 18 — Phase 3. Tests groupNotifications() (lib/notificationGrouping.ts,
 * Sprint 16). The function's own doc comments describe several specific
 * behaviors worth pinning down with real assertions rather than trusting
 * the comments to stay true forever: the "2+ to group" threshold, the
 * "interrupted run doesn't merge across the gap" rule, and the unknown-type
 * fallback label.
 */
import { describe, it, expect } from "vitest";
import { groupNotifications, type GroupableNotification } from "@/lib/notificationGrouping";

function n(overrides: Partial<GroupableNotification>): GroupableNotification {
  return {
    id: Math.random().toString(36),
    notification_type: "daily_quest",
    title: "Test",
    body: "Test body",
    sent_at: new Date().toISOString(),
    read_at: null,
    ...overrides,
  };
}

describe("groupNotifications", () => {
  it("returns a single notification as-is, NOT as a 'group of 1'", () => {
    const result = groupNotifications([n({ notification_type: "streak_at_risk" })]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("single");
  });

  it("groups 2+ consecutive notifications of the same type into one group entry", () => {
    const result = groupNotifications([
      n({ notification_type: "achievement_unlocked" }),
      n({ notification_type: "achievement_unlocked" }),
      n({ notification_type: "achievement_unlocked" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("group");
    if (result[0].kind === "group") {
      expect(result[0].notifications).toHaveLength(3);
      expect(result[0].label).toBe("3 new achievements unlocked");
    }
  });

  it("does NOT merge the same type across a different type in between", () => {
    // quest, then a streak alert, then another quest -> two separate
    // single entries, not one merged group of 2 quests. This is the
    // "consecutive" behavior explicitly documented in the source.
    const result = groupNotifications([
      n({ notification_type: "daily_quest", id: "a" }),
      n({ notification_type: "streak_at_risk", id: "b" }),
      n({ notification_type: "daily_quest", id: "c" }),
    ]);
    expect(result).toHaveLength(3);
    expect(result.every((g) => g.kind === "single")).toBe(true);
  });

  it("falls back to a readable label (underscores replaced with spaces) for an unrecognized notification_type", () => {
    // This is the mechanism that lets a brand-new notification type group
    // correctly on day one without anyone updating a label map first.
    const result = groupNotifications([
      n({ notification_type: "some_future_type" }),
      n({ notification_type: "some_future_type" }),
    ]);
    expect(result[0].kind).toBe("group");
    if (result[0].kind === "group") {
      expect(result[0].label).toBe("2 new some future type");
    }
  });

  it("uses the known friendly label for a recognized type rather than the raw fallback", () => {
    const result = groupNotifications([
      n({ notification_type: "weekly_expiry" }),
      n({ notification_type: "weekly_expiry" }),
    ]);
    if (result[0].kind === "group") {
      expect(result[0].label).toBe("2 new quest deadline alerts");
    }
  });

  it("returns an empty array for an empty input", () => {
    expect(groupNotifications([])).toEqual([]);
  });

  it("preserves overall order — a group takes the position of its first item", () => {
    const result = groupNotifications([
      n({ notification_type: "inactive", id: "solo" }),
      n({ notification_type: "daily_quest", id: "g1" }),
      n({ notification_type: "daily_quest", id: "g2" }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("single");
    expect(result[1].kind).toBe("group");
  });
});
