# SaveQuest — Architecture

## Application structure

Next.js 14 App Router. Two top-level route groups:

- `app/auth/*` — login, signup, password reset, email verification, OAuth callback. No shared layout beyond the root.
- `app/(app)/*` — everything behind authentication (dashboard, goals, quests, achievements, timeline, events, settings, admin). Shares `app/(app)/layout.tsx`, which:
  1. Redirects to `/auth/login` server-side if there's no authenticated user (`lib/supabase/server.ts`'s `createClient().auth.getUser()`).
  2. Renders `AppHeader` (notification bell) and `OfflineBanner` above `children`, and `BottomNav` below.

This layout is a **shared segment** — Next.js does not remount it on navigation between sibling routes (`/dashboard` → `/goals` → `/settings`). Anything mounted here (the SW registration, the notification bell's initial fetch) runs once per session, not once per page view. This matters for reasoning about performance — see `docs/DEVELOPMENT.md`'s note on this if it comes up again.

## Providers

Mounted once at the root (`app/layout.tsx`), outside the auth/app route split, in this order:
1. `AnalyticsProvider` — PostHog client init, user identification
2. `ServiceWorkerRegistration` — unconditional `/sw.js` registration (Sprint 15; previously only registered inside the push-notification opt-in flow)
3. `UpdateToast` — detects a waiting service worker, prompts the user to activate on their own action (never automatic — see Security/Reliability note below)
4. `InstallSuccessCelebration` — one-time "installed!" modal, gated on the real `appinstalled` browser event, not on `display-mode: standalone` alone
5. `UndoSnackbarProvider` — wraps `children`; exposes `useUndoSnackbar()` anywhere in the tree

## Data flow (financial mutations)

Deposits/withdrawals go through `app/api/transactions/route.ts`, never a direct client-side Supabase write. That route:
1. Authenticates via the request's Supabase session (RLS-scoped, not service role)
2. Validates amount bounds, idempotency key
3. Writes the transaction row + updates goal progress inside a single flow using `award_xp`-style RPCs for atomicity
4. Fires XP/achievement checks (`lib/awardXP.ts`) synchronously
5. Fires push notifications (achievement unlocked, milestone) **fire-and-forget** — explicitly not awaited, specifically so a slow/failed push send can never add latency to or fail the financial response. See `lib/awardXP.ts`'s comments at each call site.
6. Defers non-critical analytics (PostHog) via a `deferAnalytics`-style wrapper so the HTTP response doesn't wait on a third-party network call

## Notification architecture

**Sprint 27 rebuilt and substantially expanded this system across 16
phases.** This section is the current-state summary; each phase's own
doc (`docs/SPRINT27_PHASE{3-15}_*.md`) has the full reasoning, audit
findings, and honest limitations behind each piece — read those for
*why*, this section for *what exists now and how it fits together*.

### Notification flow

A notification's life: **triggered** (a scheduler decides it's due, or
an action fires one immediately) → **templated** (title/body rendered
from `lib/notificationTemplates.ts`) → **logged** (`notification_logs`
row created — this happens even if the user has zero active push
subscriptions, so the in-app inbox always has a record) →
**delivered** (push, via whichever provider is configured) →
**engaged with** (delivered/opened/clicked/dismissed/converted, all
tracked — see Testing strategy below for what "opened" actually means).

Two trigger paths:
- **Scheduled** — see Scheduler flow below.
- **Immediate, request-time** — achievement unlocked, goal-completion
  milestone, partner/friend/group social actions. Fire-and-forget from
  inside the relevant API route (same principle as the pre-Sprint-27
  transaction flow above: a slow/failed notification send must never
  add latency to or fail the action that triggered it).

Every notification deep-links somewhere specific — `/goals/{id}`,
`/groups/{id}`, `/digest/{id}`, `/achievements?highlight={id}` — not a
generic list page, audited deliberately in Phase 6. `deep_link` values
are validated as same-origin relative paths before being used for
navigation (Phase 14 defense-in-depth — see Push/Email architecture's
security note).

### Scheduler flow

All schedulers live in `lib/notifications.ts`, orchestrated from one
cron entry point (`app/api/cron/notifications/route.ts`, Vercel Cron,
once daily) rather than requesting a new Vercel Cron slot per feature —
each scheduler internally gates on which day it should actually do
anything:

