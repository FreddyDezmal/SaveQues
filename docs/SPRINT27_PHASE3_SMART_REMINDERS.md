# Sprint 27 — Phase 3: Smart Reminder Engine

## 1. What this phase is

Sprint 27's brief asks for "intelligent reminders" that "never spam" and
replace generic nagging copy ("Save today!") with messages built from the
user's real numbers ("You're only R120 away from reaching Level 12").

This phase adds four new reminder types and upgrades two existing ones,
without building a second scheduler where the existing one already fits.

## 2. Architecture

```
lib/reminderEngine.ts   (NEW — pure, no DB/network access)
      │  goal selection, "should this fire" thresholds,
      │  adaptive copy generation
      ▼
lib/notifications.ts
      │
      ├─ sendStreakAtRisk()          (existing, copy upgraded)
      ├─ sendDailyQuestReminder()    (existing, copy upgraded — now
      │                               accepts optional smart context)
      ├─ sendGoalAlmostComplete()    (NEW)
      ├─ sendGoalDeadlineApproaching() (NEW)
      ├─ sendMissedWeeklyDeposit()   (NEW)
      ├─ sendGroupQuestEnding()      (NEW, private — called only by
      │                               its own scheduler below)
      │
      ├─ runDailyNotificationScheduler()   (existing — EXTENDED, not
      │   replaced. 3 new per-user checks added after the existing
      │   5; same timezone gating, same goal_reminders preference
      │   check, same batched-query discipline the file already uses)
      │
      └─ runGroupQuestEndingReminderScheduler()  (NEW — group-scoped,
          so it can't live in the per-user loop above. Mirrors
          runGroupWeeklySummaryScheduler()'s batching shape exactly.)
                │
                ▼
app/api/cron/notifications/route.ts
      — one new try/catch block, runs every invocation (not gated to
        Monday), same non-fatal pattern as every other piggybacked job

lib/types.notifications.ts   — NotificationType union +4
lib/notificationTaxonomy.ts  — exhaustive switch +4 (compiler-enforced)
lib/notificationIcons.tsx    — icon Record +4 (compiler-enforced)
tests/unit/reminderEngine.test.ts — 32 new unit tests, DB-free
```

## 3. Phase 1 audit findings relevant to this phase

Read in full before writing any code (per the sprint brief's Phase 1
requirement). Summary of what exists and was reused vs. what's genuinely
new:

| Existing asset | Reused by this phase |
|---|---|
| `runDailyNotificationScheduler()` — per-user timezone-aware daily loop, `shouldNotifyUserNow()` gating, `getPref()` preference lookup | Extended with 3 new checks (goal almost complete, deadline approaching, missed weekly deposit) instead of a new scheduler |
| `runGroupWeeklySummaryScheduler()` — batched group/member/log query shape | Copied exactly for the new `runGroupQuestEndingReminderScheduler()` |
| `notificationsGloballyEnabled()` | Reused as-is to gate `group_quest_ending`, same as `sendGroupInvite` etc. |
| `savings_goals` table (`target_amount`, `current_amount`, `target_date`, `is_primary`, `is_complete`, `is_active`) | Read directly — no schema change needed |
| `group_quests` table (`end_date`, `status`) | Read directly — no schema change needed |
| `getLevelFromXP()` (`lib/xp.ts`) | Powers the XP-to-next-level fallback in the adaptive daily-quest copy |
| `formatAmount()` (`lib/currency.ts`) | Used for every amount in the new copy |
| `getWeekStart()` / `getDaysRemainingInWeek()` (`lib/weeklyQuests.ts`) | Reused for the missed-weekly-deposit check |
| `lib/goalHealth.ts` / `lib/forecast.ts` "pure computation, separate from data access" pattern | Followed for the new `lib/reminderEngine.ts` |
| `notificationTaxonomy.ts` exhaustive switch / `notificationIcons.tsx` exhaustive Record | Extended — both fail the build if a case is missed, so this was compiler-checked, not just eyeballed |

**Redundant/rebuilt: nothing.** No existing notification table, helper,
scheduler, or cron route was replaced. `streak_at_risk` (streak-at-risk)
and `partner_reminder` (partner-inactive) already existed and were left
as separate types — only their copy quality changed where the brief
asked for it (streak).

**Deleted: nothing.**

## 4. New notification types

