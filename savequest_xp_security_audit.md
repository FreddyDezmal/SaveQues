# SaveQuest — XP Pipeline Security Audit

**Scope:** Full audit of every XP-awarding code path  
**Status:** Pre-implementation findings. No changes made.

---

## 1. Complete XP Award Map

| # | Source Action | Entry Point | Function / Route | XP Awarded | DB Tables Written |
|---|---|---|---|---|---|
| 1 | `LOG_SAVING` (deposit) | `GoalDetailClient` → server | `POST /api/transactions` | `50 × streak_multiplier` | `transactions`, `profiles.xp_total`, `activity_log` |
| 2 | `GOAL_COMPLETE` (deposit path) | `GoalDetailClient` → server | `POST /api/transactions` | `1000 × streak_multiplier` | `transactions`, `profiles.xp_total`, `activity_log` |
| 3 | `GOAL_COMPLETE` (purchase path) | `GoalDetailClient` → **client-side Supabase SDK** | Direct DB call (no API route) | `1000 × streak_multiplier` | `profiles.xp_total`, `activity_log` |
| 4 | `DAILY_QUEST_COMPLETE` | `QuestsClient` → **client-side Supabase SDK** | Direct DB call (no API route) | `75 × streak_multiplier` | `daily_quest_logs`, `profiles.xp_total`, `activity_log` |
| 5 | Weekly quest complete | `QuestsClient` → **client-side Supabase SDK** | Direct DB call (no API route) | Quest-defined XP (300–600) | `user_weekly_quests`, `profiles.xp_total`, `activity_log` |
| 6 | Seasonal/challenge complete | `QuestsClient` → **client-side Supabase SDK** | Direct DB call (no API route) | Challenge XP (200–800) | `user_challenges`, `profiles.xp_total`, `activity_log` |
| 7 | Quest chain step claim | `QuestChainsClient` → **client-side Supabase SDK** | Direct DB call (no API route) | Step XP + optional chain bonus | `quest_chain_progress`, `profiles.xp_total`, `activity_log` |
| 8 | Event complete | `EventCard` → **client-side Supabase SDK** | Direct DB call (no API route) | `event.xp_reward` (DB-defined) | `user_event_participation`, `profiles.xp_total`, `activity_log` |
| 9 | Achievement unlock (side-effect) | Multiple client components | Inline in each handler | Achievement `xpReward` (25–20000) | `user_achievements`, `profiles.xp_total` |
| 10 | **`/api/xp` (generic action)** | Any authenticated HTTP client | `POST /api/xp` | Any `XPAction` value × streak_multiplier | `profiles.xp_total` only |
| 11 | Streak milestone XP | `lib/xp.ts` constants (`STREAK_7`, `STREAK_21`, etc.) | Referenced only — **no awarding code found to call these** | 300–5000 | *(not wired to any handler)* |
| 12 | Goal milestone XP (25/50/75%) | `lib/xp.ts` constants | Defined but **never awarded** | 150–350 | *(dead code)* |

---

## 2. Root Cause Findings

---

### FINDING 1 — `/api/xp` Has Zero Idempotency Protection
**Severity: CRITICAL**

`app/api/xp/route.ts` accepts any `XPAction` string from the request body and immediately awards XP. There is:

- No record of what actions have been previously awarded
- No cooldown, timestamp check, or uniqueness constraint
- No validation that the action is contextually valid for the user's current state
- No transaction log entry (no insert to `activity_log` or any audit table)

An authenticated user can call `POST /api/xp` with `{ "action": "GOAL_COMPLETE" }` in a loop and accumulate unlimited XP. Because `GOAL_COMPLETE` carries a `1000 × streak_multiplier` value, a user at a 66-day streak would earn **3,000 XP per request**. There is no server-side rate limit, no middleware throttle, and no database constraint preventing this.

**Exact file:** `app/api/xp/route.ts`

---

### FINDING 2 — All Quest/Event/Chain XP Is Awarded Client-Side
**Severity: CRITICAL**

The following actions bypass all API routes and write directly to Supabase from the browser:

- Daily quest completion (`QuestsClient.tsx`)
- Weekly quest completion (`QuestsClient.tsx`)
- Seasonal/challenge completion (`QuestsClient.tsx`)
- Quest chain step claims (`QuestChainsClient.tsx`)
- Event completion (`EventCard.tsx`)
- Goal purchase completion (`GoalDetailClient.tsx`)

