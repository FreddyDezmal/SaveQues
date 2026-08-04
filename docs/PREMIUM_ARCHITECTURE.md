# Premium Subscription Platform — Architecture

Sprint 29. Read alongside `docs/BILLING_AUDIT.md` (what existed before this
sprint — nothing did) and `supabase/migrations/069_premium_subscriptions.sql`
(the schema this document describes).

## The rule this whole design serves

> Every premium feature should ask one central service whether it is
> available. Never scattered `if(user.isPremium)` checks.

Concretely: **`lib/billing/entitlements.ts`'s `getEntitlements()` /
`hasFeature()` / `getFeatureLimit()` are the only functions any route or
component calls.** Nothing outside `lib/billing/` reads the `subscriptions`,
`plans`, or `plan_features` tables directly.

## Domain model

```
Plan ──< PlanFeature >── Feature
 │                          │
 │                          └─ kind: boolean | limit
 │
Subscription (one per user, current state, synced by webhooks)
 │
 └─ resolves to a Plan → Entitlements (computed, never stored)

UsageCounter (period-scoped, only for kind='limit' features that are
              genuinely rate-like — see the note on goals_limit below)
```

| Concept | Table | TypeScript | Module |
|---|---|---|---|
| Plan | `plans` | `Plan` | `lib/billing/plans.ts` |
| Feature | `features` | `Feature` | `lib/billing/plans.ts` |
| Entitlement (plan→feature grant) | `plan_features` | `PlanFeature` | `lib/billing/plans.ts` |
| Subscription | `subscriptions` | `Subscription` | `lib/billing/entitlements.ts` |
| Usage | `usage_counters` | `UsageCheckResult` | `lib/billing/usage.ts` |
| Permission (computed) | — | `Entitlements` | `lib/billing/entitlements.ts` |

`Entitlements` (the thing everything else consumes) is **computed, not
stored** — `getEntitlements(userId)` joins the user's current subscription
status against the plan catalogue on every call (cached catalogue, live
subscription lookup). This is deliberate: it means there is no
"entitlements" table that can drift out of sync with `subscriptions` — one
join, one source of truth per input.

## Why plans/features are DB rows, not a TypeScript constants file

The brief says explicitly: *"Do not hardcode plan names throughout the
application"* and *"Do not hardcode numeric limits throughout the
project."* A `const PLANS = {...}` file is still hardcoding, just
centralized. Instead:

- Adding a third tier (`plan_premium_plus`) = one `INSERT INTO plans` +
  a few `INSERT INTO plan_features` rows. **Zero code changes.**
- Changing the free goal limit from 5 to 3 = one `UPDATE plan_features SET
  limit_value = 3`. **Zero deploys.**

This is the same pattern already used elsewhere in this codebase for
admin-configurable content (quest_content, badge definitions) — extended
here, not invented.

## Request flow: "can this user do X"

```
Route/component
   │
   ▼
hasFeature(userId, "ai_coaching")          [boolean feature]
getFeatureLimit(userId, "goals_limit")     [limit feature — returns the ceiling]
checkUsage(userId, "exports_limit")        [limit feature — returns {allowed, used, remaining}]
   │
   ▼
getEntitlements(userId)
   │
   ├─ getSubscription(userId)  →  subscriptions table (RLS: select-own)
   │                               no row = implicitly on the default plan
   │
   └─ getCatalogue()  →  plans + features + plan_features (60s in-process cache)
   │
   ▼
resolveEffectivePlan()  →  is the subscription's status currently
                            entitled (active/trialing)? If not
                            (past_due/canceled/etc), fall back to the
                            default (free) plan's entitlements even
                            though the subscription row still exists.
   │
   ▼
buildFeatureMap()  →  { [featureKey]: { enabled, limit } }
```

`resolveEffectivePlan` and `buildFeatureMap`/`isEntitledStatus` are
deliberately split out as pure functions (see
`tests/unit/billing/entitlements.test.ts`) from the Supabase-fetching
wrapper around them — the same "pure core, thin I/O shell" split
`lib/featureFlags.ts` already established in this codebase.

## Usage limits: two different shapes, one module

`lib/billing/usage.ts` handles genuinely **period-scoped, monotonically
increasing** usage: exports this month, scenario runs today. It maintains
`usage_counters` rows keyed by `(user, feature, period_start)`, incremented
atomically via the `increment_usage_counter()` Postgres function (avoids a
read-then-write race under concurrent requests).

