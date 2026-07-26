/**
 * tests/unit/notificationTaxonomy.test.ts
 * Sprint 27 — Phase 2: Notification Center → full inbox.
 */
import { describe, it, expect } from "vitest";
import { getNotificationTaxonomy, NOTIFICATION_CATEGORY_ORDER, NOTIFICATION_CATEGORY_LABELS } from "@/lib/notificationTaxonomy";
import type { NotificationType } from "@/lib/types.notifications";

const ALL_TYPES: NotificationType[] = [
  "streak_at_risk", "daily_quest", "weekly_expiry", "seasonal_expiry", "inactive",
  "achievement_unlocked", "milestone_celebration", "weekly_summary",
  "partner_request", "partner_accepted", "partner_nudge", "partner_reminder",
  "friend_request", "friend_accepted", "group_invite", "goal_invitation",
  "group_quest_completed", "group_weekly_summary",
  // Sprint 27, Phase 3
  "goal_almost_complete", "goal_deadline_approaching", "missed_weekly_deposit", "group_quest_ending",
  // Sprint 27, Phase 5
  "monthly_summary",
];

describe("getNotificationTaxonomy", () => {
  it("returns a valid category/priority for every real NotificationType", () => {
    for (const type of ALL_TYPES) {
      const { category, priority } = getNotificationTaxonomy(type);
      expect(NOTIFICATION_CATEGORY_ORDER).toContain(category);
      expect(["high", "normal", "low"]).toContain(priority);
    }
  });

  it("classifies social types (friend requests) as social, not groups or partners", () => {
    expect(getNotificationTaxonomy("friend_request").category).toBe("social");
    expect(getNotificationTaxonomy("friend_accepted").category).toBe("social");
  });

  it("classifies partner-specific types distinctly from friend/social types", () => {
    expect(getNotificationTaxonomy("partner_request").category).toBe("partners");
    expect(getNotificationTaxonomy("partner_nudge").category).toBe("partners");
  });

  it("classifies group types as groups, not social", () => {
    expect(getNotificationTaxonomy("group_invite").category).toBe("groups");
    expect(getNotificationTaxonomy("group_quest_completed").category).toBe("groups");
  });

  it("marks hard-deadline quest types (weekly/seasonal expiry) as high priority", () => {
    expect(getNotificationTaxonomy("weekly_expiry").priority).toBe("high");
    expect(getNotificationTaxonomy("seasonal_expiry").priority).toBe("high");
  });

  it("marks digest-style summaries as low priority", () => {
    expect(getNotificationTaxonomy("weekly_summary").priority).toBe("low");
    expect(getNotificationTaxonomy("group_weekly_summary").priority).toBe("low");
    expect(getNotificationTaxonomy("monthly_summary").priority).toBe("low");
    expect(getNotificationTaxonomy("monthly_summary").category).toBe("system");
  });
});

describe("NOTIFICATION_CATEGORY_LABELS / NOTIFICATION_CATEGORY_ORDER", () => {
  it("has a label for every category in the order list, and vice versa", () => {
    for (const c of NOTIFICATION_CATEGORY_ORDER) {
      expect(NOTIFICATION_CATEGORY_LABELS[c]).toBeTruthy();
    }
    expect(Object.keys(NOTIFICATION_CATEGORY_LABELS).length).toBe(NOTIFICATION_CATEGORY_ORDER.length);
  });
});
