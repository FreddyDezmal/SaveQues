# Premium Subscription Platform — Architecture

Sprint 29 (plumbing) + Sprint 30 (activation — see that section below).
Read alongside `docs/BILLING_AUDIT.md` (what existed before Sprint 29 —
nothing did) and `supabase/migrations/069_premium_subscriptions.sql` +
`070_scenario_simulator_premium.sql` (the schema this document
describes).

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

## Client-side entitlement UI (Phase 10/11; extended Sprint 30)

`lib/hooks/useBillingStatus.ts` wraps `GET /api/billing/status` with a
module-level cache so mounting several gated components on one page (e.g.
a dashboard with three locked cards) costs one network request. Every
premium UI primitive (`PremiumBadge`, `LockedCard`, `UpgradePrompt`,
`PlanComparisonDialog`) reads through this hook — never a second,
independent fetch. `lib/hooks/useFeatureEntitlement.ts` (Sprint 30) is a
thin wrapper one level up, for the common "is this one boolean feature
key enabled for this user" check — see the Sprint 30 section below for
why it exists.

`PlanComparisonDialog` reads its feature list from the same
`/api/billing/status` catalogue every other component uses (not a
hardcoded JSX list) so a feature added to migration 069's seed data
appears in the comparison table automatically. The Free-tier limit
*display strings* (`formatFreeLimit()`) are the one place with a small
hardcoded map — deliberately just for rendering, never for enforcement
(enforcement always goes through `lib/billing/entitlements.ts`).

## What's deliberately NOT built this sprint

Documented honestly rather than silently left out:

- ~~**Scenario-run gating (`scenarios_limit`) has no enforcement point.**~~
  **Fixed in Sprint 30, Phase 3.** `POST /api/goal/scenario-run` now
  exists specifically to call `enforceUsageLimit()`/`recordUsage()` for
  `scenarios_limit` — see `docs/PREMIUM_ARCHITECTURE.md`'s "Sprint 30"
  section below. `lib/scenarioSimulator.ts` itself is still client-side
  and pure; the route's only job is the quota check this section
  originally flagged as missing.
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
  exist, not a PDF export that doesn't. Still true as of Sprint 30 — the
  new Monthly Report (see below) is print-to-PDF via the browser, same
  as the pre-existing Annual Report, not a server-generated binary.

## Sprint 30: feature activation

Sprint 29 built this platform's plumbing; almost none of it was actually
connected to the app until Sprint 30. The Phase 1 audit that opened
Sprint 30 found `LockedCard`/`UpgradePrompt`/`PremiumBadge` had **zero**
consumers outside their own files, and `ai_coaching`/`scenarios_limit`/
`exports_limit` were seeded onto both plans but never read by any route.
Sprint 30's job was activation, not new plumbing — the sections below are
almost entirely composition of what this document already describes.

**New gated surfaces** (all following the exact request flow above —
no new entitlement-checking code path was invented):

| Surface | Feature key | Enforcement |
|---|---|---|
| Premium Forecast card (dashboard, `/intelligence`) — 30/60/90-day breakdown | `advanced_forecasting` | Client display gate only (see below) |
| Premium Coaching card (goal detail, `/intelligence`) — full coaching list beyond what's free | `ai_coaching` | Client display gate only (see below) |
| Scenario simulations, 3/day free | `scenarios_limit` | Server: `POST /api/goal/scenario-run` |
| Saved scenarios per goal, 1 free / unlimited premium | `saved_scenarios_limit` (new — migration `070`) | Server: `POST /api/goal/scenario-saved`, live-count pattern (see `goals_limit` note above) |
| CSV/report exports, 5/month free (pre-existing `exports_limit`, now actually reachable from the UI — see below) | `exports_limit` | Server: every `app/api/export/*` route |

**`saved_scenarios_limit`** is a `limit`-kind feature following the
`goals_limit` live-count pattern this document already describes above,
not the `usage_counters` monotonic pattern `scenarios_limit` uses — a
saved scenario can be deleted (freeing a slot), so `POST
/api/goal/scenario-saved` counts `saved_scenarios` rows directly via
`getFeatureLimit()`, same reasoning as `POST /api/goals` already applies
to `goals_limit`.

**Client-side entitlement UI, consolidated further.** Two components
(`PremiumForecastCard`, `PremiumCoachingCard`) had independently written
the identical `useBillingStatus()` + feature-key-lookup expression.
Extracted into `lib/hooks/useFeatureEntitlement(featureKey)` — now the
one place that expression lives, built on top of `useBillingStatus`
exactly as `PremiumBadge`/`LockedCard`/`UpgradePrompt` already were.

**A documented, known property, not a bug**: `PremiumForecastCard` and
`PremiumCoachingCard` are the first real consumers of `LockedCard`'s
blur-preview pattern (see `components/billing/LockedCard.tsx`'s own
header — "a card-shaped preview, not literally hidden," a deliberate
Sprint 29 design decision). That means the underlying data for a locked
card is present in the page payload, just visually hidden — inspectable
via devtools. This is a genuine property of the current architecture,
found and written up during Sprint 30's Phase 12 security audit, and
deliberately not "fixed" by filtering data server-side: doing so would
mean either duplicating the entitlement check server-side *and*
client-side (this document's central rule, violated) or dropping the
"blurred real preview" UX `LockedCard` was explicitly designed around.
If a stricter policy is ever wanted, the fix is a product decision
(replace the real-content preview with a generic locked state), not an
engineering oversight to patch quietly. Every ACTION that costs the
business money or lets a user exceed a real limit — every row in the
table above except the two display-only cards — has no equivalent gap:
the server decides, unconditionally, on every request.

**Exports finally reachable from the UI.** `exports_limit` enforcement
in `app/api/export/*` predates Sprint 30 and was already correct — but
every CSV download in the app (`AnnualReportClient.tsx`) was a plain
`<a href>` link. A free user who exhausted the quota and clicked one got
navigated out of the app to the route's raw JSON error body. Sprint 30
Phase 9 replaced these with `lib/hooks/useGatedDownload.ts`, a small
fetch-and-blob-download hook that keeps the user in the app and shows
`UpgradePrompt` inline on a 403 — same component, same message contract,
just actually reachable now. The same hook now also backs the new
Monthly Report's CSV export (see `docs/ARCHITECTURE.md`'s Sprint 30
section).