Each of these calls `createClient()` (the browser Supabase client) and then directly executes `supabase.from("profiles").update({ xp_total: ... })`. This means any user with DevTools open can intercept or replay the Supabase REST call with arbitrary `xp_total` values, since the RLS policy (`Users can update own profile`) only checks `auth.uid() = id` — it does not validate the *content* of the update.

RLS confirms ownership but not value integrity. A user can update their own `xp_total` to any integer they choose.

**Exact files:**
- `app/(app)/quests/QuestsClient.tsx`
- `app/(app)/chains/QuestChainsClient.tsx`
- `components/events/EventCard.tsx`
- `app/(app)/goals/[id]/GoalDetailClient.tsx` (purchase path, lines 139–143)

---

### FINDING 3 — Daily Quest Has a Soft Uniqueness Guard That Doesn't Protect XP
**Severity: HIGH**

The daily quest `upsert` at `QuestsClient.tsx:96` uses `onConflict: "user_id,quest_date"` on `daily_quest_logs`. This correctly prevents a second log row. However, the XP update to `profiles` happens in a separate, subsequent statement with no transactional atomicity and no idempotency check. The sequence is:

1. `upsert` into `daily_quest_logs` (deduped by constraint)
2. `select` current `xp_total` from `profiles`
3. `update profiles set xp_total = xp_total + xp`

If two concurrent requests arrive between steps 2 and 3 (classic read-modify-write race), both will read the same base `xp_total` and each will write `base + xp`, awarding XP only once in the database — but step 1's `upsert` silently succeeds for both, so the second request still reaches step 3. The actual race window is narrow on a single user, but the lack of atomicity is structural.

More critically: the `daily_quest_logs` constraint guards the *log*, not the `profiles.xp_total` increment. A client that skips the log insert and calls only the `profiles.update` step has no guard at all.

**Exact file:** `app/(app)/quests/QuestsClient.tsx`

---

### FINDING 4 — Achievement XP Has a Three-Write Race Condition
**Severity: HIGH**

In `app/api/transactions/route.ts` (and replicated in all client-side handlers), achievement XP is awarded with this non-atomic sequence:

1. Compute `newXP = profile.xp_total + xpGained`
2. `update profiles set xp_total = newXP`
3. If achievements: `update profiles set xp_total = newXP + achievementXP`

Step 3 uses the `newXP` value captured at step 1, not a fresh read. If any other concurrent operation modifies `xp_total` between steps 2 and 3 (another tab, another action), the concurrent write is silently overwritten. Any XP earned in that window is lost (lost-update problem) or, conversely, if the writes interleave differently, XP could be double-counted.

This pattern appears identically in:
- `app/api/transactions/route.ts` (lines 82–88)
- `app/(app)/quests/QuestsClient.tsx` (lines 104–132, 181–206, 241–268)
- `app/(app)/chains/QuestChainsClient.tsx` (lines 54–58)

**Exact files:** All four listed above.

---

### FINDING 5 — Event Completion Has No Server-Side Verification
**Severity: HIGH**

`EventCard.tsx:handleComplete` marks an event as completed and awards XP entirely from the browser. There is no server check that:

- The event was actually in `active` status before the update (a second `handleComplete` call can fire before `setLocalStatus("completed")` propagates)
- The event is still within its `available_until` window at time of completion
- The `xp_reward` value used for the `profiles.update` matches what the database actually has for that event (the client reads `event.xp_reward` from a prop, which could be stale)

The `user_event_participation` table has a `UNIQUE (user_id, event_slug)` constraint, which prevents a second *join*. But the `update` to `status = "completed"` and the `profiles.update` for XP are two separate unconstrained writes that can both succeed on a replay.

**Exact file:** `components/events/EventCard.tsx`

---

### FINDING 6 — `/api/transactions` Does Not Verify Goal Ownership Before Writing
**Severity: HIGH**

`POST /api/transactions` receives a `goal_id` in the request body. It inserts the transaction immediately (line 19–26), and only *afterwards* fetches the goal to check data (line 35). There is no pre-insert query of `savings_goals` that verifies `goal_id` belongs to `user.id`.

The RLS on `transactions` (`Users can CRUD own transactions`) only ensures `user_id = auth.uid()` on the transaction row itself. The `update_goal_amount` DB trigger runs `SECURITY DEFINER` and updates whichever `savings_goals.id = NEW.goal_id`, bypassing RLS on `savings_goals`. A user can therefore deposit into another user's goal, inflating their `current_amount` and potentially triggering fraudulent goal-completion XP.

