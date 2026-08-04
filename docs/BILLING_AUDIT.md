# Billing / Premium Audit — Sprint 29, Phase 1

Performed before any code was written for the Premium Subscription Platform.
Method: repo-wide grep across `app/`, `lib/`, `components/`, `supabase/migrations/`
for every term in the sprint brief's checklist, plus manual inspection of the
hits. Full commands and raw output are reproducible; this file records the
conclusions.

## Summary table

| Item                          | Status          | Evidence |
|--------------------------------|-----------------|----------|
| Premium flags                  | **Missing**     | No `is_premium` / `premium` boolean anywhere in `supabase/migrations/*.sql` or `profiles` table. |
| Feature gates                  | **Missing**     | No `if (user.isPremium)`-style checks anywhere in `app/` or `lib/`. |
| Billing abstraction            | **Missing**     | No `lib/billing/` directory. |
| Subscription tables            | **Missing**     | No `subscriptions`, `plans`, or `entitlements` table in any of the 58 numbered migrations (001–068). |
| Payment adapters                | **Missing**     | No provider adapter files. |
| Stripe integration              | **Missing**     | `stripe` is not a dependency in `package.json`; zero references to "stripe" in source. |
| Paddle integration               | **Missing**     | Zero references. |
| Lemon Squeezy integration        | **Missing**     | Zero references. |
| Entitlement middleware           | **Missing**     | Zero references to "entitlement" anywhere in the codebase. |
| Premium badges                  | **Missing**     | `components/ui/` has `StatusBadge.tsx` and `VisibilityBadge.tsx` (goal-status / privacy badges), no premium-related badge. |
| Usage limits                    | **Missing**     | `app/api/goals/route.ts` validates title length, category, target amount — no count-based limit. No user has a goal/export/scenario ceiling today. |
| Quota tracking                  | **Missing**     | No table or column tracks per-user counts against a period. |
| Billing UI                      | **Missing**     | No `/settings/billing`, `/upgrade`, or similar route exists under `app/(app)/`. |
| Invoice history                 | **Missing**     | No invoice-shaped table or UI. |
| Webhook handlers                 | **Missing**     | `app/api/` has no `webhook` route of any kind (checked with `find -iname "*webhook*"`). |

**Conclusion: every item in the Phase 1 checklist is genuinely missing.**
Nothing in this sprint is a rebuild — Phases 2–9 below are net-new
infrastructure, not extensions of anything that already exists.

## Adjacent infrastructure this sprint reuses (found and confirmed working)

These are **not** billing systems, but they're the exact seams the new
Premium platform is built on top of, per the "extend before replacing" rule:

- **`lib/push/types.ts` provider-adapter pattern** (Sprint 27, Phase 10) —
  one `interface`, multiple adapters behind it, callers depend only on the
  interface. `lib/email/providers/` (Sprint 24-ish) uses the identical shape.
  The new `lib/billing/provider.ts` copies this pattern exactly rather than
  inventing a new one — see `PREMIUM_ARCHITECTURE.md`.
- **`lib/featureFlags.ts`** (Sprint 24, Phase 4) — a real feature-flag system,
  but it flags *experiments/rollouts*, not *paid entitlements*. It has no
  concept of a plan, a price, or a subscription. Confirmed by reading the
  full file: `evaluateFlag()` takes `(flag, userId)` and returns a boolean
  from rollout-percentage bucketing — there is no per-plan dimension. Reused
  only as a style reference (pure-function-core + thin I/O wrapper), not
  extended.
- **`lib/adminAudit.ts`'s `requireAdmin()` / service-role-client pattern** —
  reused verbatim for webhook handlers, which (like admin routes) must write
  with the service-role client since Stripe webhooks arrive with no Supabase
  session to carry RLS.
- **`lib/rateLimit.ts`** — reused for the checkout/portal routes (an
  authenticated user hammering "Upgrade" is the same class of problem it
  already solves for other write routes).
- **`lib/logger.ts`, `lib/monitoring.ts` (`captureError`), `lib/auditLog.ts`,
  `lib/analytics-server.ts`** — every new billing route follows the exact
  same `createLogger(...)` / `captureError(...)` / `trackServerEvent(...)`
  shape as `app/api/goals/route.ts` (Sprint 10) so this doesn't read as a
  bolted-on subsystem.
- **`lib/exportCenter.ts`'s own comment** (line ~246) had already flagged
  server-generated PDF export as "a real Premium-feature candidate" back in
  Sprint 24 — confirms `exportCenter` was written anticipating this sprint.
  Export limits (Phase 5) hook into `lib/exportCenter.ts`'s existing call
  sites rather than adding a second, parallel counting mechanism.
- **`supabase/migrations/067_financial_health_snapshots.sql`** — most recent
  migration; established the "server decides, client reads" RLS shape
  (no client INSERT/UPDATE/DELETE policy, service-role-only writes) that
  `069_premium_subscriptions.sql` follows for `subscriptions` and
  `usage_counters`.

## What this means for Phases 2–9

Because nothing pre-exists, this sprint builds the full stack described in
the brief: `Plan` / `Feature` / `Entitlement` / `Usage` domain model,
Stripe-first pluggable `BillingProvider`, checkout/portal/webhook routes,
and UI gating — all documented in `PREMIUM_ARCHITECTURE.md`.
