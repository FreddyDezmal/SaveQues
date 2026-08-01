/**
 * tests/unit/billing/entitlements.test.ts
 *
 * Sprint 29 — Premium Subscription Platform, Phase 16. Tests the PURE
 * logic in lib/billing/entitlements.ts: which statuses are entitled, and
 * how a plan id + catalogue rows resolve into the Entitlements.features
 * map. Does NOT test getEntitlements()/getSubscription() themselves —
 * those are thin Supabase-fetching wrappers around this logic, same
 * documented gap as tests/unit/featureFlags.test.ts leaves for
 * getEvaluatedFlags()/isFeatureEnabled(). See BILLING_AUDIT.md /
 * SPRINT29_SUMMARY.md for the honest accounting of what's covered here
 * vs. what would need an integration test against a real/mocked DB.
 */
import { describe, it, expect } from "vitest";
import { isEntitledStatus, buildFeatureMap, ENTITLED_STATUSES } from "@/lib/billing/entitlements";

describe("isEntitledStatus", () => {
  it("treats active and trialing as entitled", () => {
    expect(isEntitledStatus("active")).toBe(true);
    expect(isEntitledStatus("trialing")).toBe(true);
  });

  it("treats every other known status as not entitled", () => {
    for (const status of ["past_due", "canceled", "incomplete", "incomplete_expired", "unpaid"] as const) {
      expect(isEntitledStatus(status)).toBe(false);
    }
  });

  it("treats null/undefined as not entitled", () => {
    expect(isEntitledStatus(null)).toBe(false);
    expect(isEntitledStatus(undefined)).toBe(false);
  });

  it("ENTITLED_STATUSES is exactly {active, trialing} — guards against accidental widening", () => {
    expect([...ENTITLED_STATUSES].sort()).toEqual(["active", "trialing"]);
  });
});

describe("buildFeatureMap", () => {
  const features = [
    { key: "goals_limit" },
    { key: "ai_coaching" },
    { key: "advanced_analytics" },
  ];

  const planFeatures = [
    { planId: "free", featureKey: "goals_limit", isEnabled: true, limitValue: 5 },
    { planId: "premium", featureKey: "goals_limit", isEnabled: true, limitValue: null },
    { planId: "premium", featureKey: "ai_coaching", isEnabled: true, limitValue: null },
    { planId: "premium", featureKey: "advanced_analytics", isEnabled: true, limitValue: null },
  ];

  it("grants only what plan_features declares for that plan", () => {
    const map = buildFeatureMap("free", features, planFeatures);
    expect(map.goals_limit).toEqual({ enabled: true, limit: 5 });
  });

  it("features with no plan_features row for this plan resolve to not-enabled, limit 0", () => {
    const map = buildFeatureMap("free", features, planFeatures);
    expect(map.ai_coaching).toEqual({ enabled: false, limit: 0 });
    expect(map.advanced_analytics).toEqual({ enabled: false, limit: 0 });
  });

  it("null limitValue means unlimited, preserved as null (not 0 or Infinity)", () => {
    const map = buildFeatureMap("premium", features, planFeatures);
    expect(map.goals_limit.limit).toBeNull();
    expect(map.goals_limit.enabled).toBe(true);
  });

  it("an unknown plan id grants nothing (every feature not-enabled)", () => {
    const map = buildFeatureMap("nonexistent", features, planFeatures);
    for (const f of features) {
      expect(map[f.key]).toEqual({ enabled: false, limit: 0 });
    }
  });

  it("does not leak another plan's rows into this plan's map", () => {
    const map = buildFeatureMap("free", features, planFeatures);
    expect(map.ai_coaching.enabled).toBe(false); // premium-only, must not leak to free
  });
});
