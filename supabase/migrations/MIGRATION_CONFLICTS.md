# SaveQuest Migration History — Conflict & Audit Log

Generated: 2026-06-14  
Auditor: Migration audit pass before 014 cleanup  
Status: **014_prod_cleanup.sql applied to production. 014_consolidated_schema.sql ready for clean environments.**

---

## Quick Reference

| File | Status | Notes |
|------|--------|-------|
| `001_initial_schema.sql` | ✅ Clean | Baseline schema |
| `002_quest_chains_daily_shields.sql` | ✅ Clean | Additive only |
| `003_global_readiness.sql` | ✅ Clean | Additive only |
| `004_primary_goal.sql` | ✅ Clean | Introduces `is_primary` / `is_active` on goals |
| `005_weekly_reflections.sql` | ⚠️ Orphan columns, doubled body | See below |
| `0061_User_Weekly_Quest_Tracking.sql` | ⚠️ Superseded by 0062 | Policy replaced |
| `0062_Weekly Quest State_…sql` | ⚠️ Duplicate columns, conflicting index | See below |
| `006_weekly_quests_transactions.sql` | ✅ Clean | Challenge time-bound fields |
| `0071_EventSystem.sql` | 🔴 Exact duplicate of 007 | Both idempotent, one redundant |
| `0072_Yikes.sql` | ⚠️ References non-existent view | DROP IF EXISTS saved it |
| `007_events.sql` | 🔴 Exact duplicate of 0071 | Both idempotent, one redundant |
| `008_admin_events_policy.sql` | ✅ Clean | Additive policies |
| `009_xp_awards.sql` | ✅ Clean | New table + function |
| `010_xp_security.sql` | ✅ Clean | Hardens 001 policy (intentional replacement) |
| `011_transaction_guards.sql` | ✅ Clean | Security functions |
| `012_streak_rpc.sql` | ✅ Clean | Additive RPC |
| `013_analytics_retention.sql` | ✅ Clean | New tables + functions |
| `20260613_notifications.sql` | ✅ Clean | Push notification system |
| `20260613_notifications_cron.sql` | ✅ Documentation only | Optional pg_cron snippet |
| `014_prod_cleanup.sql` | ✅ Drops 2 orphaned columns | Safe, data-preserving |
| `014_consolidated_schema.sql` | ✅ Clean-environment target | Do NOT run on production |

---

## Detailed Conflict Inventory

---

### CONFLICT 1 — `005_weekly_reflections.sql`: Doubled body + orphaned columns

**Severity:** Low (idempotent SQL, but misleading)

**What happened:**  
The entire file body was pasted twice end-to-end. Both `ALTER TABLE` blocks and both `DO $$ … $$` blocks execute identically. The `ADD COLUMN IF NOT EXISTS` guard makes it harmless in production.

**Orphaned columns introduced:**

| Column | Table | Default | App references | Verdict |
|--------|-------|---------|----------------|---------|
| `notification_enabled` | `profiles` | `TRUE` | **Zero** | Dropped by 014 |
| `reflection_day` | `profiles` | `'sunday'` | **Zero** | Dropped by 014 |

**Why dropped:**  
`notification_enabled` (no `s`) conflicts conceptually with `notifications_enabled` (with `s`) added by the notification system migration. Having both in the schema is a trap for future developers. `reflection_day` was part of a planned weekly reflection feature that was never implemented beyond the table creation in 004.

**Resolution:** `014_prod_cleanup.sql` drops both columns with `DROP COLUMN IF EXISTS`.

---

### CONFLICT 2 — `0062` re-adds columns already added by `004`

**Severity:** Low (all guarded by `IF NOT EXISTS`)

**Columns duplicated:**

| Column | Table | First added | Re-added by |
|--------|-------|-------------|-------------|
| `is_primary` | `savings_goals` | `004_primary_goal.sql` | `0062_Weekly Quest State_…sql` |
| `goal_status` | `savings_goals` | — | `0062` only (not a duplicate) |
| `completed_at` | `savings_goals` | — | `0062` only (not a duplicate) |
| `currency_code` | `profiles` | `004_primary_goal.sql` | `0062`, `0071`, `007` |
| `locale` | `profiles` | `004_primary_goal.sql` | `0062` |
| `country_code` | `profiles` | `004_primary_goal.sql` | `0062`, `0071`, `007` |

**Why not a production problem:**  
`ADD COLUMN IF NOT EXISTS` is used throughout. The column is created once (by whichever migration runs first) and silently skipped by all subsequent attempts.

**Resolution:** No production action needed. `014_consolidated_schema.sql` defines each column exactly once.

---

### CONFLICT 3 — `one_primary_goal_per_user` index: conflicting predicates

**Severity:** Medium (silent predicate mismatch between environments)

**004 creates:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_goal_per_user
  ON public.savings_goals (user_id)
  WHERE is_primary = TRUE AND is_active = TRUE AND is_complete = FALSE;
```

**0062 attempts:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_goal_per_user
  ON public.savings_goals (user_id)
  WHERE is_primary = TRUE AND goal_status = 'active';
```

