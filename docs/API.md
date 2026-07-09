# SaveQuest — API Reference

All routes are under `app/api/`. Unless noted, authentication is via the Supabase session cookie (RLS-scoped client) — there is no separate API-key auth for user-facing routes.

## Conventions

- **Errors**: `{ "error": string }` with an appropriate HTTP status (400 validation, 401 unauthorized, 429 rate-limited, 500 server error).
- **Idempotency**: financial mutation routes accept an `idempotency_key` in the body; a retried request with the same key returns the original result rather than creating a duplicate.
- **Financial endpoints never cached**: see `docs/ARCHITECTURE.md`'s offline architecture section — this is enforced at the service-worker level, not just by convention.

## Financial

| Route | Method | Auth | Notes |
|---|---|---|---|
| `/api/transactions` | POST | User session | Deposit or withdrawal. Idempotency-key supported. Triggers XP/achievement checks and fire-and-forget push notifications. |
| `/api/transactions/withdrawal` | POST | User session | Overdraft-protected. |
| `/api/goal/purchase-complete` | POST | User session | Completes a goal via its "purchase" flow; awards milestone XP + fires the `milestone_celebration` push. |
| `/api/goal/edit` | POST | User session | |
| `/api/goal/delete` | POST | User session | |
| `/api/goals` | GET | User session | |
| `/api/xp` | GET | User session | |

## Quests & Challenges

| Route | Method | Notes |
|---|---|---|
| `/api/quest/daily/complete` | POST | Rate-limited (10/60min). Idempotent per (user, day). |
| `/api/quest/weekly/accept` / `/complete` | POST | |
| `/api/quest/chain/step` | POST | |
| `/api/quest/challenge/accept` / `/complete` | POST | |

## Notifications

| Route | Method | Notes |
|---|---|---|
| `/api/notifications/list` | GET | Returns recent `notification_logs` rows + unread count. Powers the Notification Center. |
| `/api/notifications/mark-read` | POST | Body: `{ id }`, `{ ids: string[] }` (Sprint 16, group mark-read), or `{ all: true }`. |
| `/api/notifications/preferences` | GET / PATCH | Sprint 16. GET creates a default-all-true row on first access. PATCH whitelists exact field names/types. |
| `/api/notifications/subscribe` / `/unsubscribe` | POST | Web Push subscription lifecycle. |
| `/api/notifications/track` | POST | Delivery/click tracking. |

## Events

| Route | Method | Notes |
|---|---|---|
| `/api/events/join` | POST | |
| `/api/events/complete` | POST | |

## Onboarding

| Route | Method | Notes |
|---|---|---|
| `/api/onboarding/complete` | POST | |
| `/api/onboarding/dismiss-notification-prompt` | POST | |
| `/api/onboarding/starter-goal` | POST | |

## Account

| Route | Method | Notes |
|---|---|---|
| `/api/account` | GET / DELETE | |
| `/api/profile` | GET / PATCH | |
| `/api/profile/purchase-shield` | POST | Streak-shield purchase. |

## System

| Route | Method | Auth | Notes |
|---|---|---|---|
| `/api/version` | GET | **Unauthenticated by design** | Build metadata (version, short commit SHA, environment). No secrets — see Sprint 16's comment in the route file for why this is intentional. |
| `/api/analytics/session` | POST | User session | |
| `/api/debug/sentry-test` | GET | — | Manual Sentry pipeline check. |

## Cron (Vercel Cron only — not user-reachable)

| Route | Auth | Notes |
|---|---|---|
| `/api/cron/notifications` | `CRON_SECRET` header | Daily scheduler + (Mondays only) weekly summary. |
| `/api/cron/business-metrics` | `CRON_SECRET` header | |

## Admin (`/api/admin/*`)

Requires an authenticated session **and** an admin-role check server-side (not just RLS). Covers badges, daily/weekly/seasonal quest management, quest chains, event management, and user administration. Rate-limited (`lib/rateLimit.ts`).
