/**
 * app/api/billing/checkout/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/billing/checkout — Sprint 29, Phase 7: Upgrade.
 *
 * Starts a Stripe Checkout session for the requesting user and returns the
 * redirect URL. Uses the SAME `createClient()` session-auth pattern as
 * every other authenticated route (app/api/goals/route.ts) — no new auth
 * logic, per the brief's "never duplicate auth logic."
 *
 * Rate-limited with checkAttemptRateLimit (lib/rateLimit.ts) the same way
 * other idempotent-ish endpoints are: creating a Checkout Session has no
 * side effect on our own DB (nothing is written until the webhook fires),
 * so counting our own rows wouldn't catch a client spamming this route —
 * exactly the case checkAttemptRateLimit exists for.
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";
import { trackServerEvent } from "@/lib/analytics-server";
import { BillingAnalyticsEvents } from "@/lib/billing/analytics";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { getBillingProvider } from "@/lib/billing";
import { getSubscription } from "@/lib/billing/entitlements";
import { getPlan } from "@/lib/billing/plans";

const log = createLogger("billing.checkout");

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  setSentryUser(user.id);

  let body: { planId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const planId = body.planId ?? "premium";

  const plan = await getPlan(planId);
  if (!plan || !plan.isPurchasable) {
    return NextResponse.json({ error: `"${planId}" is not a purchasable plan` }, { status: 422 });
  }

  const rateLimit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: "billing.checkout",
    windowMinutes: 10,
    maxRequests: 10,
    actionLabel: "checkout attempts",
  });
  if (!rateLimit.allowed) {
    log.warn("Checkout rate-limited", { user_id: user.id, request_id: requestId });
    return NextResponse.json({ error: rateLimit.message }, { status: 429 });
  }
  await recordAttempt(supabase, user.id, "billing.checkout");

  try {
    const existingSub = await getSubscription(user.id);
    const origin = req.nextUrl.origin;

    const provider = getBillingProvider();
    const { url } = await provider.createCheckoutSession({
      userId: user.id,
      userEmail: user.email ?? "",
      planId,
      existingCustomerId: existingSub?.providerCustomerId ?? null,
      successUrl: `${origin}/settings/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/settings/billing/cancel`,
    });

    await trackServerEvent(BillingAnalyticsEvents.CHECKOUT_STARTED, user.id, {
      plan_id: planId,
      request_id: requestId,
    });

    return NextResponse.json({ url });
  } catch (err) {
    log.error("Checkout session creation failed", { user_id: user.id, request_id: requestId, error: (err as Error)?.message });
    captureError(err as Error, { route: "POST /api/billing/checkout", userId: user.id });
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 });
  }
}
