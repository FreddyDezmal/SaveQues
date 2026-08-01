/**
 * lib/billing/provider.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 6: billing provider
 * abstraction. "Same philosophy" as lib/push/types.ts (Sprint 27) and
 * lib/email/providers/ before it: one interface, one adapter behind it
 * today (Stripe), business logic (checkout/portal routes, webhook
 * handler) depends only on this interface — never on `import Stripe from
 * "stripe"` directly outside lib/billing/providers/stripe.ts.
 *
 * Adding Paddle or Lemon Squeezy later means writing
 * lib/billing/providers/paddle.ts implementing this same interface and
 * changing which adapter getBillingProvider() returns — no changes to
 * any route or component.
 */

export interface CreateCheckoutSessionInput {
  userId: string;
  userEmail: string;
  planId: string;
  /** Existing provider customer id, if this user has one already —
   *  avoids creating a duplicate customer record on a second checkout
   *  attempt after an abandoned/expired session. */
  existingCustomerId?: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CreatePortalSessionInput {
  customerId: string;
  returnUrl: string;
}

export interface ProviderWebhookEvent {
  /** The provider's own event id — used as the idempotency key against
   *  billing_webhook_events. */
  id: string;
  type: string;
  /** Parsed, provider-specific payload. Handlers narrow on `type`. */
  data: unknown;
}

export interface BillingProvider {
  /** Short identifier for logging — "stripe", "paddle", etc. */
  readonly name: string;

  /** Starts a hosted checkout flow for a plan. Returns the URL to redirect
   *  the user to. */
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ url: string }>;

  /** Starts a hosted customer-portal session (manage payment method,
   *  view invoices, cancel). Returns the URL to redirect the user to. */
  createPortalSession(input: CreatePortalSessionInput): Promise<{ url: string }>;

  /** Verifies a webhook request's signature and returns the parsed event.
   *  Throws if the signature is invalid — callers must not process an
   *  event that fails this check (Phase 14: "verify signatures"). */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): ProviderWebhookEvent;

  /** Cancels a subscription (at period end, by default — immediate
   *  cancellation is a provider-specific option callers can pass
   *  through `immediate`). */
  cancelSubscription(providerSubscriptionId: string, opts?: { immediate?: boolean }): Promise<void>;
}
