// ─── Notification System Types ──────────────────────────────────────────────

export type NotificationType =
  | "streak_at_risk"
  | "daily_quest"
  | "weekly_expiry"
  | "seasonal_expiry"
  | "inactive"
  // Sprint 17: completing two of the four notification_preferences
  // categories left as "coming soon" placeholders in Sprint 16 (see that
  // migration's honesty note). "weekly_summaries" and
  // "product_announcements" remain unimplemented — see the Sprint 17
  // engineering audit for why those two are scoped out of this pass.
  | "achievement_unlocked"
  | "milestone_celebration"
  | "weekly_summary"
  // Sprint 22, Phase 4: accountability partners. No dedicated
  // notification_preferences category exists for these yet (that's Phase
  // 11 scope, same honesty-note pattern as 039_notification_preferences.sql)
  // — for now they're gated only by profiles.notifications_enabled, the
  // same global switch canSendNotificationToUser() falls back to for any
  // type without a specific category. Documented here so that isn't a
  // surprise later.
  | "partner_request"
  | "partner_accepted"
  | "partner_nudge"
  // Sprint 22, Phase 11 continuation. group_quest_completed covers both
  // the brief's "Group achievement" and "Quest completion" bullets — on
  // reflection those describe the same underlying event (a group quest
  // finishing) from two angles, and firing two near-identical pushes for
  // one event would just be spam. Consolidated into one, documented here
  // rather than fabricating a second type to tick a box literally.
  | "friend_request"
  | "friend_accepted"
  | "group_invite"
  | "goal_invitation"
  | "group_quest_completed"
  | "partner_reminder"
  | "group_weekly_summary"
  // Sprint 27, Phase 3: Smart Reminder Engine. goal_almost_complete /
  // goal_deadline_approaching / missed_weekly_deposit are gated by the
  // existing "goal_reminders" category, fired from the per-user daily
  // loop in runDailyNotificationScheduler. group_quest_ending is
  // group-scoped rather than user-scoped, fired from its own scheduler —
  // gated by the "groups" category added in Phase 4 below (was
  // global-switch-only for the few days between Phase 3 and Phase 4
  // shipping; updated once the category existed).
  | "goal_almost_complete"
  | "goal_deadline_approaching"
  | "missed_weekly_deposit"
  | "group_quest_ending"
  // Sprint 27, Phase 5: Digest System. Makes the "monthly_summaries"
  // notification_preferences category (added in Phase 4, not-live until
  // now) live — gated the same way weekly_summary is, via
  // canSendNotificationToUser(userId, "monthly_summaries").
  | "monthly_summary";

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationLog {
  id: string;
  user_id: string;
  subscription_id: string | null;
  notification_type: NotificationType;
  title: string;
  body: string;
  sent_at: string;
  delivered_at: string | null;
  clicked_at: string | null;
  error: string | null;
}

export interface NotificationMetrics {
  total_sent: number;
  total_delivered: number;
  total_clicked: number;
  delivery_rate: string;
  click_rate: string;
  // Sprint 27, Phase 11: full engagement breakdown. total_delivered/
  // total_clicked/delivery_rate/click_rate above are kept for backward
  // compatibility with any existing reader of this type — the new
  // fields below are additive, not a replacement.
  total_opened: number;
  total_dismissed: number;
  total_converted: number;
  total_ignored: number;
  open_rate: string;
  dismiss_rate: string;
  conversion_rate: string;
  ignored_rate: string;
  by_type: {
    type: NotificationType;
    sent: number;
    delivered: number;
    clicked: number;
    opened: number;
    dismissed: number;
    converted: number;
    ignored: number;
  }[];
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  notificationId?: string;
  type: NotificationType;
}

export interface WebPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}