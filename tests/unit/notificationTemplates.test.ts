/**
 * tests/unit/notificationTemplates.test.ts
 * Sprint 27 — Phase 7 (Notification Templates).
 */
import { describe, it, expect, vi } from "vitest";
import {
  renderTemplate,
  renderNotificationTemplate,
  listTemplateKeys,
} from "@/lib/notificationTemplates";

describe("renderTemplate", () => {
  it("substitutes a single variable", () => {
    expect(renderTemplate("Hello {{name}}", { name: "Alex" })).toBe("Hello Alex");
  });

  it("substitutes multiple variables, including repeats", () => {
    expect(renderTemplate("{{name}} and {{name}} again", { name: "X" })).toBe("X and X again");
  });

  it("coerces numeric variables to strings", () => {
    expect(renderTemplate("You have {{xp}} XP", { xp: 420 })).toBe("You have 420 XP");
  });

  it("leaves an unmatched placeholder visible rather than blanking it", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(renderTemplate("Hello {{name}}", {})).toBe("Hello {{name}}");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns a plain string unchanged when it has no placeholders", () => {
    expect(renderTemplate("No variables here", { unused: "x" })).toBe("No variables here");
  });
});

describe("renderNotificationTemplate", () => {
  it("renders both title and body for a known key", () => {
    const result = renderNotificationTemplate("streak_at_risk", { days: 34 });
    expect(result.title).toBe("🔥 Your 34-day streak is at risk!");
    expect(result.body).toBe("One deposit today keeps your 34-day streak alive.");
  });

  it("throws on an unknown template key", () => {
    expect(() => renderNotificationTemplate("not_a_real_key", {})).toThrow(/Unknown template key/);
  });

  it("falls back to the default locale ('en') for an unregistered locale rather than throwing", () => {
    const result = renderNotificationTemplate("streak_at_risk", { days: 5 }, "fr");
    expect(result.title).toContain("5-day streak");
  });

  it("renders the goal-deadline template family correctly per day count", () => {
    expect(renderNotificationTemplate("goal_deadline_today", { amount: "R100" }).title).toContain("due today");
    expect(renderNotificationTemplate("goal_deadline_one_day", { amount: "R100" }).title).toContain("due in 1 day");
    expect(renderNotificationTemplate("goal_deadline_many_days", { amount: "R100", days: 3 }).title).toContain("due in 3 days");
  });

  it("renders the smart daily-quest goal/xp/generic variants", () => {
    expect(
      renderNotificationTemplate("daily_quest_goal", { goal_emoji: "🎯", amount: "R50", goal_name: "Emergency Fund" }).body
    ).toContain("Emergency Fund");
    expect(renderNotificationTemplate("daily_quest_xp", { xp: 80, level: 12 }).body).toContain("80 XP away from Level 12");
    expect(renderNotificationTemplate("daily_quest_generic", {}).title).toContain("Daily quest");
  });
});

describe("listTemplateKeys", () => {
  it("returns a non-empty list including a few known keys", () => {
    const keys = listTemplateKeys();
    expect(keys.length).toBeGreaterThan(20);
    expect(keys).toContain("streak_at_risk");
    expect(keys).toContain("achievement_unlocked");
    expect(keys).toContain("monthly_summary");
  });
});
