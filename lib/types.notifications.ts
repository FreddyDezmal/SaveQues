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
  | "weekly_summary";

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