**Exact files:**
- `app/api/transactions/route.ts`
- `supabase/migrations/001_initial_schema.sql` (trigger `update_goal_amount` — SECURITY DEFINER, no ownership check)
- `supabase/migrations/0062_...sql` (updated trigger version — same flaw)

---

### FINDING 7 — `profiles.xp_total` Is Directly Writable by Any Authenticated User via RLS
**Severity: HIGH**

The RLS update policy on `profiles` is:

```sql
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE USING (auth.uid() = id);
```

This is a blanket `UPDATE` permission with no column-level restriction. Any authenticated user can set `xp_total`, `streak_days`, `is_admin`, `daily_quests_completed`, or any other column to any value using the Supabase client directly — no API route needed. This is the root enabler of Findings 2 and 3.

**Exact file:** `supabase/migrations/001_initial_schema.sql`

---

### FINDING 8 — Streak Multiplier Is Trusted From the Database Without Freshness Check
**Severity: MEDIUM**

Both `/api/xp` and `/api/transactions` read `profile.streak_days` from `profiles` and pass it to `getXPForAction()` to compute the multiplier. The streak value itself is updated client-side via `log_activity` RPC (which updates `activity_log` and `last_active_date`, but does not re-read `streak_days`). The `streak_days` column on `profiles` is also directly user-writable via Finding 7. A user who sets `streak_days = 66` gets a permanent 3× multiplier on all XP actions.

**Exact files:** `app/api/xp/route.ts`, `app/api/transactions/route.ts`, `lib/xp.ts`

---

### FINDING 9 — Weekly Quest Completion Has No Status Guard
**Severity: MEDIUM**

`completeWeeklyQuest()` in `QuestsClient.tsx` begins with a UI guard (`if (!weeklyAccepted || weeklyDone || loading) return`), but that guard lives in client state — not in the database operation. The `update` to `user_weekly_quests` uses `.eq("user_id", userId).eq("week_start", currentWeekStart)` with no `.eq("status", "active")` filter. Two concurrent requests from the same user (two browser tabs, or a network retry) can both pass the UI guard simultaneously and both execute the full XP award sequence before either sets `weeklyDone = true`.

**Exact file:** `app/(app)/quests/QuestsClient.tsx`

---

### FINDING 10 — Achievement Unlock Is Not Idempotent Under Concurrency
**Severity: MEDIUM**

`checkAchievements()` returns achievements the user hasn't earned yet by comparing against `earnedIds` fetched at query time. If two concurrent requests both fetch `earnedIds` before either inserts into `user_achievements`, both will see the same "not yet earned" set and both will attempt to insert the same achievement rows. The `UNIQUE (user_id, achievement_id)` constraint will cause one insert to fail silently (`ON CONFLICT DO NOTHING` is not specified — this will throw a 409 and return a 500 from the route), but the XP from the second attempt has already been applied to `profiles` in step 2.

**Exact files:** `app/api/transactions/route.ts`, `app/(app)/quests/QuestsClient.tsx`, `app/(app)/chains/QuestChainsClient.tsx`

---

### FINDING 11 — `is_admin` Flag Is Stored in the User-Writable `profiles` Table
**Severity: MEDIUM**

The admin privilege check in `app/api/admin/events/route.ts` reads `is_admin` from `profiles`. Since `profiles` is writable by the user themselves (Finding 7), any user can set `is_admin = true` on their own profile and gain access to admin event creation, modification, and deletion endpoints. The `service client` used in admin routes bypasses RLS entirely, so admin actions are high-value targets.

**Exact files:** `app/api/admin/events/route.ts`, `supabase/migrations/002_quest_chains_daily_shields.sql`

---

### FINDING 12 — Streak Milestone and Goal Milestone XP Are Dead Code
**Severity: LOW (integrity risk)**

`lib/xp.ts` defines XP values for `STREAK_7`, `STREAK_21`, `STREAK_30`, `STREAK_66`, `STREAK_100`, `GOAL_MILESTONE_25`, `GOAL_MILESTONE_50`, and `GOAL_MILESTONE_75`. None of these are called from any handler in the codebase. The milestone XP is never awarded. This is a functional gap rather than a security flaw, but its absence may confuse future developers into adding an insecure award path to fill the gap.

---

## 3. Severity Ranking

