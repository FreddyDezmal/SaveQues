/**
 * lib/billing/analytics.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 12: billing event
 * catalogue. Kept in its own file (not appended to lib/analytics.ts's
 * AnalyticsEvents) because these events carry billing-specific
 * properties (plan_id, amount) that only billing routes need to know
 * the shape of — same reasoning lib/notifications.ts's own event names
 * live in lib/types.notifications.ts rather than the shared catalogue.
 * Values still flow through the same trackServerEvent()/PostHog pipeline
 * as every other event — this is a naming convenience, not a second
 * analytics system.
 *
 * PRIVACY (Phase 12 — "no invasive analytics, respect existing privacy
 * architecture"): only plan/billing metadata is ever attached (plan_id,
 * status, cancellation reason if the user supplies one). No payment
 * method, card, or Stripe customer PII is ever passed into an analytics
 * property — that data stays in Stripe, referenced only by
 * provider_customer_id in our own DB.
 */

export const BillingAnalyticsEvents = {
  CHECKOUT_STARTED:        "billing_checkout_started",
  CHECKOUT_COMPLETED:      "billing_checkout_completed",
  SUBSCRIPTION_ACTIVATED:  "billing_subscription_activated",
  SUBSCRIPTION_RENEWED:    "billing_subscription_renewed",
  SUBSCRIPTION_CANCELED:   "billing_subscription_canceled",
  SUBSCRIPTION_PAST_DUE:   "billing_subscription_past_due",
  SUBSCRIPTION_REACTIVATED:"billing_subscription_reactivated",
  PORTAL_OPENED:           "billing_portal_opened",
  UPGRADE_PROMPT_SHOWN:    "billing_upgrade_prompt_shown",
  UPGRADE_PROMPT_CLICKED:  "billing_upgrade_prompt_clicked",
  FEATURE_GATE_HIT:        "billing_feature_gate_hit",
  USAGE_LIMIT_REACHED:     "billing_usage_limit_reached",
} as const;

export type BillingAnalyticsEventName =
  (typeof BillingAnalyticsEvents)[keyof typeof BillingAnalyticsEvents];
