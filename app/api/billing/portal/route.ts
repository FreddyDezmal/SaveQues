/**
 * app/api/billing/portal/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/billing/portal — Sprint 29, Phase 8: Customer Portal.
 *
 * Redirects an existing subscriber into Stripe's hosted Customer Portal,
 * where they manage payment method, view billing history, and cancel —
 * "one portal entry point" per the brief, rather than SaveQuest building
 * its own payment-method/invoice UI.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";
import { trackServerEvent } from "@/lib/analytics-server";
import { BillingAnalyticsEvents } from "@/lib/billing/analytics";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { getBillingProvider } from "@/lib/billing";
import { getSubscription } from "@/lib/billing/entitlements";

const log = createLogger("billing.portal");

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  setSentryUser(user.id);

  const rateLimit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: "billing.portal",
    windowMinutes: 10,
    maxRequests: 10,
    actionLabel: "billing portal requests",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimit.message }, { status: 429 });
  }
  await recordAttempt(supabase, user.id, "billing.portal");

  const subscription = await getSubscription(user.id);
  if (!subscription?.providerCustomerId) {
    return NextResponse.json(
      { error: "No billing account found. Subscribe to Premium first." },
      { status: 404 }
    );
  }

  try {
    const provider = getBillingProvider();
    const { url } = await provider.createPortalSession({
      customerId: subscription.providerCustomerId,
      returnUrl: `${req.nextUrl.origin}/settings/billing`,
    });

    await trackServerEvent(BillingAnalyticsEvents.PORTAL_OPENED, user.id, { request_id: requestId });

    return NextResponse.json({ url });
  } catch (err) {
    log.error("Portal session creation failed", { user_id: user.id, request_id: requestId, error: (err as Error)?.message });
    captureError(err as Error, { route: "POST /api/billing/portal", userId: user.id });
    return NextResponse.json({ error: "Could not open billing portal. Please try again." }, { status: 502 });
  }
}