`goals_limit` is different — it's a **live count of currently-active
rows**, which can go *down* (delete a goal, free up a slot). Tracking that
as a monotonic counter would require decrementing on delete, a second
bookkeeping path that could drift from reality. Instead, `POST /api/goals`
counts `savings_goals` rows directly and compares against
`getFeatureLimit(userId, "goals_limit")`. This distinction is documented
inline in both `lib/billing/usage.ts`'s header and the goals route itself
— it's an intentional design choice, not an inconsistency.

## Billing provider abstraction (Phase 6)

```
lib/billing/provider.ts        — BillingProvider interface
lib/billing/providers/stripe.ts — first (only) implementation
lib/billing/index.ts            — getBillingProvider() returns the active one
```

This mirrors `lib/push/types.ts`'s existing provider-adapter pattern
exactly (see `docs/BILLING_AUDIT.md`) rather than inventing a new shape.
Every route (`checkout`, `portal`, `webhook`) depends only on
`BillingProvider`, never on `import Stripe from "stripe"` directly — that
import exists in exactly one file. Adding Paddle or Lemon Squeezy later is
a new file under `lib/billing/providers/` implementing the same interface,
plus changing what `getBillingProvider()` returns.

## Webhooks: idempotency and security (Phase 9 / 14)

`POST /api/billing/webhook` is the **only** writer of the `subscriptions`
table. Checkout and portal routes only ever redirect to Stripe — they
never write subscription state themselves, because the client completing a
redirect flow doesn't mean the payment succeeded; the webhook confirms
that.

1. **Signature verification first, before the body is touched for
   anything else.** An invalid signature → 400, no DB write of any kind.
2. **Idempotency ledger.** Every event's Stripe-assigned `id` is inserted
   into `billing_webhook_events` (primary key = that id) before any
   business logic runs. A redelivered event hits the primary-key conflict
   and returns `200 { duplicate: true }` without reprocessing.
3. **Fail-closed on transient errors.** If the ledger insert itself fails
   (not a duplicate — a real DB error), the route returns 500 so Stripe
   retries, rather than silently dropping an event it can't confirm it
   recorded.
4. **Service-role client**, same reasoning as `lib/adminAudit.ts` — Stripe
   has no Supabase session to carry RLS, and `subscriptions` intentionally
   has no client-writable policy.

## Client-side entitlement UI (Phase 10/11)

`lib/hooks/useBillingStatus.ts` wraps `GET /api/billing/status` with a
module-level cache so mounting several gated components on one page (e.g.
a dashboard with three locked cards) costs one network request. Every
premium UI primitive (`PremiumBadge`, `LockedCard`, `UpgradePrompt`,
`PlanComparisonDialog`) reads through this hook — never a second,
independent fetch.

`PlanComparisonDialog` reads its feature list from the same
`/api/billing/status` catalogue every other component uses (not a
hardcoded JSX list) so a feature added to migration 069's seed data
appears in the comparison table automatically. The Free-tier limit
*display strings* (`formatFreeLimit()`) are the one place with a small
hardcoded map — deliberately just for rendering, never for enforcement
(enforcement always goes through `lib/billing/entitlements.ts`).

## What's deliberately NOT built this sprint

Documented honestly rather than silently left out:

- **Scenario-run gating (`scenarios_limit`) has no enforcement point.**
  `lib/scenarioSimulator.ts` (confirmed via `tests/unit/scenarioSimulator...`
  during the audit) runs client-side with no dedicated API route today —
  there's nowhere server-side to call `enforceUsageLimit()` from. The
  feature/plan/limit rows exist (`scenarios_limit` is seeded for both
  plans) and `lib/billing/gate.ts` is ready to be dropped into a future
  `POST /api/scenarios/run` route if scenario running moves server-side.
  Until then this is an unenforced entitlement, not a broken one.
- **Own invoice-history/payment-method UI.** Phase 8 explicitly asks for
  "one portal entry point" — Stripe's hosted Customer Portal *is* that
  entry point. Building a parallel invoice list would duplicate what
  Stripe already renders correctly and would need to stay in sync with
  Stripe's own data.
- **Multi-tier UI polish beyond Free/Premium.** The schema supports N
  tiers with no code changes (see above), but the comparison dialog and
  billing settings page were built and tested against exactly two rows.
  Adding a third tier's presentation (e.g. a 3-column comparison instead
  of 2) would need a small UI change even though the data layer needs
  none.
- **A server-generated binary PDF export.** `lib/exportCenter.ts` already
  documented (before this sprint) that this was deferred pending a real
  need; this sprint's `exports_limit` gates the CSV/JSON exports that do
  exist, not a PDF export that doesn't.
