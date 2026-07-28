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

## Security model

- **Auth**: Supabase Auth, RLS-scoped client (`lib/supabase/server.ts` using the anon key + user's session cookies) for all user-facing routes. A separate `createServiceClient()` (service role, RLS-bypassing) is used only in the notification cron and a small number of admin/system paths — never in a route reachable directly from client input.
- **Middleware**: `middleware.ts` redirects unauthenticated requests to `/auth/login`, with a negative-lookahead matcher excluding static assets, `manifest.json`, `sw.js`, and icon/screenshot paths (the SW file must never be routed through an auth check that could return a redirect body, which would break registration).
- **CSP**: enforced (not report-only — see the Sprint 18 audit correction) via `next.config.js`'s `headers()`.
- **Rate limiting**: Postgres-COUNT-based (`lib/rateLimit.ts`), explicitly self-documented as needing a Redis migration at 10k+ users.
- **RLS**: 50 policies across 28 tables (see `docs/DATABASE.md`). Every user-facing table scopes reads/writes to `auth.uid()`.
- **Audit logging**: `audit_logs` table, written from financial mutation paths.
- **Notification-specific hardening** (Sprint 27, Phase 14): deep-link values are validated as same-origin relative paths (rejecting absolute/protocol-relative/`javascript:` URLs) before client-side navigation, on both the in-app router and the service worker — defense-in-depth, since `deep_link` is exclusively server-constructed today. `sendToUser()` re-checks the master notification switch as a final safety net, mirroring how vacation mode was already handled.
