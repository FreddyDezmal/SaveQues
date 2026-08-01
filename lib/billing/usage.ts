/**
 * lib/billing/usage.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 5: usage limits.
 *
 * Two entry points a gated route calls, in order:
 *   1. checkUsage(userId, featureKey) — read-only: "would this action be
 *      allowed right now." Call BEFORE performing the gated action.
 *   2. recordUsage(userId, featureKey) — increments the counter. Call
 *      AFTER the gated action succeeds (same "log after success, not
 *      before" convention as lib/auditLog.ts) so a failed write never
 *      consumes a unit of quota.
 *
 * For 'lifetime' features (e.g. goals_limit — a count of currently-active
 * goals, not a rate), callers should prefer computing the live count
 * directly (e.g. `goals.length`) rather than this counter, since a
 * lifetime counter would need to be decremented on delete to stay
 * accurate and this module does not do that bookkeeping. checkUsage()
 * documents this per-feature below. usage_counters is the right fit for
 * genuinely period-scoped, monotonically-increasing-within-the-period
 * actions: exports this month, scenario runs today.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";
import { getFeature } from "./plans";
import { getFeatureLimit } from "./entitlements";
import type { ResetPeriod, UsageCheckResult } from "./types";

const log = createLogger("billing.usage");

/** Pure: computes the period_start key for a given reset cadence, as of
 *  right now (UTC). Exported so tests can assert exact boundary behavior
 *  without mocking Supabase — same "pure function, unit-test directly"
 *  split used throughout lib/billing/. */
export function periodStartFor(reset: ResetPeriod): string {
  const now = new Date();
  if (reset === "day") {
    return now.toISOString().slice(0, 10); // UTC date, e.g. '2026-07-31'
  }
  if (reset === "month") {
    return `${now.toISOString().slice(0, 7)}-01`; // first of UTC month
  }
  return "1970-01-01"; // 'lifetime' sentinel — one row ever, per migration 069's comment
}

async function getCurrentCount(userId: string, featureKey: string, periodStart: string): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("usage_counters")
    .select("count")
    .eq("user_id", userId)
    .eq("feature_key", featureKey)
    .eq("period_start", periodStart)
    .maybeSingle();
  if (error) throw error;
  return data?.count ?? 0;
}

/**
 * Read-only check: is the user allowed to perform the action gated by
 * `featureKey` right now, given their current usage and plan limit.
 * Never throws — a lookup failure fails CLOSED (allowed: false) for
 * limit features, since silently allowing unlimited usage on an error is
 * the unsafe direction here (unlike entitlement lookups elsewhere, which
 * fail toward under-granting a boolean feature, not toward letting a
 * counter run away).
 */
export async function checkUsage(userId: string, featureKey: string): Promise<UsageCheckResult> {
  try {
    const [feature, limit] = await Promise.all([getFeature(featureKey), getFeatureLimit(userId, featureKey)]);

    if (!feature || feature.kind !== "limit") {
      throw new Error(`checkUsage called for non-limit feature "${featureKey}"`);
    }

    if (limit === null) {
      // Unlimited on the user's current plan — skip the count query entirely.
      return { allowed: true, used: 0, limit: null, remaining: null };
    }
    if (limit === 0) {
      return { allowed: false, used: 0, limit: 0, remaining: 0 };
    }

    const periodStart = periodStartFor(feature.resetPeriod ?? "lifetime");
    const used = await getCurrentCount(userId, featureKey, periodStart);
    const remaining = Math.max(0, limit - used);
    return { allowed: used < limit, used, limit, remaining };
  } catch (err) {
    log.error("checkUsage failed, failing closed", { user_id: userId, feature_key: featureKey, error: (err as Error)?.message });
    captureError(err as Error, { route: "billing.usage.checkUsage", userId, featureKey });
    return { allowed: false, used: 0, limit: 0, remaining: 0 };
  }
}

/**
 * Increments the usage counter for the current period. Call only after
 * the gated action has actually succeeded. Uses an upsert with a raw SQL
 * increment (not read-then-write) to stay correct under concurrent
 * requests — same reasoning lib/rateLimit.ts gives for counting rows
 * directly rather than maintaining an app-level counter naively.
 */
export async function recordUsage(userId: string, featureKey: string, amount = 1): Promise<void> {
  try {
    const feature = await getFeature(featureKey);
    if (!feature || feature.kind !== "limit") return;

    const periodStart = periodStartFor(feature.resetPeriod ?? "lifetime");
    const supabase = createServiceClient();

    const { error } = await supabase.rpc("increment_usage_counter", {
      p_user_id: userId,
      p_feature_key: featureKey,
      p_period_start: periodStart,
      p_amount: amount,
    });
    if (error) throw error;
  } catch (err) {
    // A failed increment must never fail the request that already
    // succeeded — same fire-and-forget philosophy as writeAuditLog().
    log.warn("recordUsage failed (non-fatal)", { user_id: userId, feature_key: featureKey, error: (err as Error)?.message });
    captureError(err as Error, { route: "billing.usage.recordUsage", userId, featureKey });
  }
}
