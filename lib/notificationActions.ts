/**
 * lib/notificationActions.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27 — Phase 2: Notification Center → full inbox.
 *
 * HONEST SCOPE NOTE — read before adding a new action here.
 *   The brief's examples include things like "Friend request → Accept /
 *   Decline" and "Partner nudge → Reply" as if the notification itself
 *   could perform that action inline, without navigating away. That's
 *   not what this file does. notification_logs has no structured
 *   payload for WHICH friend request, WHICH partner, or WHICH goal a
 *   given row is about — only free-text title/body and (as of this
 *   sprint) a deep_link URL. Building genuine inline "Accept" from the
 *   inbox would need a metadata column (e.g. { friend_request_id })
 *   threaded through every lib/notifications.ts send* wrapper and its
 *   call sites — real, valuable, but a separate, larger change than
 *   "add archive/delete/bulk actions," and NOT done here.
 *
 *   What this file actually provides: a single primary action button per
 *   notification, whose label matches the brief's language ("Accept" /
 *   "Reply" / "View rewards" / etc) but whose behavior is always
 *   "navigate to deep_link" — i.e. it takes the user to the real friends/
 *   partner/goal page where the actual accept/decline/reply UI already
 *   lives (that UI is NOT part of this sprint; it predates it). This is
 *   honestly less than "one-tap accept from the notification," and more
 *   than the unlabeled generic tap-to-open behavior that existed before.
 */

import type { NotificationType } from "@/lib/types.notifications";
import { getNotificationTaxonomy, type NotificationCategory } from "@/lib/notificationTaxonomy";

/** notification_types sent before this sprint (or any future send path that forgets to pass a url) have no deep_link. Route to the best available category-level page instead of /dashboard — see the brief's own "never dump users onto Dashboard" rule, which this fallback exists specifically to honor even for legacy rows. */
const CATEGORY_FALLBACK_HREF: Record<NotificationCategory, string> = {
  social: "/friends",
  goals: "/goals",
  quests: "/quests",
  achievements: "/profile",
  groups: "/groups",
  partners: "/partner",
  system: "/dashboard", // system-level notifications (streak, inactivity, weekly summary) genuinely are dashboard-relevant, not a fallback-of-last-resort here
};

export function resolveNotificationHref(type: NotificationType, deepLink: string | null): string {
  if (deepLink) return deepLink;
  const { category } = getNotificationTaxonomy(type);
  return CATEGORY_FALLBACK_HREF[category];
}

const ACTION_LABEL: Partial<Record<NotificationType, string>> = {
  friend_request: "Respond",
  partner_request: "Respond",
  partner_nudge: "Reply",
  partner_reminder: "Reply",
  achievement_unlocked: "View badge",
  milestone_celebration: "View goal",
  daily_quest: "View quest",
  weekly_expiry: "View quest",
  seasonal_expiry: "View quest",
  group_invite: "View invite",
  goal_invitation: "Join goal",
  group_quest_completed: "View rewards",
  streak_at_risk: "Log a saving",
  // Sprint 27, Phase 5: both now deep-link to a real /digest/[id] page
  // instead of /dashboard, so "view it" has become specific enough to
  // deserve a label — the comment below (originally about weekly_summary
  // having nothing more specific to say) predates this change.
  weekly_summary: "View recap",
  monthly_summary: "View recap",
};

/** Returns a primary action button label for a notification, or null if "Open" (the default tap-to-navigate behavior, no separate button needed) is the only sensible action — e.g. an inactive-reminder notification has nothing more specific to say than "come back". */
export function getNotificationActionLabel(type: NotificationType): string | null {
  return ACTION_LABEL[type] ?? null;
}
