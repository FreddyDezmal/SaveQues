# SPRINT29_SUMMARY.md — Premium Subscription Platform

## Audit outcome (Phase 1)

Every item on the brief's Phase 1 checklist (premium flags, feature
gates, billing abstraction, subscription tables, payment adapters,
Stripe/Paddle/Lemon Squeezy integration, entitlement middleware, premium
badges, usage limits, quota tracking, billing UI, invoice history,
webhook handlers) was confirmed genuinely absent via repo-wide grep
before any code was written. Full findings, including which existing
non-billing patterns this sprint deliberately reused, are in
`docs/BILLING_AUDIT.md`. **Nothing in this sprint replaces existing
work** — it's entirely net-new infrastructure built on top of
conventions (provider adapters, service-role writes, structured
logging/analytics, RLS shape) this codebase already established.

## What was built

### Database (Phase 3–5, 9)
- `supabase/migrations/069_premium_subscriptions.sql` (+
  `rollback/069_down.sql`): `plans`, `features`, `plan_features`,
  `subscriptions`, `usage_counters`, `billing_webhook_events` — 6 tables,
  seeded with Free/Premium plans and the 9 features named in the brief.
  An atomic `increment_usage_counter()` `SECURITY DEFINER` RPC backs
  concurrent-safe usage counting.

### Core architecture (Phase 2, 4, 5, 6) — `lib/billing/`
- `types.ts` — shared domain types, zero I/O.
- `plans.ts` — cached (60s) catalogue loader; the only module that reads
  `plans`/`features`/`plan_features` directly.
- `entitlements.ts` — **the single entry point** every feature check
  goes through (`getEntitlements`, `hasFeature`, `getFeatureLimit`).
  Pure logic (`isEntitledStatus`, `buildFeatureMap`) is split out from
  the Supabase-fetching wrapper for direct unit testing, mirroring
  `lib/featureFlags.ts`'s existing pure-core/thin-I/O-shell split.
- `usage.ts` — period-scoped usage tracking (`checkUsage`/`recordUsage`);
  `periodStartFor()` is pure and unit-tested directly.
- `gate.ts` — one reusable `enforceUsageLimit()` helper so limit-gated
  routes don't hand-roll the same check/403/record pattern.
- `provider.ts` + `providers/stripe.ts` — provider-agnostic interface,
  mirroring the existing `lib/push/types.ts` adapter pattern, with
  Stripe as the first (only) implementation. `stripe` is a real
  dependency now (`package.json`), imported in exactly one file.
- `analytics.ts` — billing-specific event names, flowing through the
  existing `trackServerEvent()`/PostHog pipeline.
- `index.ts` — barrel export + `getBillingProvider()`.

### API routes (Phase 7, 8, 9)
- `POST /api/billing/checkout` — starts Stripe Checkout, reuses an
  existing customer id if present, rate-limited.
