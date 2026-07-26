/**
 * tests/unit/notificationActions.test.ts
 * Sprint 27 — Phase 2: Notification Center → full inbox.
 */
import { describe, it, expect } from "vitest";
import { resolveNotificationHref, getNotificationActionLabel } from "@/lib/notificationActions";

describe("resolveNotificationHref", () => {
  it("uses the real deep_link when present, regardless of type", () => {
    expect(resolveNotificationHref("streak_at_risk", "/goals/abc123")).toBe("/goals/abc123");
  });

  it("never falls back to /dashboard for a category with a more specific fallback page", () => {
    expect(resolveNotificationHref("friend_request", null)).not.toBe("/dashboard");
    expect(resolveNotificationHref("daily_quest", null)).not.toBe("/dashboard");
    expect(resolveNotificationHref("group_invite", null)).not.toBe("/dashboard");
    expect(resolveNotificationHref("partner_nudge", null)).not.toBe("/dashboard");
    expect(resolveNotificationHref("achievement_unlocked", null)).not.toBe("/dashboard");
    expect(resolveNotificationHref("milestone_celebration", null)).not.toBe("/dashboard");
  });

  it("falls back to a category-appropriate page matching the taxonomy", () => {
    expect(resolveNotificationHref("friend_request", null)).toBe("/friends");
    expect(resolveNotificationHref("daily_quest", null)).toBe("/quests");
    expect(resolveNotificationHref("group_invite", null)).toBe("/groups");
    expect(resolveNotificationHref("partner_nudge", null)).toBe("/partner");
    expect(resolveNotificationHref("milestone_celebration", null)).toBe("/goals");
  });

  it("system-category types legitimately fall back to /dashboard (not a bug — see file header)", () => {
    expect(resolveNotificationHref("streak_at_risk", null)).toBe("/dashboard");
  });

  it("Sprint 27 Phase 3/5 additions fall back to their taxonomy category, not /dashboard", () => {
    expect(resolveNotificationHref("goal_almost_complete", null)).toBe("/goals");
    expect(resolveNotificationHref("goal_deadline_approaching", null)).toBe("/goals");
    expect(resolveNotificationHref("group_quest_ending", null)).toBe("/groups");
    // monthly_summary is taxonomy category "system" (same as weekly_summary),
    // so /dashboard here is the same legitimate fallback as streak_at_risk
    // above, not an oversight.
    expect(resolveNotificationHref("monthly_summary", null)).toBe("/dashboard");
  });
});

describe("getNotificationActionLabel", () => {
  it("returns a specific label for types that have one", () => {
    expect(getNotificationActionLabel("partner_nudge")).toBe("Reply");
    expect(getNotificationActionLabel("achievement_unlocked")).toBe("View badge");
    // Sprint 27, Phase 5: weekly/monthly summaries now deep-link to a real
    // /digest/[id] page instead of /dashboard, so they earned a specific
    // label too — this used to be the "returns null" example below.
    expect(getNotificationActionLabel("weekly_summary")).toBe("View recap");
    expect(getNotificationActionLabel("monthly_summary")).toBe("View recap");
  });

  it("returns null for types with no specific action beyond opening it", () => {
    expect(getNotificationActionLabel("inactive")).toBeNull();
    expect(getNotificationActionLabel("group_weekly_summary")).toBeNull();
  });
});
