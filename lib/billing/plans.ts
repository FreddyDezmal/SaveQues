/**
 * lib/billing/plans.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 3/4: plan & feature
 * catalogue.
 *
 * WHY A DB-BACKED CATALOGUE, NOT A CONSTANTS FILE
 *   The brief is explicit: "Do not hardcode plan names throughout the
 *   application" and "Do not hardcode numeric limits throughout the
 *   project." A TypeScript `const PLANS = {...}` file would still be
 *   hardcoding — it would just be hardcoded in one file instead of many.
 *   Migration 069 already made plans/features/plan_features real tables;
 *   this module is the one place that reads them, matching the same
 *   "server decides" shape used everywhere else in this codebase (e.g.
 *   lib/quests.ts reading quest_content rather than a constants file).
 *   Adding a third tier later is a seed-data INSERT, not a code change —
 *   exactly Phase 3's "future-ready without modification" requirement.
 *
 * CACHING
 *   Plan/feature/plan_feature rows change extremely rarely (an admin
 *   action, not a user action) so this module caches the joined catalogue
 *   in memory for the lifetime of the server process, with a short TTL as
 *   a safety net against a stale long-lived process after an admin edit.
 *   This mirrors lib/featureFlags.ts's own note that flag lookups must
 *   never add meaningful latency to a render.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";
import type { Plan, Feature, PlanFeature } from "./types";

const log = createLogger("billing.plans");

const CACHE_TTL_MS = 60_000;

interface Catalogue {
  plans: Plan[];
  features: Feature[];
  planFeatures: PlanFeature[];
  fetchedAt: number;
}

let cache: Catalogue | null = null;

function rowToPlan(row: any): Plan {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    interval: row.interval,
    isDefault: row.is_default,
    isPurchasable: row.is_purchasable,
    sortOrder: row.sort_order,
  };
}

function rowToFeature(row: any): Feature {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    kind: row.kind,
    usageUnit: row.usage_unit,
    resetPeriod: row.reset_period,
    sortOrder: row.sort_order,
  };
}

function rowToPlanFeature(row: any): PlanFeature {
  return {
    planId: row.plan_id,
    featureKey: row.feature_key,
    isEnabled: row.is_enabled,
    limitValue: row.limit_value,
  };
}

/**
 * Loads the full plan/feature catalogue, cached in-process for
 * CACHE_TTL_MS. Never throws — a fetch failure logs + reports to Sentry
 * and falls back to the last good cache (or an empty catalogue, which
 * causes every entitlement check to safely resolve to "not entitled"
 * rather than crash a render).
 */
export async function getCatalogue(): Promise<Catalogue> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  try {
    const supabase = createServiceClient();
    const [{ data: plans, error: plansErr }, { data: features, error: featuresErr }, { data: planFeatures, error: pfErr }] =
      await Promise.all([
        supabase.from("plans").select("*").order("sort_order"),
        supabase.from("features").select("*").order("sort_order"),
        supabase.from("plan_features").select("*"),
      ]);

    if (plansErr || featuresErr || pfErr) {
      throw plansErr ?? featuresErr ?? pfErr;
    }

    cache = {
      plans: (plans ?? []).map(rowToPlan),
      features: (features ?? []).map(rowToFeature),
      planFeatures: (planFeatures ?? []).map(rowToPlanFeature),
      fetchedAt: Date.now(),
    };
    return cache;
  } catch (err) {
    log.error("Failed to load plan catalogue", { error: (err as Error)?.message });
    captureError(err as Error, { route: "billing.plans.getCatalogue" });
    if (cache) return cache; // serve stale rather than fail closed everywhere
    return { plans: [], features: [], planFeatures: [], fetchedAt: Date.now() };
  }
}

/** Test/admin-action hook: force the next getCatalogue() call to refetch. */
export function invalidatePlanCache(): void {
  cache = null;
}

export async function getPlan(planId: string): Promise<Plan | null> {
  const { plans } = await getCatalogue();
  return plans.find((p) => p.id === planId) ?? null;
}

export async function getDefaultPlan(): Promise<Plan | null> {
  const { plans } = await getCatalogue();
  return plans.find((p) => p.isDefault) ?? plans[0] ?? null;
}

export async function getPurchasablePlans(): Promise<Plan[]> {
  const { plans } = await getCatalogue();
  return plans.filter((p) => p.isPurchasable);
}

export async function getFeature(key: string): Promise<Feature | null> {
  const { features } = await getCatalogue();
  return features.find((f) => f.key === key) ?? null;
}

export async function getPlanFeatures(planId: string): Promise<PlanFeature[]> {
  const { planFeatures } = await getCatalogue();
  return planFeatures.filter((pf) => pf.planId === planId);
}
