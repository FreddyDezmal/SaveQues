/**
 * lib/billing/entitlements.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 2: the ONE service
 * every premium feature asks. This is the module the brief means by
 * "never scattered `if(user.isPremium)` checks" — a route or component
 * calls `hasFeature(userId, "ai_coaching")` or `getEntitlements(userId)`
 * and never reads `subscriptions`/`plan_features` rows itself.
 *
 * SECURITY (Phase 14 — "server remains authoritative")
 *   getEntitlements() always re-derives from the `subscriptions` table,
 *   which is only ever written by the webhook handler (service-role
 *   client) or a server-side checkout/portal route — never by a
 *   client-writable column. There is deliberately no client-settable
 *   "isPremium" flag anywhere in this codebase for a route to
 *   accidentally trust. A canceled/past_due subscription silently falls
 *   back to the free plan's entitlements (see resolveEffectivePlan)
 *   rather than continuing to grant premium access — Stripe's own
 *   recommended pattern (react to `status`, don't assume "has a
 *   subscription row" means "is entitled").
 */

import { createServiceClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";
import { getCatalogue, getDefaultPlan } from "./plans";
import type { Entitlements, Subscription, SubscriptionStatus } from "./types";

const log = createLogger("billing.entitlements");

/** Statuses that should currently unlock paid features. Exported (not
 *  just a private const) so tests can assert the exact allow-list
 *  without needing to exercise the I/O-heavy functions around it. */
export const ENTITLED_STATUSES: SubscriptionStatus[] = ["active", "trialing"];

/** Pure: is this status one that currently unlocks paid features. */
export function isEntitledStatus(status: SubscriptionStatus | null | undefined): boolean {
  return !!status && ENTITLED_STATUSES.includes(status);
}

/**
 * Pure: builds the `features` map for a given plan id from an already-
 * loaded catalogue. No I/O — this is the piece of getEntitlements()'s
 * logic that's actually worth unit-testing directly (see
 * tests/unit/entitlements.test.ts), same "pure function core" split as
 * lib/featureFlags.ts's evaluateFlag().
 */
export function buildFeatureMap(
  planId: string,
  features: { key: string }[],
  planFeatures: { planId: string; featureKey: string; isEnabled: boolean; limitValue: number | null }[]
): Entitlements["features"] {
  const forPlan = planFeatures.filter((pf) => pf.planId === planId);
  const result: Entitlements["features"] = {};
  for (const feature of features) {
    const pf = forPlan.find((x) => x.featureKey === feature.key);
    result[feature.key] = {
      enabled: pf?.isEnabled ?? false,
      limit: pf ? pf.limitValue : 0,
    };
  }
  return result;
}

function rowToSubscription(row: any): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    status: row.status,
    provider: row.provider,
    providerCustomerId: row.provider_customer_id,
    providerSubscriptionId: row.provider_subscription_id,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: row.canceled_at,
    trialEnd: row.trial_end,
  };
}

/** Fetches the raw subscription row for a user, or null if none exists
 *  (every user who hasn't subscribed has no row — they're implicitly on
 *  the default/free plan, not a subscription with status='free'). */
export async function getSubscription(userId: string): Promise<Subscription | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToSubscription(data) : null;
  } catch (err) {
    log.error("Failed to load subscription", { user_id: userId, error: (err as Error)?.message });
    captureError(err as Error, { route: "billing.entitlements.getSubscription", userId });
    return null; // fail closed to free-plan entitlements, never to premium
  }
}

/**
 * Resolves which plan a user's entitlements should be computed from right
 * now. A subscription row in a non-entitled status (canceled, past_due,
 * etc.) resolves to the default/free plan even though the row itself
 * still says plan_id='premium' — the row remembers what they were
 * subscribed to; this function decides what they're entitled to today.
 */
async function resolveEffectivePlan(sub: Subscription | null): Promise<{ planId: string; status: SubscriptionStatus | "free" }> {
  if (sub && isEntitledStatus(sub.status)) {
    return { planId: sub.planId, status: sub.status };
  }
  const fallback = await getDefaultPlan();
  return { planId: fallback?.id ?? "free", status: sub?.status ?? "free" };
}

/**
 * The single entry point for "what can this user do right now." Never
 * throws — resolution failures fall back to the default plan's
 * entitlements (safe default: under-grant, never over-grant).
 */
export async function getEntitlements(userId: string): Promise<Entitlements> {
  const [sub, catalogue] = await Promise.all([getSubscription(userId), getCatalogue()]);
  const { planId, status } = await resolveEffectivePlan(sub);

  const plan = catalogue.plans.find((p) => p.id === planId);
  const features = buildFeatureMap(planId, catalogue.features, catalogue.planFeatures);

  return {
    planId,
    planName: plan?.name ?? "Free",
    status,
    isPremium: status !== "free" && isEntitledStatus(status as SubscriptionStatus),
    features,
  };
}

/** Convenience for boolean-kind features: is this feature available at all. */
export async function hasFeature(userId: string, featureKey: string): Promise<boolean> {
  const entitlements = await getEntitlements(userId);
  return entitlements.features[featureKey]?.enabled ?? false;
}

/** Convenience for limit-kind features: the numeric ceiling, or null for
 *  unlimited. Returns 0 (not null) if the feature isn't granted at all,
 *  so a naive `remaining > 0` check by a caller fails safe. */
export async function getFeatureLimit(userId: string, featureKey: string): Promise<number | null> {
  const entitlements = await getEntitlements(userId);
  const f = entitlements.features[featureKey];
  if (!f || !f.enabled) return 0;
  return f.limit; // null = unlimited
}
