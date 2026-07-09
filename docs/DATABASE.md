# SaveQuest — Database

Postgres via Supabase. 28 tables, 50 RLS policies, 33 migration files as of Sprint 18.

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

| Table | Purpose |
|---|---|
| `notification_logs` | Every push send. Extended in Sprint 16 with `read_at`, doubling as the Notification Center's data source. |
| `notification_preferences` | Sprint 16. One row per user, six category booleans (`achievements`, `goal_reminders`, `streak_reminders`, `weekly_summaries`, `milestone_celebrations`, `product_announcements`). |
| `push_subscriptions` | Web Push subscription objects, keyed by user + endpoint. |

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

One documented residual gap (Sprint 16): RLS policies can't restrict *which columns* an `UPDATE` touches — `notification_logs`'s update policy allows updating the row, and it's the **application code** (`app/api/notifications/mark-read/route.ts`), not the database, that guarantees only `read_at` is ever written. A follow-up trigger rejecting changes to `title`/`body`/`sent_at`/`notification_type` would close this properly; not yet built.

## Migrations

**A note on naming, found during the Sprint 18 audit and worth stating plainly rather than re-presenting as a fresh discovery**: migration files use three different naming conventions across the project's history — sequential numbers (`001_initial_schema.sql` … `017_...`), dated files (`20260613_notifications.sql`, `20260707_notification_preferences.sql`), and a few unprefixed files (`admin_read_policies.sql`). This is **already documented and audited** in `supabase/migrations/MIGRATION_CONFLICTS.md`, which predates this sprint and explains which early migrations were superseded (e.g. `0061_...` superseded by `0062_...`) and the `014_prod_cleanup.sql` vs `014_consolidated_schema.sql` split for production vs. clean-environment setup. A `rollback/` subdirectory contains `_down.sql` files for several migrations; an `archive/` subdirectory holds superseded originals. Read `MIGRATION_CONFLICTS.md` before touching any migration numbered below 014.

**Sprint 18 addition**: none — this sprint added no new migration, extending existing `notification_logs`/`notification_preferences` tables from Sprint 16/17 as-is.
