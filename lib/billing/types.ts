/**
 * lib/billing/types.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 2: shared domain
 * types. Mirrors the shape of migration 069's tables closely — this
 * file and the migration should be read together.
 *
 * Nothing in this file talks to Supabase or Stripe. Pure types only,
 * same "types file has zero I/O" convention as lib/types.notifications.ts.
 */

export type FeatureKind = "boolean" | "limit";
export type ResetPeriod = "lifetime" | "day" | "month";
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceCents: number | null;
  interval: "month" | "year";
  isDefault: boolean;
  isPurchasable: boolean;
  sortOrder: number;
}

export interface Feature {
  key: string;
  name: string;
  description: string | null;
  kind: FeatureKind;
  usageUnit: string | null;
  resetPeriod: ResetPeriod | null;
  sortOrder: number;
}

export interface PlanFeature {
  planId: string;
  featureKey: string;
  isEnabled: boolean;
  /** null = unlimited (only meaningful for kind='limit' features). */
  limitValue: number | null;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  provider: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  trialEnd: string | null;
}

/**
 * The one shape every premium feature check and every UI gate consumes.
 * This is deliberately the ONLY public surface of the entitlement system
 * — see Phase 2's "every premium feature should ask one central service"
 * requirement. Callers never read `plans`/`plan_features` rows directly.
 */
export interface Entitlements {
  planId: string;
  planName: string;
  status: SubscriptionStatus | "free";
  /** True for any status that should currently unlock paid features
   *  (active, trialing) — false for past_due/canceled/etc, which fall
   *  back to the free plan's entitlements even though a subscription
   *  row still exists (Phase 14: the server, not the client, decides). */
  isPremium: boolean;
  features: Record<
    string,
    { enabled: boolean; limit: number | null }
  >;
}

export interface UsageCheckResult {
  allowed: boolean;
  used: number;
  limit: number | null; // null = unlimited
  remaining: number | null; // null = unlimited
}
