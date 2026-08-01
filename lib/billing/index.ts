/**
 * lib/billing/index.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform. Barrel export + the one
 * function ("getBillingProvider") that decides which adapter is active.
 * Routes and components should import from "@/lib/billing", not from
 * individual files under lib/billing/, wherever practical — same
 * "import the barrel" convention as lib/push (see lib/reminderEngine.ts).
 */

import { stripeProvider } from "./providers/stripe";
import type { BillingProvider } from "./provider";

/** Only one provider today. When a second is added, this becomes a real
 *  selection (env var, or per-user stored preference) — the call sites
 *  below never change either way. */
export function getBillingProvider(): BillingProvider {
  return stripeProvider;
}

export * from "./types";
export * from "./provider";
export { getCatalogue, getPlan, getDefaultPlan, getPurchasablePlans, getFeature, getPlanFeatures } from "./plans";
export { getEntitlements, getSubscription, hasFeature, getFeatureLimit } from "./entitlements";
export { checkUsage, recordUsage } from "./usage";