**What actually happened in production:**  
Lexicographic sort order: `004_` < `0062_`. So `004` ran first, created the index. When `0062` ran, `CREATE UNIQUE INDEX IF NOT EXISTS` saw the name already existed and **silently skipped** — it does NOT check whether the predicate matches.

**Live predicate in production:**
```sql
WHERE is_primary = TRUE AND is_active = TRUE AND is_complete = FALSE
```

**Impact:**  
The `update_goal_amount()` trigger (from 0062) sets `goal_status = 'completed'` but the live index uses `is_complete = FALSE` as its exclusion condition, not `goal_status`. This is internally consistent since the trigger also sets `is_complete = TRUE`. However, a fresh environment running both migrations would end up with the **same** 004 predicate (IF NOT EXISTS skips 0062 again), so behaviour is consistent across environments.

**Verify live predicate:**
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'savings_goals'
  AND indexname = 'one_primary_goal_per_user';
```

**Resolution:** `014_consolidated_schema.sql` uses the 004 predicate exclusively (the live one). No production change needed.

---

### CONFLICT 4 — `0071_EventSystem.sql` and `007_events.sql`: exact duplicates

**Severity:** Low (both use `IF NOT EXISTS`), Cosmetic

**What happened:**  
Both files are byte-for-byte identical. They create the same three tables (`events`, `event_regions`, `user_event_participation`), the same five indexes, and the same three policies.

**Run order** (lexicographic):  
`0071_` sorts before `007_`, so `0071` runs first, creates everything. `007` runs second, all statements are skipped by `IF NOT EXISTS`.

**Why both exist:**  
Likely a rename accident — `0071_EventSystem.sql` was the working name, then it was renamed to `007_events.sql` following the 3-digit convention, but the original was never deleted.

**Resolution:** No production action needed. When archiving legacy migrations, keep `007_events.sql` (the canonical name) and note `0071` as the duplicate.

---

### CONFLICT 5 — `0072_Yikes.sql`: references view that was never created

**Severity:** Low (saved by `DROP IF EXISTS`)

**What happened:**
```sql
DROP VIEW IF EXISTS public.completed_goals_summary;  -- safe, view didn't exist yet
CREATE OR REPLACE VIEW public.completed_goals_summary AS ...
```

The `DROP IF EXISTS` no-ops when the view doesn't exist, then `CREATE OR REPLACE` creates it fresh. This worked but only by accident — if the `DROP` had been `DROP VIEW` (without `IF EXISTS`) it would have failed on a clean database.

**Dependency note:**  
The view references `savings_goals.goal_status` and `savings_goals.is_active`, which are added in `0062` and `004` respectively. `0072` therefore has an implicit dependency on those migrations having run first. In production this was satisfied by run order. In `014_consolidated_schema.sql` the view is defined after all tables, making the dependency explicit.

**The name `0072_Yikes.sql`:**  
Presumably named during a debugging session. Worth renaming when archiving.

**Resolution:** No production action needed. `014_consolidated_schema.sql` creates the view correctly after its dependencies.

---

### CONFLICT 6 — Naming inconsistency in the 006–007 range

**Severity:** Cosmetic, but causes confusing sort order

**Actual lexicographic run order:**
```
001_initial_schema.sql
002_quest_chains_daily_shields.sql
003_global_readiness.sql
004_primary_goal.sql
005_weekly_reflections.sql
006_weekly_quests_transactions.sql          ← 3-digit: runs BEFORE 0061
0061_User_Weekly_Quest_Tracking.sql
0062_Weekly Quest State_…sql               ← spaces and & in filename
007_events.sql                              ← 3-digit: runs AFTER 0072 !
0071_EventSystem.sql
0072_Yikes.sql
008_admin_events_policy.sql
009_xp_awards.sql
010_xp_security.sql
011_transaction_guards.sql
012_streak_rpc.sql
013_analytics_retention.sql
```

**Problem:** `007_events.sql` sorts AFTER `0072_Yikes.sql` because `'0' < '0'` is equal, then `'0' < '7'` — wait, `007` vs `0071`: comparing char by char, `0`,`0`,`7` vs `0`,`0`,`7`,`1` — `007` is a prefix of `0071` so `007_` < `0071_`. Correct order. But `007_` vs `0072_`: `007_` < `0072_` because `_` (ASCII 95) < `2` (ASCII 50)... actually `_` is ASCII 95, `2` is ASCII 50, so `_` > `2`, meaning `007_` sorts **after** `0072_`.

**Verified run order for the 007x range:**
```
006_…   (before 0061 — '6' < '0' is false; '0' < '6' so 006 < 0061) ✓
0061_…
0062_…
0071_…
0072_…
007_…   ← sorts LAST in this group because '_' > '2' > '1'
008_…
```

This means `007_events.sql` (the duplicate of 0071) actually runs **after** `0072_Yikes.sql`, not before it as intended. In practice this is harmless because everything is `IF NOT EXISTS`, but it's confusing.

**Resolution:** Documented here. When archiving, rename to use a consistent timestamp or 3-digit prefix scheme.

---

### CONFLICT 7 — `profiles.country_code` added four times

**Severity:** None (all `IF NOT EXISTS`)

Added by: `004_primary_goal.sql`, `0062_…sql`, `0071_EventSystem.sql`, `007_events.sql`.

All four use `ADD COLUMN IF NOT EXISTS`. Column is created once, skipped three times.

---

## Columns Dropped by `014_prod_cleanup.sql`

| Column | Table | Added by | Reason for drop |
|--------|-------|----------|-----------------|
| `notification_enabled` | `profiles` | 005 | Never read by any app code; conflicts with `notifications_enabled` |
| `reflection_day` | `profiles` | 005 | Feature never implemented; no app references |

---

## Semi-Orphaned Columns (kept intentionally)

| Column | Table | Written by | Read by | Decision |
|--------|-------|-----------|---------|----------|
| `goal_status` | `savings_goals` | `update_goal_amount()` trigger | Nobody in app | **Keep** — dropping requires rewriting the trigger; low risk leaving it |
| `is_primary` | `savings_goals` | App inserts | Nobody yet | **Keep** — backed by unique index; reserved for future primary-goal feature |
| `is_active` | `savings_goals` | App inserts | `completed_goals_summary` view | **Keep** — actively used by view |

---

## Index Predicate Reference

| Index | Table | Live predicate (production) | Defined by |
|-------|-------|-----------------------------|------------|
| `one_primary_goal_per_user` | `savings_goals` | `WHERE is_primary = TRUE AND is_active = TRUE AND is_complete = FALSE` | `004_primary_goal.sql` |

The `0062` attempt to redefine this index with `goal_status = 'active'` was silently skipped because `CREATE UNIQUE INDEX IF NOT EXISTS` checks name existence only, not predicate equality.

---

## Functions — Version History

| Function | Versions | Current version from |
|----------|----------|---------------------|
| `handle_new_user()` | 1 | `001_initial_schema.sql` |
| `update_goal_amount()` | 2 (v2 replaces v1) | `0062_Weekly Quest State_…sql` |
| `log_activity()` | 1 | `002_quest_chains_daily_shields.sql` |
| `record_app_open()` | 1 | `003_global_readiness.sql` |
| `award_xp()` | 1 | `009_xp_awards.sql` |
| `complete_daily_quest()` | 1 | `011_transaction_guards.sql` |
| `complete_weekly_quest()` | 1 | `011_transaction_guards.sql` |
| `complete_chain_step()` | 1 | `011_transaction_guards.sql` |
| `complete_event()` | 1 | `011_transaction_guards.sql` |
| `award_achievement()` | 1 | `011_transaction_guards.sql` |
| `update_streak()` | 1 | `012_streak_rpc.sql` |
| `upsert_daily_activity()` | 1 | `013_analytics_retention.sql` |
| `update_engagement_status()` | 1 | `013_analytics_retention.sql` |
| `trg_refresh_engagement_status()` | 1 | `013_analytics_retention.sql` |

All functions use `CREATE OR REPLACE`, so re-running any migration is safe.

---

## How to Use `014_consolidated_schema.sql`

For a brand-new Supabase project or local dev reset:

```bash
# Reset local DB and apply consolidated schema only
supabase db reset --local
psql $DATABASE_URL -f supabase/migrations/014_consolidated_schema.sql
```

Do **not** run `014_consolidated_schema.sql` against the live production database.  
The production database has all legacy migrations already applied; only `014_prod_cleanup.sql` should be run there.

---

## Archiving Plan (pending after clean-environment test)

Once a clean-environment test confirms `014_consolidated_schema.sql` produces a working app:

1. Move `001` through `013` plus `0061`, `0062`, `0071`, `0072` into `supabase/migrations/archive/`
2. Add a `supabase/migrations/archive/README.md` noting: "These migrations have been applied to production. They are preserved for audit history. New environments should use `014_consolidated_schema.sql` instead."
3. Keep `014_prod_cleanup.sql` in the live migrations folder as a record of the production-applied cleanup.
4. Rename `0072_Yikes.sql` → `archive/0072_completed_goals_view.sql` when archiving.

---

## Verification Queries

Run these in Supabase SQL Editor to confirm production state matches this audit:

```sql
-- 1. Confirm orphaned columns are gone
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name IN ('notification_enabled', 'reflection_day');
-- Expected: 0 rows

-- 2. Confirm notifications_enabled (with 's') still exists
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name = 'notifications_enabled';
-- Expected: 1 row, boolean

-- 3. Confirm live index predicate
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'savings_goals' AND indexname = 'one_primary_goal_per_user';
-- Expected: WHERE is_primary = true AND is_active = true AND is_complete = false

-- 4. Confirm all 19 expected tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
-- Expected: activity_log, analytics_daily_activity, challenges, daily_quest_logs,
--   event_regions, events, notification_logs, profiles, push_subscriptions,
--   quest_chain_progress, savings_goals, transactions, user_achievements,
--   user_challenges, user_engagement_status, user_event_participation,
--   user_weekly_quests, weekly_reflections, xp_awards

-- 5. Confirm completed_goals_summary view exists
SELECT viewname FROM pg_views WHERE schemaname = 'public' AND viewname = 'completed_goals_summary';
-- Expected: 1 row
```
