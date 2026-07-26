/**
 * lib/notificationTaxonomy.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27 — Phase 2: Notification Center → full inbox.
 *
 * Single source of truth for "what category/priority is this
 * notification_type" — derived at READ time from notification_type
 * rather than stored per-row. Two reasons this is the right call over a
 * stored `category`/`priority` column:
 *   1. No retrofit needed — every one of the notification_logs rows
 *      already sent gets a correct category/priority immediately, for
 *      free, vs. needing a backfill migration for a stored column.
 *   2. One source of truth that can't drift — if the taxonomy changes
 *      later (e.g. reclassifying "milestone_celebration" from Goals to
 *      Achievements), every row reflects the new mapping instantly
 *      instead of old rows carrying a stale stored value.
 *
 * The exhaustive switch below is checked against lib/types.notifications.ts's
 * real NotificationType union — if a new notification_type is ever added
 * there without a case here, TypeScript's exhaustiveness check (the
 * `never` assertion in the default branch) fails the build rather than
 * silently falling back to a generic default.
 */

import type { NotificationType } from "@/lib/types.notifications";

export type NotificationCategory =
  | "social"
  | "goals"
  | "quests"
  | "achievements"
  | "groups"
  | "partners"
  | "system";

export type NotificationPriority = "high" | "normal" | "low";

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  social: "Social",
  goals: "Goals",
  quests: "Quests",
  achievements: "Achievements",
  groups: "Groups",
  partners: "Partners",
  system: "System",
};

interface TaxonomyEntry {
  category: NotificationCategory;
  priority: NotificationPriority;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled NotificationType in notificationTaxonomy.ts: ${x}`);
}

/**
 * The exhaustive mapping itself. A switch (not a Record) specifically so
 * TypeScript's control-flow analysis can prove every NotificationType is
 * handled — a Record<NotificationType, TaxonomyEntry> would ALSO be
 * exhaustive, but wouldn't fail as loudly (a missing key is just a type
 * error at the Record's definition site, easy to "fix" by adding a
 * throwaway entry) versus this shape, where the only way to satisfy the
 * compiler is a real case for the real type.
 */
export function getNotificationTaxonomy(type: NotificationType): TaxonomyEntry {
  switch (type) {
    case "streak_at_risk":
      return { category: "system", priority: "high" }; // time-sensitive same-day action
    case "daily_quest":
      return { category: "quests", priority: "normal" };
    case "weekly_expiry":
      return { category: "quests", priority: "high" }; // has a hard deadline
    case "seasonal_expiry":
      return { category: "quests", priority: "high" }; // has a hard deadline
    case "inactive":
      return { category: "system", priority: "low" }; // re-engagement nudge, not urgent
    case "achievement_unlocked":
      return { category: "achievements", priority: "normal" };
    case "milestone_celebration":
      return { category: "goals", priority: "normal" };
    case "weekly_summary":
      return { category: "system", priority: "low" };
    case "partner_request":
      return { category: "partners", priority: "normal" };
    case "partner_accepted":
      return { category: "partners", priority: "normal" };
    case "partner_nudge":
      return { category: "partners", priority: "normal" };
    case "partner_reminder":
      return { category: "partners", priority: "low" };
    case "friend_request":
      return { category: "social", priority: "normal" };
    case "friend_accepted":
      return { category: "social", priority: "normal" };
    case "group_invite":
      return { category: "groups", priority: "normal" };
    case "goal_invitation":
      return { category: "goals", priority: "normal" };
    case "group_quest_completed":
      return { category: "groups", priority: "normal" };
    case "group_weekly_summary":
      return { category: "groups", priority: "low" };
    case "goal_almost_complete":
      return { category: "goals", priority: "normal" }; // motivating, not urgent
    case "goal_deadline_approaching":
      return { category: "goals", priority: "high" }; // has a hard deadline
    case "missed_weekly_deposit":
      return { category: "goals", priority: "normal" };
    case "group_quest_ending":
      return { category: "groups", priority: "high" }; // has a hard deadline
    case "monthly_summary":
      return { category: "system", priority: "low" };
    default:
      return assertNever(type);
  }
}

/** Convenience for filter UIs — every category in a stable display order, "All" not included (that's the absence of a filter, not a category itself). */
export const NOTIFICATION_CATEGORY_ORDER: NotificationCategory[] = [
  "social", "goals", "quests", "achievements", "groups", "partners", "system",
];
