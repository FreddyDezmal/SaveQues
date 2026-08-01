# Security Audit — Premium Subscription Platform

Sprint 29, Phase 14: *"Audit billing endpoints, webhooks, entitlements,
plan changes, feature checks, subscription spoofing. Never trust
client-side premium flags. Server remains authoritative."*

## Threat: a client claims to be premium when it isn't

**Mitigation: there is no client-writable "isPremium" field anywhere.**
`Entitlements` is computed server-side on every call from
`getEntitlements(userId)`, which reads the `subscriptions` table via the
service-role client and re-derives status from it. The only client-visible
representation is the *response* of `GET /api/billing/status` — reading
that response and setting a local variable to `true` changes nothing,
because every actual feature check (`hasFeature`, `getFeatureLimit`,
`checkUsage`) re-queries the server on the request that matters (e.g. `POST
/api/goals`, the export routes). A modified client can lie to itself in
its own UI; it cannot make the server believe it.

## Threat: a forged webhook request grants premium access

**Mitigation: signature verification before any DB write, on every
request, no exceptions.** `provider.verifyWebhookSignature()` (Stripe's
`stripe.webhooks.constructEvent`) is the first thing `POST
/api/billing/webhook` does with the request body. A missing or invalid
signature returns 400 immediately — the ledger insert, the subscription
upsert, and the analytics event all happen strictly after verification
succeeds. `STRIPE_WEBHOOK_SECRET` is a required env var
(`lib/env.ts`) for this route to function; there is no fallback path that
skips verification.

**Residual risk / operational dependency:** this defense is only as good
as the secrecy of `STRIPE_WEBHOOK_SECRET`. It's read via `getEnv()` (never
logged — confirmed `lib/logger.ts`'s redaction conventions apply to every
`log.*` call in the new routes, none of which log raw env values) and must
be configured in the Stripe Dashboard to match. This is standard Stripe
integration hygiene, not a gap specific to this implementation.

## Threat: a webhook event is replayed or delivered twice

**Mitigation: `billing_webhook_events` primary-keyed on the provider's own
event id.** Stripe's own documentation states webhook delivery is
at-least-once and not strictly ordered. The insert into this table happens
before any business logic; a duplicate `id` hits a Postgres unique-key
violation (`23505`), which the route detects and returns `200 {
duplicate: true }` without reprocessing. This is the same mechanism for
both "prevent replay attacks" and "prevent duplicate processing" — a
replayed event (legitimate redelivery or a captured-and-resent request) is
indistinguishable at this layer, and both are safely no-ops.

## Threat: a race between two webhook events processing concurrently causes a lost update

Two events for the same subscription (e.g. `updated` firing twice in quick
succession) both write to the same `subscriptions` row via `upsert(...,
{onConflict: "user_id"})`. This is a last-write-wins upsert — Postgres
serializes the two writes, and the second one's data wins outright, not a
merge. Since Stripe's payload for `customer.subscription.updated` is the
full current state of the subscription object (not a delta), last-write-
wins is actually correct here as long as writes apply in the order Stripe
sent them, which is the tradeoff being made by not implementing a stricter
ordering guard (e.g. comparing `current_period_start` before overwriting).
**Documented as an accepted risk, not fixed this sprint:** Stripe does not
guarantee delivery order, so an out-of-order pair of events could very
rarely leave a `subscriptions` row reflecting the earlier state. The
practical exposure is small (the next webhook or the customer portal
resolves it), and closing this fully would need an `event.created`
timestamp comparison guard in the upsert, which is real follow-up work
called out here rather than silently skipped.

## Threat: a user gets someone else's subscription (customer/subscription id confusion)

**Mitigation: `user_id` is round-tripped through Stripe metadata, not
inferred from session context in the webhook.** `createCheckoutSession`
sets `client_reference_id` and `subscription_data.metadata.user_id` to the
SaveQuest `user.id` at checkout-creation time (when we do have an
authenticated session). Every webhook handler reads `data.metadata.user_id`
back out and writes to that row — never "whoever's currently logged in"
(there is no logged-in user in a webhook request) and never a lookup by
email (which could collide or be reused). A handler that receives an event
with no `metadata.user_id` throws rather than guessing, which surfaces as
a `failed` ledger row and a Sentry-captured error rather than a silent
misattribution.

## Threat: RLS bypass on `subscriptions` / `usage_counters`

Both tables allow `SELECT` only for `auth.uid() = user_id`
(migration 069) and have **no client INSERT/UPDATE/DELETE policy at all**.
The only way to write either table is via the service-role client, used
exclusively inside `lib/billing/` modules and the webhook route — never
exposed through a route that also accepts arbitrary client input for those
fields. `increment_usage_counter()` is `SECURITY DEFINER` specifically
because `usage_counters` has no client write policy; it's `REVOKE`d from
`PUBLIC`/`anon`/`authenticated` so it can only be invoked via
`supabase.rpc()` from server code holding the service-role key, not
directly by an authenticated client session.

## Threat: a canceled/past-due subscription keeps granting premium access

**Mitigation: `resolveEffectivePlan()` checks `status`, not "does a
subscription row exist."** `ENTITLED_STATUSES = ["active", "trialing"]`
is an explicit allow-list; every other status (`past_due`, `canceled`,
`incomplete`, `incomplete_expired`, `unpaid`) falls back to the default
plan's entitlements even though `subscriptions.plan_id` still says
`"premium"` — the row remembers what they subscribed to, not what they're
currently entitled to. Covered directly in
`tests/unit/billing/entitlements.test.ts`.

## Threat: usage-limit check failures silently grant unlimited access

**Mitigation: `checkUsage()` fails closed.** A DB error or unexpected
catalogue state during a limit check returns `{ allowed: false, limit: 0
}` rather than throwing an unhandled error up to the route (which could,
depending on how a caller wrote its error handling, accidentally allow the
request through). This is the opposite failure direction from
`getEntitlements()`, which fails toward the *default plan* on error (never
toward premium) — both directions point the same way: **never grant more
than the system can currently prove the user is entitled to.**

## Known limitation carried over from the goals-limit gate

`POST /api/goals`'s live-count check for `goals_limit` deliberately **fails
open** on a count-query error (documented inline in the route) rather than
failing closed like `checkUsage()` does. This is an intentional exception:
blocking every goal creation for every free-tier user on a transient count
query failure was judged a worse outcome than an occasional single
goal created past the limit. This is the one place in the new billing
surface where "fail closed" was NOT chosen, and it's called out explicitly
so it isn't mistaken for an oversight.