| Type | Scope | Fires from | Preference gate |
|---|---|---|---|
| `goal_almost_complete` | per-user | daily loop | `goal_reminders`, once per 14 days |
| `goal_deadline_approaching` | per-user | daily loop | `goal_reminders`, daily as deadline nears (≤3 days) |
| `missed_weekly_deposit` | per-user | daily loop | `goal_reminders`, ≤2 days left in week + R0 deposited |
| `group_quest_ending` | per-group | own scheduler | global `notifications_enabled` only (no dedicated preference category exists yet — see §6) |

## 5. Adaptive copy — the brief's headline ask

`buildSmartSavingsReminderCopy()` in `lib/reminderEngine.ts` replaces the
old always-generic "Daily quest waiting for you!" body with, in priority
order:

1. **Goal-remaining-amount** ("You're only R120 away from reaching
   'Emergency Fund'.") — used whenever the user has an active goal with
   a positive remaining balance. Most concrete and actionable, so it
   wins when available.
2. **XP-to-next-level** ("You're only 80 XP away from Level 12.") — used
   when there's no active goal but the user isn't maxed out.
3. **Generic fallback** — only when neither signal exists (no goals, max
   level). This is the *only* case where the old-style generic copy is
   still used, and it's now the fallback, not the default.

`buildStreakReminderCopy()` similarly folds the actual streak number
into the body ("One deposit today keeps your 34-day streak alive."),
matching the brief's own example almost verbatim — this was the
smallest gap between existing behavior and the ask.

## 6. Honesty notes — verified / recommended / future work / known limitations

**Verified** (by running the actual test suite in this sandbox, not by
inspection alone):
- `npx tsc --noEmit` — 0 new type errors. 2 pre-existing errors remain in
  `tests/unit/categoryIntelligence.test.ts` and
  `tests/unit/exportCenter.test.ts`, both unrelated to this phase and
  present before it started.
- `npx vitest run` (full suite) — 398 passed, 0 failed, 79 pre-existing
  `.todo()` placeholders (unchanged), 13 pre-existing skipped integration
  suites (unchanged — no live Supabase/push infra in this sandbox, same
  gap the file already documented before this phase).
- `tests/unit/reminderEngine.test.ts` — 32 new tests, all passing,
  covering goal math, threshold edges (exactly-90%, exactly-100%, past
  deadlines, zero/negative targets), primary-goal precedence, and every
  copy-generation fallback path including the max-level divide-by-zero
  guard.

**Recommended, not yet built:**
- A per-goal (not per-user) dedupe for `goal_almost_complete` once
  `notification_logs` gains a `goal_id` column — Phase 8/9 territory,
  not this phase.
- Surfacing `goal_reminders`-style dedicated preference categories for
  `group_quest_ending` specifically, rather than only the global switch
  — natural fit for Phase 4 (notification preferences expansion).

**Future work (explicitly out of scope for Phase 3):**
- Email/SMS delivery of these reminders — Phases 9/10 (provider
  abstractions) haven't been built yet; these four types currently only
  reach push + in-app inbox, same as every other existing type.
- Notification analytics (delivered/opened/clicked) for the new types —
  Phase 11 scope; they use the same `notification_logs` row shape as
  everything else, so analytics built in Phase 11 will cover them for
  free with no additional instrumentation needed here.

**Known limitations:**
- `goal_almost_complete` dedupe is per-user, not per-goal (see
  "Recommended" above) — a user with two goals both crossing 90% funded
  in the same 14-day window is only reminded about whichever one
  `pickNearestGoal()` selects.
- **"Subscription renewal" from the sprint brief has no implementation
  here.** SaveQuest has no billing/subscription/premium-tier concept
  anywhere in this codebase (confirmed by grep across the full
  repository during the Phase 1 audit) — building one to satisfy this
  bullet literally would mean fabricating a feature area unrelated to
  the actual product. Documented here rather than silently dropped or
  faked.
- `runGroupQuestEndingReminderScheduler()`'s same-day dedupe only guards
  against double-invocation of one cron run; it's expected (and, per the
  brief's own "adapt over time" framing, desired) to fire again on each
  of the up-to-2 days a quest is within its ending window — same
  daily-repeat precedent already established by `weekly_expiry` and
  `seasonal_expiry` in the existing daily scheduler.
