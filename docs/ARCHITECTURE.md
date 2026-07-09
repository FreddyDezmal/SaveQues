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

Two layers, easy to conflate but distinct:
- **`notification_logs`** — the actual push-delivery table. Every send (streak reminder, quest reminder, achievement unlock, milestone, weekly summary) writes a row here. Extended in Sprint 16 with `read_at` for in-app read state, making this table double as the Notification Center's data source rather than needing a second table.
- **`notification_preferences`** — one row per user, six category booleans (Sprint 16). `lib/notifications.ts`'s `canSendNotificationToUser()` checks both the master `profiles.notifications_enabled` switch and the specific category before any immediate-trigger send (achievement/milestone). The daily cron scheduler pre-filters on the master switch in its initial query and checks per-category preferences per-user inside the loop.

Delivery paths:
- **Daily cron** (`app/api/cron/notifications/route.ts`, Vercel Cron, 08:00 UTC) — streak-at-risk, quest reminders, inactivity nudges. Also triggers the weekly summary scheduler, but only on Mondays (reuses this same cron slot rather than requesting a second one).
- **Immediate, request-time** (`lib/awardXP.ts`) — achievement unlocked, goal-completion milestone. Fire-and-forget from inside the transaction/goal-completion API routes.

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