- `POST /api/billing/portal` — starts Stripe's hosted Customer Portal
  session (Phase 8's "one portal entry point").
- `POST /api/billing/webhook` — signature verification →
  idempotency-ledger insert → event handling, in that order, every time.
  The only writer of `subscriptions`.
- `GET /api/billing/status` — the one endpoint client components read
  entitlements/usage/subscription from.

### Real enforcement wired into existing routes (Phase 5)
- `POST /api/goals` — `goals_limit`, live-counted (not a monotonic
  counter — see `lib/billing/usage.ts`'s header for why).
- `GET /api/export/transactions`, `/api/export/goals` — `exports_limit`,
  period-scoped.
- `GET /api/export/annual-report` — `exports_limit`, but **only** on the
  `format=csv` path; `format=json` powers the on-screen report view and
  isn't gated, since viewing your own report isn't "an export."

### UI (Phase 10, 11) — `components/billing/`
- `PremiumBadge` — matches `components/ui/StatusBadge.tsx`'s exact
  visual language.
- `LockedCard` — shows real (blurred) preview content under a lock
  overlay, not a blank space; never a dark pattern.
- `UpgradePrompt` — inline banner for usage-limit/feature gates.
- `PlanComparisonDialog` — built on the existing `Modal` shell (focus
  trap, `role="dialog"`, Escape-to-close all inherited, not
  reimplemented); reads its feature list from the live catalogue, not a
  hardcoded JSX list.
- `/settings/billing` (+ `/success`, `/cancel`) — current plan, usage
  progress bars, upgrade CTA or portal-manage button. Linked from the
  existing Settings page.
- `lib/hooks/useBillingStatus.ts` — module-level cache + in-flight
  dedup so N gated components on one page cost one network request.

### Tests (Phase 16)
- `tests/unit/billing/entitlements.test.ts` (9 tests) — the pure
  `isEntitledStatus`/`buildFeatureMap` logic.
- `tests/unit/billing/usage.test.ts` (5 tests) — the pure
  `periodStartFor()` date-bucketing logic, including UTC-boundary and
  leap-year cases.
- **Honest gap, matching this codebase's existing precedent**: the
  Supabase-fetching wrapper functions (`getEntitlements`,
  `getSubscription`, `checkUsage`, `recordUsage`) and the webhook route's
  event-handling logic are NOT unit-tested — same documented gap
  `tests/unit/featureFlags.test.ts` already left for its own DB-fetching
  wrappers. Would need a mocked/real Supabase connection to test
  meaningfully; not built this sprint.
- Full suite run after every change: **599 pre-existing tests + 14 new
  = 613 passing, 0 regressions.** `npx tsc --noEmit` clean across the
  entire repo, run repeatedly during the sprint, not just once at the
  end.

### Docs (Phase 17)
`BILLING_AUDIT.md`, `PREMIUM_ARCHITECTURE.md`, `SECURITY_AUDIT.md`,
`PERFORMANCE_AUDIT.md`, `ACCESSIBILITY_AUDIT.md` (this file's siblings),
plus updates to `ARCHITECTURE.md` (new "Premium subscription
architecture" section + a Security model bullet) and `DATABASE.md` (new
"Billing" table section + RLS/migration notes).

## Verification actually performed, not just claimed

- `npx tsc --noEmit -p tsconfig.json` — clean, zero errors, run after
  every batch of changes.
- `npx vitest run` — full suite, 613 tests passing, 0 regressions from
  the goals-route/export-route edits.
- A real `jsx-a11y/strict` ESLint pass against every new UI file, same
  temporary-config method `docs/Sprint 27/ACCESSIBILITY_AUDIT.md`
  established — zero a11y findings, but it caught 3 real
  `react/no-unescaped-entities` errors (fixed) and, during manual
  contrast verification, one genuine bug: `LockedCard.tsx` initially used
  `bg-bg-950`, a class that doesn't exist in this project's Tailwind
  config (the real dark-surface token is `surface-base`). Fixed before
  shipping. Documented in `ACCESSIBILITY_AUDIT.md` rather than silently
  corrected, as the concrete example of why the audit's other claims were
  checked against actual code/config rather than assumed.

## What was intentionally deferred (documented, not hidden)

- **`scenarios_limit` has a seeded feature/plan-limit row but no
  enforcement point.** `lib/scenarioSimulator.ts` runs client-side with
  no dedicated API route today, so there's nowhere server-side to call
  `enforceUsageLimit()` from yet. `lib/billing/gate.ts` is ready to be
  dropped into a future `POST /api/scenarios/run` route if/when scenario
  running moves server-side. This is an unenforced entitlement, not a
  broken one — free users can currently run unlimited scenarios despite
  the seeded 3/day limit.
- **No server-generated invoice/payment-method UI.** Deliberate, per
  Phase 8 — Stripe's hosted Customer Portal is the one portal entry
  point; building a parallel UI would duplicate and risk drifting from
  what Stripe already renders correctly.
- **Real Stripe checkout/portal latency not load-tested** — no test-mode
  Stripe account configured in this environment. Documented in
  `PERFORMANCE_AUDIT.md` as follow-up rather than fabricated numbers.
- **Screen-reader software was not run** against the new UI (VoiceOver/
  NVDA/JAWS) — static analysis (tooling + code reading) only, same
  honest limitation `docs/Sprint 27/ACCESSIBILITY_AUDIT.md` documented
  for itself.
- **The out-of-order-webhook-delivery edge case** (two
  `customer.subscription.updated` events processed out of Stripe's
  intended order both `upsert`, last-write-wins) is called out as an
  accepted risk in `SECURITY_AUDIT.md` rather than closed with an
  event-timestamp guard — small practical exposure, real follow-up item.

## Known limitations

- `POST /api/goals`'s `goals_limit` check fails **open** (not closed) on
  a transient count-query error — the one deliberate exception to this
  sprint's otherwise-universal fail-closed posture for usage checks. See
  `SECURITY_AUDIT.md` for the reasoning.
- Free-tier limit *display strings* in `PlanComparisonDialog.tsx`
  (`formatFreeLimit()`) are a small hardcoded map used only for
  rendering — actual enforcement always reads `plan_features` via
  `lib/billing/entitlements.ts`. A future limit change needs a matching
  one-line update there to stay accurate in the comparison table, even
  though enforcement itself needs no code change.
- Multi-tier (3+) plan support needs no schema or enforcement changes,
  but the comparison dialog's 2-column table layout would need a small
  UI change to render a third plan column.

## Future work

- Wire `scenarios_limit` enforcement once/if scenario simulation gets a
  server route.
- Close the out-of-order webhook edge case with an `event.created`
  timestamp guard in the `subscriptions` upsert.
- Load-test checkout/portal latency against a real Stripe test-mode
  account.
- Consider a second billing provider adapter (Paddle/Lemon Squeezy) if
  international tax handling becomes a requirement — the interface is
  ready; no other code needs to change.
