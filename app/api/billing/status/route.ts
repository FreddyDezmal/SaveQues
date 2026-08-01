/**
 * app/api/billing/status/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * GET /api/billing/status — Sprint 29, Phase 10/11: the one endpoint client
 * components call to render premium badges, locked cards, and the upgrade
 * screen's "your current usage" section. Wraps getEntitlements() +
 * getSubscription() + checkUsage() for every limit feature so the client
 * never queries `subscriptions`/`usage_counters` directly (it CAN, per
 * their RLS SELECT-own policies, but funnelling through one endpoint keeps
 * the shape stable and avoids N client-side round trips).
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";
import { getEntitlements, getSubscription } from "@/lib/billing/entitlements";
import { checkUsage } from "@/lib/billing/usage";
import { getCatalogue } from "@/lib/billing/plans";

const log = createLogger("billing.status");

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  setSentryUser(user.id);

  try {
    const [entitlements, subscription, catalogue] = await Promise.all([
      getEntitlements(user.id),
      getSubscription(user.id),
      getCatalogue(),
    ]);

    const limitFeatures = catalogue.features.filter((f) => f.kind === "limit");
    const usage = Object.fromEntries(
      await Promise.all(
        limitFeatures.map(async (f) => [f.key, await checkUsage(user.id, f.key)] as const)
      )
    );

    return NextResponse.json({
      entitlements,
      usage,
      subscription: subscription
        ? {
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            hasBillingAccount: !!subscription.providerCustomerId,
          }
        : null,
      plans: catalogue.plans,
    });
  } catch (err) {
    log.error("Failed to load billing status", { user_id: user.id, error: (err as Error)?.message });
    captureError(err as Error, { route: "GET /api/billing/status", userId: user.id });
    return NextResponse.json({ error: "Could not load billing status" }, { status: 500 });
  }
}