| Scheduler | Cadence | Covers |
|---|---|---|
| `runDailyNotificationScheduler` | Every run | Streak-at-risk, quest reminders, inactivity, and the Phase 3 "smart reminders" (goal-almost-complete, goal-deadline-approaching, missed-weekly-deposit) — 8 checks per eligible user, batched (goals/deposits/quest-logs) rather than queried per-user where the underlying data allows it. |
| `runWeeklySummaryScheduler` | Mondays | Personal weekly digest — persists a `user_digests` row, links the push to `/digest/[id]`. |
| `runMonthlyDigestScheduler` | 1st of month | Personal monthly digest — savings/XP graphs, achievements, best/worst week, momentum score. |
| `runPartnerReminderScheduler` | Every run | Accountability partner check-in nudges, cooldown-gated. |
| `runGroupWeeklySummaryScheduler` | Mondays | Group-scoped weekly digest. |
| `runGroupQuestEndingReminderScheduler` | Every run | Group quest deadline approaching. |
| `runNotificationLogsCleanupScheduler` | Sundays | Retention purge — see Database note below. |

**Idempotency and concurrency safety** (Phase 8): the daily scheduler
uses an atomic conditional claim (`tryClaimDailyNotificationSlot`) — the
database UPDATE's row-count *is* the send decision, not a separate
read-then-write, closing a real race where two overlapping cron
invocations could otherwise both send. The weekly/monthly/group
schedulers use a shared `getRecentlyNotifiedUserIds()` dedup check
against `notification_logs` for the same reason. Every scheduler's
per-user loop is wrapped in a `try`/`catch` so one bad row can't abort
processing for everyone after it in that run.

### Preference system

