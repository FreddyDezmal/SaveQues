/**
 * lib/billing/providers/stripe.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 6/9: the first (and
 * currently only) BillingProvider implementation. Every other module in
 * this app should reach billing functionality through
 * lib/billing/provider.ts's interface, never by importing `stripe`
 * directly — this file is the one place that package is imported.
 *
 * The `stripe` package is added to package.json as a new dependency
 * (was not present before this sprint — confirmed in docs/BILLING_AUDIT.md).
 *
 * Lazily constructs the Stripe client on first use rather than at module
 * load, so importing this file in an environment without
 * STRIPE_SECRET_KEY set (e.g. running unrelated unit tests) doesn't
 * throw — same "don't make unrelated code paths depend on unrelated env
 * vars" spirit as lib/env.ts marking billing vars devOptional.
 */

import Stripe from "stripe";
import { getEnv } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import type {
  BillingProvider,
  CreateCheckoutSessionInput,
  CreatePortalSessionInput,
  ProviderWebhookEvent,
} from "../provider";

const log = createLogger("billing.stripe");

let client: Stripe | null = null;

function getClient(): Stripe {
  if (client) return client;
  const secretKey = getEnv("STRIPE_SECRET_KEY");
  client = new Stripe(secretKey, {
    apiVersion: "2024-11-20.acacia",
    typescript: true,
  });
  return client;
}

/** Maps our internal plan id (e.g. 'premium') to the Stripe Price ID to
 *  check out. Kept as a small explicit map (not a DB column) because it's
 *  Stripe-specific configuration, not part of the provider-agnostic Plan
 *  model in migration 069 — a Paddle adapter would need a different key
 *  entirely, which is exactly why this lookup lives inside the Stripe
 *  adapter and not in lib/billing/plans.ts. */
function priceIdForPlan(planId: string): string {
  if (planId === "premium") {
    return getEnv("STRIPE_PRICE_ID_PREMIUM_MONTHLY");
  }
  throw new Error(`No Stripe Price ID configured for plan "${planId}"`);
}

export const stripeProvider: BillingProvider = {
  name: "stripe",

  async createCheckoutSession({
    userId,
    userEmail,
    planId,
    existingCustomerId,
    successUrl,
    cancelUrl,
  }: CreateCheckoutSessionInput) {
    const stripe = getClient();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceIdForPlan(planId), quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Reuse an existing customer if we have one so a user who abandons
      // checkout and retries doesn't accumulate duplicate Stripe customer
      // records for the same account.
      customer: existingCustomerId ?? undefined,
      customer_email: existingCustomerId ? undefined : userEmail,
      client_reference_id: userId,
      // Carried through to the subscription object and every webhook
      // event about it — this is how the webhook handler maps a Stripe
      // event back to a SaveQuest user_id without a separate lookup
      // table, mirroring how other provider adapters in this codebase
      // (lib/push/providers/*) pass through an app-owned identifier.
      subscription_data: { metadata: { user_id: userId, plan_id: planId } },
      metadata: { user_id: userId, plan_id: planId },
      allow_promotion_codes: true,
    });

    if (!session.url) {
      throw new Error("Stripe checkout session created without a redirect URL");
    }
    return { url: session.url };
  },

  async createPortalSession({ customerId, returnUrl }: CreatePortalSessionInput) {
    const stripe = getClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  },

  verifyWebhookSignature(rawBody: string, signatureHeader: string): ProviderWebhookEvent {
    const stripe = getClient();
    const webhookSecret = getEnv("STRIPE_WEBHOOK_SECRET");
    // Throws Stripe.errors.StripeSignatureVerificationError on a bad
    // signature — deliberately NOT caught here. Phase 14 requires the
    // caller (the webhook route) to reject the request outright, not
    // silently continue.
    const event = stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
    return { id: event.id, type: event.type, data: event.data.object };
  },

  async cancelSubscription(providerSubscriptionId: string, opts?: { immediate?: boolean }) {
    const stripe = getClient();
    if (opts?.immediate) {
      await stripe.subscriptions.cancel(providerSubscriptionId);
    } else {
      await stripe.subscriptions.update(providerSubscriptionId, { cancel_at_period_end: true });
    }
    log.info("Subscription cancellation requested", { providerSubscriptionId, immediate: !!opts?.immediate });
  },
};
