/**
 * lib/billing/gate.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 5. One helper every
 * usage-limited API route calls, so "check the limit, 403 with a
 * consistent shape if exceeded, record usage after success" isn't
 * hand-rolled per route (see app/api/export/transactions/route.ts and its
 * siblings for the call sites).
 */

import { NextResponse } from "next/server";
import { checkUsage, recordUsage } from "./usage";
import { trackServerEvent } from "@/lib/analytics-server";
import { BillingAnalyticsEvents } from "./analytics";

/**
 * Call BEFORE performing a period-scoped-limit-gated action (an export, a
 * scenario run). Returns `{ blocked: NextResponse }` if the user is over
 * their limit — return that response directly from the route. Returns
 * `{ blocked: null }` if the action may proceed; the caller is
 * responsible for calling `recordUsage(userId, featureKey)` afterward,
 * once the action has actually succeeded.
 */
export async function enforceUsageLimit(
  userId: string,
  featureKey: string,
  friendlyName: string
): Promise<{ blocked: NextResponse | null }> {
  const result = await checkUsage(userId, featureKey);
  if (result.allowed) return { blocked: null };

  trackServerEvent(BillingAnalyticsEvents.USAGE_LIMIT_REACHED, userId, {
    feature_key: featureKey,
    limit: result.limit,
  }).catch(() => {});

  return {
    blocked: NextResponse.json(
      {
        error: `You've reached your plan's ${friendlyName} limit${
          result.limit !== null ? ` (${result.limit})` : ""
        } for this period. Upgrade to Premium for unlimited access.`,
        code: "PLAN_LIMIT_REACHED",
        feature_key: featureKey,
        limit: result.limit,
        used: result.used,
      },
      { status: 403 }
    ),
  };
}

export { recordUsage };
