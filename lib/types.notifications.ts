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
  | "group_weekly_summary";

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
  by_type: {
    type: NotificationType;
    sent: number;
    delivered: number;
    clicked: number;
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