| Rank | Finding | Severity | Impact |
|---|---|---|---|
| 1 | Finding 1 — `/api/xp` unlimited replay | **CRITICAL** | Unbounded XP inflation for any authenticated user |
| 2 | Finding 2 — All quest/event XP awarded client-side | **CRITICAL** | Any user can set their own `xp_total` to any value |
| 3 | Finding 7 — `profiles` is freely writable via RLS | **HIGH** | Root enabler; allows direct field manipulation |
| 4 | Finding 6 — No goal ownership check before tx insert | **HIGH** | Cross-user goal manipulation, fraudulent GOAL_COMPLETE XP |
| 5 | Finding 11 — `is_admin` stored in user-writable table | **HIGH** | Privilege escalation to admin event management |
| 6 | Finding 5 — Event completion unverified server-side | **HIGH** | Replay of event XP; stale `xp_reward` trust |
| 7 | Finding 3 — Daily quest XP not transactionally guarded | **HIGH** | Race-condition double-award of daily XP |
| 8 | Finding 4 — Achievement XP three-write race | **HIGH** | Lost-update or double-award of achievement XP |
| 9 | Finding 9 — Weekly quest no status guard in DB | **MEDIUM** | Concurrent-tab double-award |
| 10 | Finding 8 — `streak_days` user-writable, used in multiplier | **MEDIUM** | Permanent 3× multiplier for any user |
| 11 | Finding 10 — Achievement insert not idempotent | **MEDIUM** | Concurrent insert can 500 after XP already written |
| 12 | Finding 12 — Milestone XP dead code | **LOW** | Functional gap / future footgun |

---

## 4. Files Requiring Modification

| File | Reason |
|---|---|
| `app/api/xp/route.ts` | Complete rewrite — add action context, idempotency table, remove generic endpoint |
| `app/api/transactions/route.ts` | Add goal ownership check before insert; fix non-atomic XP + achievement writes |
| `app/(app)/quests/QuestsClient.tsx` | Move all XP writes to server API routes; remove direct Supabase profile updates |
| `app/(app)/chains/QuestChainsClient.tsx` | Move all XP writes to server API routes |
| `components/events/EventCard.tsx` | Move completion to a server API route; remove direct profile update |
| `app/(app)/goals/[id]/GoalDetailClient.tsx` | Remove client-side XP award for purchase path (line 139–143) |
| `app/api/admin/events/route.ts` | Move `is_admin` check to a Supabase JWT custom claim or a separate privileged table |
| `supabase/migrations/001_initial_schema.sql` (new migration) | Restrict `profiles` UPDATE policy to non-sensitive columns; add column-level security or use a restricted function |
| `supabase/migrations/` (new migration) | Add `xp_awards` idempotency table with `(user_id, action_type, context_id)` unique constraint; add `streak_days` update function; add goal ownership check to trigger |
| `lib/xp.ts` | Remove or mark `STREAK_*` and `GOAL_MILESTONE_*` dead constants with clear `TODO` if intentionally deferred |

---

## 5. Recommended Production Architecture

### Core Principle
**XP must never be computed or written by the client.** Every XP award must flow through a server route or a Postgres function, and every award must be recorded in an append-only audit log that is the source of truth for `xp_total`.

---

### A. Replace `profiles.xp_total` With a Computed Column

Instead of a mutable `xp_total` integer, compute `xp_total` as `SUM(xp_awards.amount) WHERE user_id = ?`. This makes the award log the single source of truth and eliminates all direct-write attack surfaces on `xp_total`. A Postgres materialized view or a generated column can keep this performant.

---

### B. Create an `xp_awards` Idempotency Table

```sql
CREATE TABLE xp_awards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(id),
  action_type  TEXT NOT NULL,        -- 'DAILY_QUEST_COMPLETE', 'GOAL_COMPLETE', etc.
  context_id   TEXT NOT NULL,        -- date for daily, goal_id for goal, event_slug, etc.
  xp_amount    INTEGER NOT NULL,
  awarded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, action_type, context_id)  -- the idempotency key
);
```

Every XP award is an INSERT into this table. The unique constraint on `(user_id, action_type, context_id)` makes every award exactly-once by nature — a duplicate `INSERT` raises a constraint violation that the server catches and treats as "already awarded." No lock needed.

---

### C. Centralise All XP Writes in Postgres Functions (SECURITY DEFINER)

Replace direct `profiles.update` calls with Postgres functions that own the full award logic:

