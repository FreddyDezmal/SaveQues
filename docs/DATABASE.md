# SaveQuest — Database

Postgres via Supabase. 28 tables, 50 RLS policies as of Sprint 18, plus `user_digests` (Sprint 27 Phase 5) since. 57 migration files as of Sprint 27.

## Core tables

| Table | Purpose |
|---|---|
| `profiles` | One row per user. Currency preference (`currency_code`, default `ZAR`), notification settings, XP total, streak state. |
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

## Migrations

**A note on naming, found during the Sprint 18 audit and worth stating plainly rather than re-presenting as a fresh discovery**: migration files use three different naming conventions across the project's history — sequential numbers (`001_initial_schema.sql` … `017_...`), dated files (`20260613_notifications.sql`, `20260707_notification_preferences.sql`), and a few unprefixed files (`admin_read_policies.sql`). This is **already documented and audited** in `supabase/migrations/MIGRATION_CONFLICTS.md`, which predates this sprint and explains which early migrations were superseded (e.g. `0061_...` superseded by `0062_...`) and the `014_prod_cleanup.sql` vs `014_consolidated_schema.sql` split for production vs. clean-environment setup. A `rollback/` subdirectory contains `_down.sql` files for several migrations; an `archive/` subdirectory holds superseded originals. Read `MIGRATION_CONFLICTS.md` before touching any migration numbered below 014.

**Sprint 27 additions**: 4 new migrations, all date-prefixed (continuing the convention `20260613_notifications.sql` started): `20260723_notification_preferences_expansion.sql` (Phase 4), `20260724_user_digests.sql` (Phase 5), `20260725_notification_analytics.sql` (Phase 11), `20260726_notification_performance_indexes.sql` (Phase 13) — the last of these adds two composite indexes on `notification_logs`; see `docs/SPRINT27_PHASE13_PERFORMANCE.md` for exactly which query shapes they target and why single-column indexes weren't enough.
