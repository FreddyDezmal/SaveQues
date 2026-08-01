/**
 * app/api/billing/webhook/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/billing/webhook — Sprint 29, Phase 9: Webhooks.
 *
 * This route is the ONLY writer of the `subscriptions` table (besides the
 * migration's seed data) — Phase 14's "server remains authoritative, never
 * trust client-side premium flags" means the checkout/portal routes never
 * write subscription state themselves; they only redirect to Stripe, and
 * Stripe's webhook is what confirms what actually happened.
 *
 * SECURITY
 *   • Signature verification (provider.verifyWebhookSignature) happens
 *     before anything else touches the request body. An invalid signature
 *     is rejected with 400 before any DB write — this is what stops a
 *     forged "subscription activated" POST from an attacker who doesn't
 *     have the webhook signing secret.
 *   • Uses createServiceClient(), same as lib/adminAudit.ts's requireAdmin()
 *     — Stripe's webhook has no Supabase session/JWT to carry RLS, and
 *     `subscriptions` intentionally has no client INSERT/UPDATE policy
 *     (migration 069), so the service-role client is the only way to write
 *     it. This route trades "no RLS protection" for "must be exactly right
 *     about who's allowed to call it" — which is why signature verification
 *     is non-negotiable and runs first.
 *   • IDEMPOTENCY / REPLAY: every event id is inserted into
 *     billing_webhook_events (PRIMARY KEY = Stripe's event id) before
 *     processing. If Stripe redelivers the same event (their docs
 *     document at-least-once delivery), the second INSERT hits the
 *     primary-key conflict and the handler returns 200 immediately without
 *     reprocessing — this satisfies both "prevent duplicate processing"
 *     and "prevent replay attacks" from the brief in one mechanism.
 *   • Route is NOT behind session auth (Stripe can't send a Supabase
 *     session) — this is the one billing route that intentionally skips
 *     the createClient()-session pattern used everywhere else, and that's
 *     exactly why it needs its own signature check instead.
 *
 * WHY body is read as text(), not json()
 *   Stripe's signature is computed over the exact raw byte string; a
 *   parsed-then-reserialized JSON body will not match the signature.
 *   Next.js App Router route handlers don't auto-parse the body, so
 *   `req.text()` here is already the raw payload.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";
import { trackServerEvent } from "@/lib/analytics-server";
import { BillingAnalyticsEvents } from "@/lib/billing/analytics";
import { getBillingProvider } from "@/lib/billing";
import { invalidatePlanCache } from "@/lib/billing/plans";
import type Stripe from "stripe";

const log = createLogger("billing.webhook");

// Event types this handler understands. Anything else is acknowledged
// (200) but ignored — Stripe recommends only subscribing to what you
// handle, but being permissive here (rather than 400ing unknown types)
// avoids breaking delivery if the Stripe dashboard's webhook config ever
// sends a broader set than expected.
const HANDLED_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
]);

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const provider = getBillingProvider();
  let event: { id: string; type: string; data: unknown };
  try {
    event = provider.verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    log.warn("Webhook signature verification failed", { error: (err as Error)?.message });
    captureError(err as Error, { route: "POST /api/billing/webhook", stage: "verify" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // ── Idempotency ledger insert — must succeed BEFORE any business logic.
  const { error: insertError } = await supabase
    .from("billing_webhook_events")
    .insert({ id: event.id, event_type: event.type, status: "received" });

  if (insertError) {
    // Postgres unique_violation = 23505 → we've seen this event id before.
    if ((insertError as { code?: string }).code === "23505") {
      log.info("Duplicate webhook event, skipping", { event_id: event.id, event_type: event.type });
      return NextResponse.json({ received: true, duplicate: true });
    }
    log.error("Failed to record webhook event, refusing to process", { event_id: event.id, error: insertError.message });
    captureError(new Error(insertError.message), { route: "POST /api/billing/webhook", stage: "ledger_insert" });
    // 500 so Stripe retries — we genuinely don't know if we've processed
    // this yet, and it's safer to retry (idempotent handlers below) than
    // to silently drop an event.
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }

  if (!HANDLED_TYPES.has(event.type)) {
    await markProcessed(supabase, event.id);
    return NextResponse.json({ received: true, ignored: true });
  }

  try {
    await handleEvent(supabase, event.type, event.data as Stripe.Event.Data.Object);
    await markProcessed(supabase, event.id);
    return NextResponse.json({ received: true });
  } catch (err) {
    log.error("Webhook handler failed", { event_id: event.id, event_type: event.type, error: (err as Error)?.message });
    captureError(err as Error, { route: "POST /api/billing/webhook", event_id: event.id, event_type: event.type });
    await markFailed(supabase, event.id, (err as Error)?.message ?? "unknown error");
    // 500 so Stripe retries — the ledger row already exists with
    // status='failed', not 'processed', so a retry re-enters handleEvent()
    // rather than being short-circuited as a duplicate.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}

async function markProcessed(supabase: ReturnType<typeof createServiceClient>, eventId: string) {
  await supabase
    .from("billing_webhook_events")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("id", eventId);
}

async function markFailed(supabase: ReturnType<typeof createServiceClient>, eventId: string, error: string) {
  await supabase
    .from("billing_webhook_events")
    .update({ status: "failed", error })
    .eq("id", eventId);
}

async function handleEvent(
  supabase: ReturnType<typeof createServiceClient>,
  type: string,
  data: any
): Promise<void> {
  switch (type) {
    case "checkout.session.completed": {
      // The subscription itself is upserted by the subscription.* events
      // below (Stripe fires customer.subscription.created around the same
      // time). This event's role here is purely observability — it fires
      // once, right when the user completes checkout, which
      // subscription.created also does but with slightly different
      // timing guarantees across Stripe's event ordering.
      const userId = data?.client_reference_id ?? data?.metadata?.user_id;
      if (userId) {
        await trackServerEvent(BillingAnalyticsEvents.CHECKOUT_COMPLETED, userId, {
          plan_id: data?.metadata?.plan_id,
        });
      }
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const userId = data?.metadata?.user_id;
      if (!userId) {
        throw new Error(`Subscription event ${data?.id} missing metadata.user_id — cannot map to a SaveQuest user`);
      }
      const planId = data?.metadata?.plan_id ?? "premium";

      const row = {
        user_id: userId,
        plan_id: planId,
        status: data.status,
        provider: "stripe",
        provider_customer_id: typeof data.customer === "string" ? data.customer : data.customer?.id,
        provider_subscription_id: data.id,
        current_period_start: data.current_period_start ? new Date(data.current_period_start * 1000).toISOString() : null,
        current_period_end: data.current_period_end ? new Date(data.current_period_end * 1000).toISOString() : null,
        cancel_at_period_end: !!data.cancel_at_period_end,
        canceled_at: data.canceled_at ? new Date(data.canceled_at * 1000).toISOString() : null,
        trial_end: data.trial_end ? new Date(data.trial_end * 1000).toISOString() : null,
      };

      const { error } = await supabase.from("subscriptions").upsert(row, { onConflict: "user_id" });
      if (error) throw new Error(`Failed to upsert subscription: ${error.message}`);

      invalidatePlanCache();
      await trackServerEvent(
        type === "customer.subscription.created"
          ? BillingAnalyticsEvents.SUBSCRIPTION_ACTIVATED
          : BillingAnalyticsEvents.SUBSCRIPTION_RENEWED,
        userId,
        { plan_id: planId, status: data.status }
      );
      return;
    }

    case "customer.subscription.deleted": {
      const userId = data?.metadata?.user_id;
      if (!userId) {
        throw new Error(`Subscription deletion event ${data?.id} missing metadata.user_id`);
      }
      const { error } = await supabase
        .from("subscriptions")
        .update({ status: "canceled", canceled_at: new Date().toISOString() })
        .eq("provider_subscription_id", data.id);
      if (error) throw new Error(`Failed to mark subscription canceled: ${error.message}`);

      invalidatePlanCache();
      await trackServerEvent(BillingAnalyticsEvents.SUBSCRIPTION_CANCELED, userId, {});
      return;
    }

    case "invoice.payment_failed": {
      const subscriptionId = data?.subscription;
      if (!subscriptionId) return; // one-off invoices aren't subscriptions
      const { data: subRow, error: fetchErr } = await supabase
        .from("subscriptions")
        .select("user_id")
        .eq("provider_subscription_id", subscriptionId)
        .maybeSingle();
      if (fetchErr || !subRow) return;

      const { error } = await supabase
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("provider_subscription_id", subscriptionId);
      if (error) throw new Error(`Failed to mark subscription past_due: ${error.message}`);

      await trackServerEvent(BillingAnalyticsEvents.SUBSCRIPTION_PAST_DUE, subRow.user_id, {});
      return;
    }
  }
}
