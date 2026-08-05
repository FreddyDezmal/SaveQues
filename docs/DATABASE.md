# SaveQuest — Database

Postgres via Supabase. 28 tables, 50 RLS policies as of Sprint 18, plus `user_digests` (Sprint 27 Phase 5) since. 57 migration files as of Sprint 27.

## Core tables

| Table | Purpose |
|---|---|
| `profiles` | One row per user. Currency preference (`currency_code`, default `ZAR`, CHECK-constrained against `lib/currency.ts`'s 116-currency `SUPPORTED_CURRENCIES` list as of Sprint 31 Phase 3 — expanded from an original 10 by migration `056_expand_currency_codes.sql`) plus `locale` (default `en-ZA`), notification settings, XP total, streak state. Both columns existed since migration 014 but were missing from the hand-maintained TypeScript `Database` type until Sprint 31 Phase 5 — every `profile.currency_code` read before then was technically untyped. |
| `savings_goals` | `title`, `target_amount`, `current_amount`, `goal_status` (`active`/`paused`/`completed`/`archived`), `is_primary`. |
| `transactions` | Deposits/withdrawals. `transaction_type`, `amount`, `idempotency_key`. |
| `xp_awards` | XP grant audit trail — what makes `award_xp`-style RPCs idempotent per (user, action, source). |
| `user_achievements` | Which of `lib/achievements.ts`'s ~40 achievements each user has unlocked. |
| `badges` | Cosmetic/display badges (distinct from achievements). |

## Notifications

Substantially expanded across Sprint 27's 16-phase notification-system
overhaul — see `docs/ARCHITECTURE.md`'s Notification architecture
section for how these fit together, and `docs/SPRINT27_PHASE*.md` for
the detailed reasoning behind each addition.

| Table | Purpose |
|---|---|
| `notification_logs` | Every notification send. Columns as of Sprint 27: `read_at` (Sprint 16, in-app inbox state — reused as "Opened" for analytics rather than duplicated), `deep_link`/`archived_at`/`deleted_at` (Sprint 17), `dismissed_at`/`converted_at` (Phase 11). No `created_at` column — only `sent_at`; a Phase 8 audit found and fixed a real bug where one query filtered on a `created_at` column that has never existed on this table. |
| `notification_preferences` | One row per user. **11** category booleans as of Phase 4 (was 6 through Sprint 16) — `achievements`, `goal_reminders`, `streak_reminders`, `weekly_summaries`, `milestone_celebrations`, `product_announcements`, `groups`, `partners`, `xp`, `referrals`, `monthly_summaries` (not all live-wired to a real send yet — see Phase 4's doc). Plus `quiet_hours_enabled`/`_start`/`_end`, `vacation_mode`/`_until`, `digest_frequency`. |
| `push_subscriptions` | Web Push subscription objects, keyed by user + endpoint. `updated_at` is now correctly maintained on deactivation (Phase 13 fix — it previously wasn't, making it useless for staleness checks). |
| `user_digests` | New, Phase 5. Persisted weekly/monthly digest snapshots — a digest shows what was true when generated, not a live recompute. |

## Notification data retention (Phase 13)

`notification_logs` and `push_subscriptions` had no retention policy at
all before Sprint 27 — both grew unboundedly. `runNotificationLogsCleanupScheduler`
(runs Sundays) now purges: soft-deleted `notification_logs` rows after
30 days, all `notification_logs` rows after 180 days regardless of
state, and deactivated `push_subscriptions` after 90 days of inactivity.

## Quests / Challenges / Events

`daily_quests`, `daily_quest_logs`, `weekly_quests`, `user_weekly_quests`, `quest_chains`, `quest_chain_steps`, `quest_chain_progress`, `challenges`, `user_challenges`, `events`, `event_regions`, `user_event_participation`, `weekly_reflections`.

## Observability / operational

| Table | Purpose |
|---|---|
| `audit_logs` | Financial mutation audit trail. |
| `admin_audit_log` | Admin action audit trail (separate from user financial audit log). |
| `request_outcomes` | Success/failure outcome tracking per route, feeding `lib/businessMetrics.ts`'s alerting (e.g. quest success rate, notification delivery rate). |
| `rate_limit_attempts` | Backing store for `lib/rateLimit.ts`'s Postgres-COUNT-based limiter. |
| `dashboard_timings` | Performance instrumentation. |
| `analytics_daily_activity`, `activity_log`, `user_engagement_status` | Engagement/activity aggregates. |

## Row-Level Security

All 50 policies scope to `auth.uid()`. Pattern used consistently:

```sql
CREATE POLICY "table_select_own" ON table_name
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "table_update_own" ON table_name
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

One documented residual gap (Sprint 16, still accurate as of Sprint 27): RLS policies can't restrict *which columns* an `UPDATE` touches — `notification_logs`'s update policy allows updating the row, and it's the **application code** (`app/api/notifications/mark-read/route.ts`, `/archive`, `/delete`, `/track` — the last of these now also writing `dismissed_at` as of Phase 11), not the database, that guarantees only the intended tracking columns are ever written. A follow-up trigger rejecting changes to `title`/`body`/`sent_at`/`notification_type` would close this properly; not yet built.

## Billing (Sprint 29)

Full design rationale in `docs/PREMIUM_ARCHITECTURE.md`. Six new tables,
none of which existed before Sprint 29 (see `docs/BILLING_AUDIT.md`):

| Table | Purpose |
|---|---|
| `plans` | Purchasable tier catalogue (`free`, `premium`, ...). Public-readable, admin-write only. |
| `features` | Gatable feature/limit catalogue, tagged `kind` (`boolean`/`limit`). |
| `plan_features` | Which features a plan grants, and at what limit (`null` = unlimited). The single source of truth `lib/billing/entitlements.ts` reads from. |
| `subscriptions` | One row per user's current subscription state. Written only by the Stripe webhook route — see Security model below. |
| `usage_counters` | Period-scoped usage (exports/month, scenarios/day), incremented via the `increment_usage_counter()` `SECURITY DEFINER` RPC. |
| `billing_webhook_events` | Idempotency ledger keyed on the provider's own event id — no client policies at all. |

## Row-Level Security — Sprint 29 additions

5 new `SELECT`-only policies (`plans_select_all`, `features_select_all`,
`plan_features_select_all` are public-readable catalogue data;
`subscriptions_select_own` and `usage_counters_select_own` scope to
`auth.uid()`). `billing_webhook_events` has RLS enabled with **zero**
policies — deliberately deny-all for every client role; only the
service-role client (used exclusively by the webhook route) can touch it.

## Billing — Sprint 30 addition

`saved_scenarios` (migration `070_scenario_simulator_premium.sql` +
`rollback/070_down.sql`) — one row per scenario a user has saved on a
goal's "what if" panel. Stores the scenario *input*
(`scenario_type`/`amount`/`interval_days`/`label`), not a frozen
computed result: a saved scenario re-simulates against the goal's
current transactions every time it's viewed, via the same
`simulateScenario()` every other scenario on that page already goes
through — see `docs/PREMIUM_ARCHITECTURE.md`. FK to `savings_goals(id)`
and `profiles(id)`, both `ON DELETE CASCADE`.

New feature row: `saved_scenarios_limit` (`kind='limit'`,
`reset_period='lifetime'`) — same live-row-count pattern as
`goals_limit`, not `usage_counters`. Free: 1 per goal. Premium:
unlimited (`limit_value = NULL`).

RLS: one `FOR ALL USING/WITH CHECK (auth.uid() = user_id)` policy
(`saved_scenarios_crud_own`) — the only new-in-Sprint-30 table with a
client write policy at all (everything else this sprint touched was
either read-only catalogue data already covered by Sprint 29's policies,
or write access already mediated entirely through existing tables'
existing policies).



## Multi-currency (Sprint 31)

Full design rationale in `docs/ARCHITECTURE.md`'s Multi-currency
architecture section. One new table, one column addition:

| Table | Purpose |
|---|---|
| `exchange_rates` | New, Phase 6. One row per supported currency (`currency_code` PK, same 116-code CHECK constraint as `profiles`), priced against USD (`usd_rate`). RLS enabled, **zero client policies** — same deny-all-clients pattern as `billing_webhook_events` (Sprint 29). Only the daily cron and `lib/exchangeRates/cache.ts`'s service-role client ever write to it. 24-hour cache lifetime — see Architecture doc for the exact fallback order on a stale/missing read. |

`group_contributions` (Sprint 27's social foundation, migration 045)
gained a `currency_code` column (migration 072, Phase 9) —
`DEFAULT 'ZAR'`, same CHECK constraint pattern. Not a guess for
existing rows: every contribution made before this sprint genuinely
was ZAR, since the platform was single-currency until now. Captured at
insert time from the contributing user's own `profiles.currency_code`
— never accepted from the request body (`app/api/shared-goals/contribute/route.ts`
doesn't read a `currency_code` field from its input at all).

`get_shared_goal_detail()` (migration 049) was rewritten by migration
072 to stop doing a cross-currency `SUM()` across `group_contributions`
— it now returns a per-currency breakdown (SQL only ever sums rows
sharing one `currency_code`, which is safe); the actual cross-currency
total is computed in Node, not SQL. See Architecture doc for why.

**A note on naming, found during the Sprint 18 audit and worth stating plainly rather than re-presenting as a fresh discovery**: migration files use three different naming conventions across the project's history — sequential numbers (`001_initial_schema.sql` … `017_...`), dated files (`20260613_notifications.sql`, `20260707_notification_preferences.sql`), and a few unprefixed files (`admin_read_policies.sql`). This is **already documented and audited** in `supabase/migrations/MIGRATION_CONFLICTS.md`, which predates this sprint and explains which early migrations were superseded (e.g. `0061_...` superseded by `0062_...`) and the `014_prod_cleanup.sql` vs `014_consolidated_schema.sql` split for production vs. clean-environment setup. A `rollback/` subdirectory contains `_down.sql` files for several migrations; an `archive/` subdirectory holds superseded originals. Read `MIGRATION_CONFLICTS.md` before touching any migration numbered below 014.

**Sprint 27 additions**: 4 new migrations, all date-prefixed (continuing the convention `20260613_notifications.sql` started): `20260723_notification_preferences_expansion.sql` (Phase 4), `20260724_user_digests.sql` (Phase 5), `20260725_notification_analytics.sql` (Phase 11), `20260726_notification_performance_indexes.sql` (Phase 13) — the last of these adds two composite indexes on `notification_logs`; see `docs/SPRINT27_PHASE13_PERFORMANCE.md` for exactly which query shapes they target and why single-column indexes weren't enough.

**Sprint 29 addition**: `069_premium_subscriptions.sql` (+
`rollback/069_down.sql`), numbered sequentially continuing the
`001`–`068` convention (not date-prefixed like the Sprint 27 batch above)
since it sits in the same numeric sequence as the migration immediately
before it (`068`). See `docs/PREMIUM_ARCHITECTURE.md` for the six tables
it adds.

**Sprint 30 addition**: `070_scenario_simulator_premium.sql` (+
`rollback/070_down.sql`), continuing the same sequential convention
`069` established. One new table (`saved_scenarios`) and one new
feature/plan_features row (`saved_scenarios_limit`) — see the Billing —
Sprint 30 addition section above.

**Sprint 31 additions**: `071_exchange_rates.sql` (Phase 6, new
`exchange_rates` table) and `072_shared_goal_currency_awareness.sql`
(Phase 9, `group_contributions.currency_code` + the rewritten
`get_shared_goal_detail()`), both continuing the sequential convention.
See the Multi-currency section above.