`notification_preferences` — one row per user, **eleven** category
booleans as of Phase 4 (`achievements`, `goal_reminders`,
`streak_reminders`, `weekly_summaries`, `milestone_celebrations`,
`product_announcements`, `groups`, `partners`, `xp`, `referrals`,
`monthly_summaries` — not all eleven gate a real send yet; see that
phase's doc for exactly which), plus **quiet hours**
(`quiet_hours_enabled`/`_start`/`_end`, timezone-aware, overnight-wrap
handled), **vacation mode** (`vacation_mode`/`vacation_until`,
auto-expiring), and **digest frequency** (persisted, but only
`"immediate"` currently changes behavior — `"hourly"`/`"daily"`/
`"weekly"` batching is Phase 5-and-later scope, not built).

Enforcement has two choke points, deliberately not left to every
individual sender to remember correctly:
- `sendToUser()` (the function every single notification path funnels
  through) checks vacation mode AND the master `notifications_enabled`
  switch as the last line of defense (Phase 4, hardened in Phase 14) —
  even if a future sender forgot its own category check, these two
  can't be bypassed.
- Category-specific checks (`canSendNotificationToUser()` for
  request-time sends, `getPref()` for the batched scheduler) happen
  before that, per notification type.

### Email architecture

`lib/email/` (Phase 9) — an `EmailProvider` interface with adapters for
Resend, SendGrid, Postmark, and Mailgun (all real, request shapes
verified against each provider's current docs) plus a documented stub
for SES (AWS SigV4 signing is deliberately not hand-rolled — see that
phase's doc for why). **Inactive by default**: `EMAIL_PROVIDER` is unset
everywhere in this project, so `selectEmailProvider()` always resolves
to a no-op provider that logs what it would have sent. `lib/invites.ts`
is the one real caller today.

### Push architecture

`lib/push/` (Phase 10) — same shape, one deliberate difference: the
default provider isn't a no-op, it's the **existing, already-live**
standards-based Web Push implementation (`lib/webpush.ts`, VAPID) —
defaulting to "send nothing" would have been a regression, not a safe
default. Adapters exist for Expo, OneSignal, and Firebase (FCM's full
OAuth2 service-account JWT flow, genuinely implemented — mechanically
identical to the ES256 signing this app already does correctly for
VAPID). APNs' JWT auth-token builder is real and cryptographically
verified in tests; its `send()` is a documented stub, because APNs
hard-requires HTTP/2, which Node's `fetch` cannot do — a transport
blocker, not a complexity judgment call.

`sendToUser()` routes push through `sendPush()` (the selector) and
retries once, briefly, for plausibly-transient failures only
(`sendWebPushWithRetry`, Phase 8) — never for permanent ones (410/404
Gone).

### Future provider integration

Both provider layers are structured so adding a real provider later
touches exactly one file (a new/enabled adapter) and one env var
(`EMAIL_PROVIDER`/`PUSH_PROVIDER`) — zero changes to `lib/notifications.ts`
or any sender. See `.env.local.example` for the full (commented-out)
configuration surface for every adapter.

### Testing strategy

Three tiers (see `docs/DEVELOPMENT.md`), same split as the rest of the
app. Notification-specific: extensive pure-logic unit coverage
(`reminderEngine`, `digest`, `notificationTemplates`,
`notificationAnalytics`, provider request-builders — 160+ tests), real
scheduler-level tests for the one scheduler simple enough to mock
Supabase for accurately (`notificationCleanupScheduler.test.ts`, Phase
15), and an honestly-incomplete integration-test TODO list
(`tests/integration/notification-delivery.test.ts`) for everything that
genuinely needs a live database or real provider credentials this
environment doesn't have — each scenario specified precisely enough to
implement directly, not vague placeholders.

### Analytics

`notification_logs` tracks delivered/clicked/dismissed/converted
directly; "opened" reuses the in-app inbox's existing `read_at`
(Sprint 15) rather than a duplicate column; "ignored" is a computed
reporting category (delivered, nothing else happened), not tracked
state. `lib/notificationAnalytics.ts` is the shared computation module
behind `/api/admin/notifications` — rates are computed against the
denominator that makes each one meaningful (click rate against
*delivered*, conversion rate against *clicked*), not uniformly against
*sent*. Conversion attribution (`lib/notificationAttribution.ts`) is
wired into deposit creation specifically — the app's single most
valuable, unambiguous conversion signal — not fabricated across every
notification type.

### Data retention

`notification_logs` and stale `push_subscriptions` both have retention
policies (Phase 13) — neither did before Sprint 27, and both grew
unboundedly. See Database doc for the exact windows.

## Offline architecture

Serwist-based service worker (`app/sw.ts`, compiled to `public/sw.js` at build time). Runtime caching rules, evaluated in order:
1. **NetworkOnly** for anything financial or auth-related (`/api/transactions*`, `/api/goal*`, `/api/account*`, `/api/admin*`, `/auth/*`) — never cached, in either direction. This is the load-bearing rule for financial correctness offline.
2. **StaleWhileRevalidate** for read-mostly quest catalog data
3. **CacheFirst** for hashed static assets and images
4. Navigation fallback to `/offline` on network failure

Deposits and withdrawals are never queued for later — see `lib/hooks/useOnlineStatus.ts` and the deposit form's offline guard in `GoalDetailClient.tsx` (both the disabled button AND a redundant check inside the submit handler, since a disabled button doesn't stop Enter-key form submission).

`skipWaiting`/`clientsClaim` are deliberately `false` — a new service worker version waits until the user's next full app restart to activate, rather than swapping an already-open tab's network layer mid-session. `UpdateToast` is the explicit, user-triggered path to activate sooner.

## Premium subscription architecture

Sprint 29. Full design rationale in `docs/PREMIUM_ARCHITECTURE.md`; audit
of what pre-existed (nothing) in `docs/BILLING_AUDIT.md`.

- **Domain model**: `Plan` / `Feature` / `PlanFeature` (catalogue, DB rows
  under `supabase/migrations/069_premium_subscriptions.sql` — not
  hardcoded in TypeScript) → `Subscription` (one per user, synced only by
  webhooks) → `Entitlements` (computed on every call, never stored).
- **Single entry point**: `lib/billing/entitlements.ts`'s
  `getEntitlements()` / `hasFeature()` / `getFeatureLimit()` are the only
  functions any route or component calls — no scattered
  `if (user.isPremium)` checks anywhere.
- **Provider abstraction**: `lib/billing/provider.ts` (interface) +
  `lib/billing/providers/stripe.ts` (first adapter), mirroring the
  existing `lib/push/types.ts` provider-adapter pattern. `stripe` package
  is imported in exactly one file.
- **Webhooks are the only writer of `subscriptions`**: `POST
  /api/billing/webhook` verifies Stripe's signature before touching the
  request, records every event id in `billing_webhook_events`
  (idempotency/replay protection), and only then upserts subscription
  state. Checkout/portal routes only ever redirect to Stripe.
- **Usage limits**: `lib/billing/usage.ts` for period-scoped counters
  (exports/month, scenarios/day via `usage_counters` + an atomic
  `increment_usage_counter()` RPC); `goals_limit` is counted live against
  `savings_goals` instead, since it's a decreasable count, not a
  monotonic one — see that module's header comment.
- **Client entitlement UI**: `lib/hooks/useBillingStatus.ts` wraps `GET
  /api/billing/status` with a module-level cache so multiple gated
  components on one page cost one network request, feeding
  `components/billing/{PremiumBadge,LockedCard,UpgradePrompt,PlanComparisonDialog}`.



- **Auth**: Supabase Auth, RLS-scoped client (`lib/supabase/server.ts` using the anon key + user's session cookies) for all user-facing routes. A separate `createServiceClient()` (service role, RLS-bypassing) is used only in the notification cron and a small number of admin/system paths — never in a route reachable directly from client input.
- **Middleware**: `middleware.ts` redirects unauthenticated requests to `/auth/login`, with a negative-lookahead matcher excluding static assets, `manifest.json`, `sw.js`, and icon/screenshot paths (the SW file must never be routed through an auth check that could return a redirect body, which would break registration).
- **CSP**: enforced (not report-only — see the Sprint 18 audit correction) via `next.config.js`'s `headers()`.
- **Rate limiting**: Postgres-COUNT-based (`lib/rateLimit.ts`), explicitly self-documented as needing a Redis migration at 10k+ users.
- **RLS**: 50 policies across 28 tables (see `docs/DATABASE.md`). Every user-facing table scopes reads/writes to `auth.uid()`.
- **Audit logging**: `audit_logs` table, written from financial mutation paths.
- **Notification-specific hardening** (Sprint 27, Phase 14): deep-link values are validated as same-origin relative paths (rejecting absolute/protocol-relative/`javascript:` URLs) before client-side navigation, on both the in-app router and the service worker — defense-in-depth, since `deep_link` is exclusively server-constructed today. `sendToUser()` re-checks the master notification switch as a final safety net, mirroring how vacation mode was already handled.
- **Billing-specific hardening** (Sprint 29, Phase 14 — full detail in `docs/SECURITY_AUDIT.md`): no client-writable "isPremium" flag exists anywhere — entitlements are recomputed server-side on every gated request. `subscriptions` and `usage_counters` have RLS `SELECT`-own policies and **no client write policy at all**; the only writer of `subscriptions` is the signature-verified webhook route, and the only writer of `usage_counters` is a `SECURITY DEFINER` RPC invoked exclusively via the service-role client. A canceled/past-due subscription falls back to free-plan entitlements even though its row still references the paid plan.

## Sprint 30: premium feature activation

Sprint 29 (above) built the billing plumbing; Sprint 30's Phase 1 audit
found almost none of it was connected to the app. Full detail (feature
keys, enforcement points, the one documented client-side-gating
tradeoff — see that section's security note) is in
`docs/PREMIUM_ARCHITECTURE.md`'s own Sprint 30 section; this is the
app-structure summary.

- **`/intelligence`** (new route) — one page surfacing everything
  `getFinancialIntelligence()` already computes (financial health, cash
  flow, category intelligence, behavior/risk, recommendations, coaching)
  plus a per-goal forecast/health/coaching panel for whichever goal is
  flagged `is_primary` (falling back to the nearest-target-date active
  goal — there is no existing engine that ranks a user's current goals by
  priority; this page does not invent one, see that route's own comment).
  Every card reused as-is from the dashboard/goal-detail pages that
  already had it; nothing recomputed.
- **`/reports`** (new hub) + **`/reports/monthly`** (new) — the Annual
  Report (pre-existing) had no link to it anywhere in the app before this
  sprint; neither did `lib/monthlyReport.ts` (Sprint 20, computed but
  never surfaced). Both are reachable now. The monthly report
  deliberately has no historical-month picker the way the annual report
  has a year picker — `buildMonthlyReport()` computes goal health/pace
  against *today's* real balances, so a past month would be actively
  misleading (see that route's own comment for the full reasoning).
- **Scenario Simulator** (`components/goals/ScenarioSimulatorCard.tsx`,
  goal detail) — extended, not rebuilt: the standard-scenario "what if"
  cards and comparison bars are unchanged Sprint 28/28.5 work. Added:
  server-enforced daily quota (see Premium doc), saved scenarios, and a
  currency-formatting fix (`lib/scenarioSimulator.ts`'s labels hardcoded
  `$` regardless of the user's real `currency_code`).
- **Performance**: `getFinancialIntelligence()` was computing
  `forecastGoal()` twice per active goal on every call — once inside
  `lib/coaching.ts`'s message generation, again inside
  `lib/accountHealth.ts`'s forecast-reliability factor. Both now accept
  an optional precomputed map (`forecastsByGoalId`/`healthByGoalId`),
  populated once by the orchestrator and shared into both; every other
  caller (e.g. `coachingMessagesForGoal()` on goal detail, which only
  ever handles one goal) is unaffected.

## Multi-currency architecture (Sprint 31)

SaveQuest launched ZAR-only. Sprint 31's 17-phase brief made the app
currency-aware end to end while explicitly forbidding a rewrite:
"extend existing modules instead of replacing them," "every existing
user experiences zero regression." A Phase 1 repository-wide audit
found this was less greenfield than expected — `lib/currency.ts`
already had a 116-currency catalogue and a central `formatAmount()`,
and `profiles.currency_code` already existed with a CHECK constraint.
The real gaps were: no decimal-precision awareness, no exchange-rate
infrastructure at all, several hardcoded-currency bypasses of the
central formatter, and one goal-recommendation module whose numbers
implicitly assumed ZAR. This section documents what Sprint 31 actually
built and fixed, not what it assumed needed building.

### Formatting layer (Phases 2, 5, 12)

`lib/currency.ts` is the single source of truth for currency
formatting — `formatAmount(amount, currencyCode, locale, options?)`.
Default output is **whole units, no decimals**, for every currency —
a deliberate product choice (this is a savings app; cents rarely
matter), not an oversight. `getCurrencyConfig(code)` now carries a
real per-currency `decimals` field (0 for JPY/KRW, 3 for BHD/KWD/OMR,
2 for most others) for callers that opt into `{ precise: true }` —
additive only, the default whole-unit output never changed. Lookup is
O(1) via a `Map` built once at module load (Phase 13 — it used to be
a 116-entry `.find()` on every call, including inside list-rendered
components).

`lib/dateFormat.ts` (Phase 12) is the equivalent for dates —
`formatDateLong`/`formatDateShort`/`formatDateNumeric`, all defaulting
to `DEFAULT_LOCALE`. Before this existed, ~15 components each called
`toLocaleDateString()` directly with locale handling that was
inconsistent three different ways (hardcoded to the wrong locale,
left to the browser's own runtime default, or — in the two report
clients — already correct but duplicated inline at every call site).
Deliberately kept as a *separate* module from `lib/dateUtils.ts`,
which answers "which calendar date is this" (a data-integrity
concern for activity-log writes) — the two should never merge.

Every hardcoded-currency-bypass found (Phase 1's audit, plus two more
found later doing unrelated work in Phases 9/12 — different JSX
syntax shapes the original grep patterns didn't catch) now routes
through these two modules. None remain as of Phase 12's final sweep.

### Exchange rates (Phase 6)

`lib/exchangeRates/` — an `ExchangeRateProvider` interface (mirrors
`lib/billing/provider.ts`'s and `lib/push/`'s existing adapter
pattern) with two implementations: `identity` (returns 1:1 rates,
logs a loud one-time warning — the safe default, since unlike push's
default this app never had a working FX feed to preserve) and
`exchangerate_api` (real, free-tier, inactive unless
`EXCHANGE_RATE_PROVIDER`/`EXCHANGE_RATE_API_KEY` are both set — true
for every environment as of this sprint).

Rates are stored **pivoted against USD**, one row per currency (116
rows), not one row per pair (which would need up to 13,340 rows for
full coverage) — converting A→B goes through USD:
`amountInUsd = amount / rate(A); result = amountInUsd * rate(B)`.
`exchange_rates` table: RLS enabled, **zero client policies** — only
the service-role client (the daily cron + `lib/exchangeRates/cache.ts`)
ever touches it, satisfying Phase 14's "users cannot manipulate
exchange rates" by construction, not by a runtime check.

Cache lifetime: **24 hours**, refreshed by `app/api/cron/exchange-rates/route.ts`
(same `CRON_SECRET` pattern as every other cron here). Read path
(`getCachedRates`, Phase 6, batched in Phase 13): fresh cached row →
use it; stale/missing → live provider call; live call fails but a
stale row exists → serve it anyway (logged); live call fails and
there's no cached row at all → throw, since there's nothing honest to
return. `getCachedRates` takes an array and does **one** query
(`.in(...)`) for however many currencies are needed — Phase 13 found
and fixed four call sites each doing N separate single-currency
queries where one batched query sufficed: `convertCurrency`,
`createZarConverter`, and `convertAmountsTo` (all in
`lib/currencyConversion.ts`), plus the shared-goal detail route, which
went from up to (member count + 1) round-trips per page load to one.

### Conversion engine (Phase 7)

`lib/currencyConversion.ts` — the **only** module in the app allowed
to call `lib/exchangeRates`'s cache for conversion purposes. Same
pure-core/thin-I/O-shell split as `lib/financialHealthScore.ts` vs.
`lib/financialHealthSnapshot.ts`: `convertAmount()` is pure,
deterministic, synchronous, fully unit-testable without a database —
rounds to the *target* currency's real decimal precision using an
epsilon-corrected `Math.round` (fixes the classic `1.005 → 1.00`
float misround; explicitly documented as not arbitrary-precision
arithmetic, since this app has no fixed-point library and none was
introduced for this alone). `convertCurrency`/`convertAmountsTo`/
`resolveRates`/`createZarConverter` are the async wrappers that
resolve rates and hand them to the pure function.

`createZarConverter(currencyCode)` exists for one specific reason:
`lib/recommendations.ts`'s goal-template baselines were authored in
raw ZAR numbers and used unconverted for every user (Phase 8's real
bug — a JPY user was offered a literal "¥15,000" emergency fund,
≈$100, too small; a KWD user, 15,000 KWD, ≈$49,000, absurd).
`getFinancialIntelligence()` is documented as pure/synchronous and
that contract wasn't broken to fix this — the two page routes that
call it resolve a currency-converter closure *once*, asynchronously,
before calling the (still-synchronous) orchestrator.

At the point Phase 7 shipped, nothing in the app actually needed real
conversion yet — same "built ahead of its first consumer" situation
Phase 6 was in until Phase 7 existed. Phase 9 (below) became that
first real consumer.

### Social features: currency stays visible, totals normalize (Phase 9)

Audited every social surface for currency-mixing risk. Groups,
Leaderboards, Partner Mode, and Invitations turned out to sidestep the
problem entirely, by design — they've never shown raw amounts at all
(migration 045: *"no amounts leak beyond goal participants"*). The one
surface that does, shared-goal contributions, had a real bug:
`group_contributions.amount` had no `currency_code` of its own, and
`get_shared_goal_detail()` did a plain cross-currency `SUM()` — a ZAR
contributor's 500 and a USD contributor's 500 were silently added as
if they were the same money.

Fixed with a documented architecture, not a guess: **original currency
stays visible per contribution** (`group_contributions.currency_code`,
migration 072, `DEFAULT 'ZAR'` — accurate for every pre-existing row,
this having been a single-currency platform until now); **totals
normalize into the goal owner's currency** (since `target_amount`
already lives there), via `lib/currencyConversion.ts`, exclusively
inside `app/api/shared-goals/detail/route.ts` — never in the RPC (no
rate-cache access from SQL) and never in the client component. The RPC
itself only ever does same-currency `SUM()`s (safe), returning a
per-currency breakdown; Node does the actual cross-currency math.

### Reporting: a Currency column, not a currency symbol (Phase 10)

CSV exports (`lib/exportCenter.ts`) needed a different fix than the UI
did. Embedding a symbol into the amount column (`"R500"`) would break
a spreadsheet's ability to sum it. Instead, `transactionsToCSV`,
`goalsToCSV`, and both annual-report CSV builders gained a separate
`Currency` column (ISO code) alongside the still-bare-numeric amount
column — unambiguous without sacrificing spreadsheet usability.
Report *pages* needed no changes; they were already fully
currency-aware from earlier phases.

### What Sprint 31 deliberately didn't build

Documented per-phase, not hidden: `recommendations.ts`'s target
rounding (nearest 100 units) still assumes a ZAR-like unit value —
cosmetic for BHD/KWD, not fixed. ~10 components still render dates in
`DEFAULT_LOCALE` rather than each individual viewer's own locale
(would require new prop plumbing, not a formatting fix — Phase 12's
own header documents exactly which). No screen yet does real
cross-currency comparison, so the conversion engine has no live
consumer beyond shared-goal totals.
