"use client";

/**
 * lib/hooks/useFeatureEntitlement.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 30 — Phase 12: Security audit.
 *
 * AUDIT FINDING: PremiumForecastCard and PremiumCoachingCard each
 * independently wrote the exact same "is this user entitled to this
 * boolean feature" expression:
 *
 *   const entitled = !loading && isPremium && (status?.entitlements.features[KEY]?.enabled ?? false);
 *
 * — identical except for the feature key string. Not itself a security
 * hole (both copies were correct), but "no duplicated authorization
 * logic" is explicit in this sprint's brief for a reason: two copies of
 * the same check can silently drift (e.g. one gets updated to also
 * require a specific limit value, or to handle a new entitlement
 * status, and the other doesn't). This hook is the one place that
 * expression lives now.
 *
 * Client-side entitlement checks like this are a DISPLAY gate, not a
 * security boundary — see this hook's own note below. The actual
 * enforcement for anything that consumes a resource (scenario runs,
 * saved scenarios, exports) happens server-side via
 * lib/billing/gate.ts's enforceUsageLimit()/lib/billing/entitlements.ts's
 * getFeatureLimit(), regardless of what this hook reports. Every server
 * route re-derives entitlement from the database on every request — a
 * user cannot make themselves "entitled" by manipulating client state,
 * because the client's belief about entitlement is never trusted for
 * anything that costs the business money or lets a user exceed a real
 * plan limit. This hook only controls what free-tier UI *shows*
 * (locked-preview vs. unlocked), which is the same "preview real
 * content, blurred" trade-off LockedCard's own header already documents
 * as an intentional product decision, not an oversight.
 */

import { useBillingStatus } from "@/lib/hooks/useBillingStatus";

export function useFeatureEntitlement(featureKey: string): { entitled: boolean; loading: boolean } {
  const { status, loading, isPremium } = useBillingStatus();

  // Fails toward "not entitled" while loading or on any missing/partial
  // data — same fail-closed rule useBillingStatus's own docs state.
  const entitled = !loading && isPremium && (status?.entitlements.features[featureKey]?.enabled ?? false);

  return { entitled, loading };
}