- `award_daily_quest_xp(p_user_id, p_quest_date, p_quest_id)` — verifies no prior award for that `(user_id, 'DAILY_QUEST_COMPLETE', quest_date)`, inserts into `xp_awards`, returns granted amount or 0 if duplicate
- `award_event_xp(p_user_id, p_event_slug)` — verifies event is still active, verifies user has an `active` participation row, awards once
- `award_goal_xp(p_user_id, p_goal_id)` — verifies goal ownership, verifies `is_complete = TRUE`, awards once
- `award_achievement_xp(p_user_id, p_achievement_id)` — wrapped in `ON CONFLICT DO NOTHING` on `user_achievements`

All functions run `SECURITY DEFINER` and are called from API routes or DB triggers — never from the client.

---

### D. Remove or Lock Down `/api/xp`

The generic `/api/xp` endpoint should be deleted entirely. Every XP-granting action should have its own dedicated, context-aware server route or DB function. If a generic internal endpoint is needed for admin tooling, it must require an admin JWT claim (not a user-table flag) and write to `xp_awards` with an audit reason string.

---

### E. Restrict `profiles` RLS to Non-Sensitive Columns

Use column-level security or split the table:

- A `profiles_public` table (display name, avatar, preferences) that users may update freely
- A `profiles_system` table (`xp_total`, `streak_days`, `is_admin`, `daily_quests_completed`) that has no user-facing UPDATE policy and is only modified by `SECURITY DEFINER` functions

Alternatively, apply a Postgres row-level policy with a `WITH CHECK` that prevents changes to sensitive columns by non-admin callers.

---

### F. Move `is_admin` to a JWT Custom Claim

The `is_admin` flag should be issued as a Supabase JWT custom claim at login time, not stored in a user-writable table. API routes check `session.user.app_metadata.is_admin`. This cannot be self-modified by users. The `profiles.is_admin` column can remain as a seed source for the claim but should not be the runtime authority.

---

### G. Add Goal Ownership Check to the DB Trigger

The `update_goal_amount` trigger should verify `NEW.user_id = (SELECT user_id FROM savings_goals WHERE id = NEW.goal_id)` and raise an exception if they differ. This defends at the database layer regardless of what the application layer does.

---

## 6. Recommended Implementation Order

Execute in this sequence to de-risk each phase before proceeding:

1. **Hotfix: disable or gate `/api/xp`** — Add a hardcoded block or require an internal service secret header immediately. This closes the most exploitable path with one line of code.

2. **Migration: create `xp_awards` table** — Add the idempotency table and the unique constraint. No application changes yet; this is additive.

3. **Migration: restrict `profiles` UPDATE policy** — Lock down the RLS policy to block direct writes to `xp_total`, `streak_days`, `is_admin`. This will break existing client-side flows intentionally — it forces the next steps.

4. **Server route: `/api/quest/daily/complete`** — First server-side replacement; validates date, calls `award_daily_quest_xp()` Postgres function, returns result. Update `QuestsClient` to call it.

5. **Server route: `/api/quest/weekly/complete`** and **`/api/quest/challenge/complete`** — Same pattern, adds `.eq("status", "active")` guard.

6. **Server route: `/api/events/complete`** — Validates event window server-side; calls `award_event_xp()`.

7. **Server route: `/api/chains/step/claim`** — Validates step eligibility server-side; calls step award function.

8. **Fix `GoalDetailClient` purchase path** — Remove client-side XP award (lines 139–143); the server-side trigger path via `/api/transactions` is the correct flow.

9. **Fix `/api/transactions` goal ownership check** — Add `SELECT id FROM savings_goals WHERE id = goal_id AND user_id = user.id` before the transaction insert.

10. **Fix achievement XP atomicity** — Replace the two-step `update + update` with a single `award_achievement_xp()` Postgres function that uses `INSERT INTO xp_awards ON CONFLICT DO NOTHING` and handles the `user_achievements` insert in the same transaction.

11. **Move `is_admin` to JWT custom claim** — Update Supabase auth hooks; update `requireAdmin()` in admin routes.

12. **Wire streak milestone and goal milestone XP** — Now that the award infrastructure is safe, implement `STREAK_*` and `GOAL_MILESTONE_*` awards through the `xp_awards` table with appropriate context IDs.

13. **Audit and load test** — Replay attack simulation against all new endpoints; verify `xp_awards` deduplication under concurrent load.

---

*End of audit. No code has been written or modified. Awaiting approval to proceed.*
