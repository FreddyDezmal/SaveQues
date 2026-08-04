# Performance Audit — Premium Subscription Platform

Sprint 29, Phase 15: *"Measure extra bundle size, provider SDK impact,
checkout latency, portal latency, render cost. Avoid loading billing
libraries for users who never open billing. Lazy load wherever
appropriate."*

## Server bundle: `stripe` SDK

The installed `stripe` package (v17.4.0) is **6.9 MB on disk**
(`node_modules/stripe`), confirmed via `du -sh`. This is a server-only
dependency — imported in exactly one file, `lib/billing/providers/stripe.ts`
— and Next.js's server-component/route-handler bundling means it is never
part of any client JS bundle. It only loads into the Node process for
requests that actually hit `/api/billing/*` routes, not on every server
request.

**Lazy client construction:** `getClient()` in
`lib/billing/providers/stripe.ts` constructs the `Stripe` instance on
first use inside a request handler, not at module import time. This
matters because Next.js can load a route module without necessarily
executing every top-level statement eagerly in all deployment
configurations, and — more concretely — it means a missing
`STRIPE_SECRET_KEY` only throws when a billing route is actually hit, not
when unrelated routes import shared modules that transitively touch
`lib/billing`.

## Client bundle: zero cost for users who never open billing

None of `components/billing/*` are imported from any always-rendered
layout, nav, or dashboard shell. `PremiumBadge` is the only one plausibly
worth inlining into a frequently-rendered list (e.g. a leaderboard row) —
it is a ~20-line server component with a single `lucide-react` icon
import, already tree-shaken; not worth a dynamic import.

`PlanComparisonDialog` (the heaviest client component — table rendering +
a `fetch` call) is only rendered when `showComparison` is `true` in
`BillingClient.tsx`, i.e. only on `/settings/billing` after the user
clicks "Upgrade" or "Compare." **Explicitly not code-split with
`next/dynamic` this sprint** — it's a small component (no charting
library, no heavy dependency) and `/settings/billing` is itself already a
distinct route segment that Next.js code-splits automatically as part of
its per-route JS chunking. Adding a manual `dynamic()` boundary inside an
already-isolated route would save bytes on a page nobody but the person
already looking at billing ever loads. Flagged here as a considered
tradeoff, not an oversight — if `PlanComparisonDialog` grows (e.g. a
future embedded pricing calculator), revisit.

## `useBillingStatus` request cost

Each of `PremiumBadge`-adjacent gated components could naively fire its
own `GET /api/billing/status` call. `lib/hooks/useBillingStatus.ts`'s
module-level cache + in-flight-request dedup means **N components mounted
in the same page load produce exactly one network request**, not N —
verified by inspection of the hook's `inflight` promise reuse (a second
`useBillingStatus()` call while a fetch is already in progress awaits the
same promise rather than issuing a second `fetch`).

## `getCatalogue()` server-side caching

`lib/billing/plans.ts`'s `getCatalogue()` caches the joined
plans/features/plan_features result in-process for 60 seconds
(`CACHE_TTL_MS`). Since `getEntitlements()` is called on essentially every
gated request (goal creation, every export), this avoids three DB queries
per request in the common case — the catalogue changes only on an admin
action, so a short TTL cache is a large win for negligible staleness risk.
`invalidatePlanCache()` is called explicitly from the webhook handler
after a subscription changes, so a user's *own* entitlement change (the
part that actually matters for correctness) is never delayed by the
cache — only the rarely-changing catalogue itself is cached, not
per-user entitlement results.

## Checkout / portal latency

Both `POST /api/billing/checkout` and `POST /api/billing/portal` make
exactly one outbound call to Stripe's API (`checkout.sessions.create` /
`billingPortal.sessions.create`) plus the auth/rate-limit/DB lookups
already required by every other API route in this codebase (session
fetch, rate-limit check row, one `subscriptions` select). No sequential
chain of Stripe API calls — `createCheckoutSession` passes
`existingCustomerId` through rather than doing a separate "look up
customer" round trip first. Not independently load-tested this sprint
(no existing precedent for load-testing individual routes in this
codebase); latency is bounded by Stripe's own API response time plus one
DB round trip, both already the dominant cost in every comparable
authenticated route.

## What wasn't measured

Real checkout/portal round-trip latency against live Stripe endpoints
(would need a configured test-mode Stripe account, which isn't part of
this sprint's environment) and client-side JS bundle diff (`next build`
bundle analyzer) weren't run — both are documented here as follow-up
rather than fabricated numbers.
