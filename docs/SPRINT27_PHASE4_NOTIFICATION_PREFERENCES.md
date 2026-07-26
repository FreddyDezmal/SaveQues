# Sprint 27 — Phase 4: Notification Preferences

## 1. What this phase is

The brief asks to expand notification preferences to cover: a master
toggle, channel toggles (push/email/in-app/SMS-future), nine categories,
quiet hours, vacation mode, and delivery frequency. This phase extends
the existing `notification_preferences` table (Sprint 16) and its API
route/UI rather than replacing any of it.

## 2. What already existed (Phase 1 audit, re-confirmed for this phase)

| Requirement | Status before this phase |
|---|---|
| Master toggle | Already existed — `profiles.notifications_enabled`, surfaced in `components/notifications/NotificationSettings.tsx` on the main Settings page. **Not rebuilt.** |
| Push channel | Already existed — the same component's subscribe/unsubscribe flow. **Not rebuilt.** |
| 6 categories (achievements, goal_reminders, streak_reminders, weekly_summaries, milestone_celebrations, product_announcements) | Already existed — `notification_preferences` table, `/api/notifications/preferences`, `NotificationPreferencesClient.tsx`. **Extended, not rebuilt.** |

## 3. What this phase adds

### 3a. New categories

| Category | Live? | Gates |
|---|---|---|
| `groups` | **Yes** | `sendGroupInvite`, `sendGoalInvitation`, `sendGroupQuestEnding` (Phase 3) |
| `partners` | **Yes** | `sendPartnerRequest`, `sendPartnerAccepted`, `sendPartnerNudge`, `sendPartnerReminder` |
| `monthly_summaries` | No | Phase 5 (Digest System) scope — column persisted now, sender doesn't exist yet |
| `xp` | No | No notification type exists for a bare XP gain distinct from `achievement_unlocked` — nothing to gate |
| `referrals` | No | No referral feature exists anywhere in this codebase (confirmed by full-repo grep) — nothing to gate |
| "Marketing" | N/A | This is the **existing** `product_announcements` column, relabeled in the UI only. Not a new column. |

`group_quest_completed` and `group_weekly_summary` already existed and
already reused `milestone_celebrations` / `weekly_summaries` — left as-is
rather than moved onto the new `groups` column, so a toggle a user may
have already set doesn't silently start controlling something else.

`friend_request` / `friend_accepted` deliberately remain gated by the
global switch only — "Social/Friends" isn't one of the categories this
phase's brief lists, so no category was invented for it.

### 3b. Quiet hours — live

`quiet_hours_enabled` / `quiet_hours_start` / `quiet_hours_end` (0-23,
handles the overnight wrap, e.g. 22 → 7). Enforced in
`runDailyNotificationScheduler()`: if the user's current local hour falls
in their window, the entire batch of scheduled checks (streak, quest,
weekly/seasonal expiry, and the three new Phase 3 goal/deposit reminders)
is skipped for that day.

**Documented limitation:** only covers the once-daily scheduled batch, not
event-triggered sends (achievement unlocks, partner requests, friend
accepts, etc.) — those fire the instant something happens rather than
from this batch. The UI says so explicitly rather than implying full
coverage.

### 3c. Vacation mode — live

`vacation_mode` (+ optional `vacation_until` date, auto-expiring). Enforced
in a single choke point — `sendToUser()`, the function every notification
path in `lib/notifications.ts` already funnels through — rather than
patched into ~20 individual senders/schedulers. This guarantees complete
coverage (scheduled and event-triggered) with no risk of a future sender
forgetting to check it.

**Documented limitation:** the expiry check compares UTC dates, not the
user's local timezone, so a vacation ending on a specific date may resume
delivery up to ~12 hours off local midnight for users far from UTC.

### 3d. Digest frequency — persisted, not yet enforced (except "Immediate")

`digest_frequency` (`immediate` | `hourly` | `daily` | `weekly`) is a real,
persisted, validated column and a real `<select>` in the UI. Only
`immediate` (today's existing behavior) actually changes anything.

**Why not more:** this app's cron runs at most once daily (Vercel Hobby
tier — see `runDailyNotificationScheduler`'s own docstring), so `hourly`
cannot be honestly enforced without different infra. Turning many
individual events into one bundled digest delivery is explicitly Sprint 27
**Phase 5**'s job (`Build digest generation`), not built yet. Rather than
silently drop notifications for anyone who picks a non-immediate option
(which would be worse than not offering the choice), the UI states plainly
that non-immediate choices are saved but don't change delivery yet — same
"Coming soon" pattern already used for `xp`/`referrals`/`monthly_summaries`.

### 3e. Channels — push/in-app already existed; SMS deliberately not added

Push and in-app already existed as implicit channels (every notification
gets both an in-app log and, if subscribed, a push). No new toggle was
needed for either.

**SMS was deliberately NOT added as a column or a real toggle.** Unlike
`product_announcements`/`xp`/`referrals` (categories with at least a
plausible future home), there is no SMS provider, no SMS stub, and no SMS
phase anywhere in this 17-phase sprint's plan (Phase 9 covers email
providers, Phase 10 covers push providers — neither mentions SMS). Adding
a persisted `sms_enabled` column with zero design work behind it anywhere
in the roadmap would be closer to fabricating a feature than documenting a
gap. Instead, the brief's "SMS (future)" is acknowledged here in the
documentation, not built as dead UI state.

## 4. Architecture

```
supabase/migrations/20260723_notification_preferences_expansion.sql
      — ADD COLUMN IF NOT EXISTS ×11, two CHECK constraints, no RLS changes
        needed (existing "own row" policies already cover new columns)

app/api/notifications/preferences/route.ts
      — CATEGORIES tuple extended 6 → 11
      — PATCH whitelists + validates the 6 new non-boolean fields
        individually (quiet hours ints 0-23, vacation_until YYYY-MM-DD,
        digest_frequency enum) — same "never trust a client-shaped object
        into .update()" discipline the route already had

lib/reminderEngine.ts
      — isWithinQuietHours() and isVacationActive() — pure, unit-tested,
        same separation-of-concerns pattern Phase 3 established

lib/notifications.ts
      — sendToUser() now checks isUserOnVacation() first — single choke
        point for full vacation-mode coverage
      — runDailyNotificationScheduler() batch-fetches quiet-hours fields
        alongside the existing goal_reminders/streak_reminders prefs;
        isUserInQuietHours() gates the whole per-user scheduled batch
      — canSendNotificationToUser()'s category union extended with
        "groups" | "partners"
      — sendPartnerRequest/Accepted/Nudge/Reminder now gate on "partners"
        (previously global-switch-only)
      — sendGroupInvite, sendGoalInvitation, sendGroupQuestEnding (Phase 3)
        now gate on "groups" (previously global-switch-only)

app/(app)/settings/notifications/NotificationPreferencesClient.tsx
      — 11 category rows (was 6) + three new sections: quiet hours,
        vacation mode, digest frequency
      — handleToggle() generalized to handleUpdate(patch) so the new
        non-boolean controls (hour selects, date input, frequency select)
        share the same optimistic-update/revert-on-failure code path
        instead of a second near-duplicate handler

lib/hourOptions.ts (NEW)
      — HOUR_OPTIONS extracted from NotificationSettings.tsx's inline
        HOURS constant so the new quiet-hours picker doesn't duplicate it;
        NotificationSettings.tsx now imports the same shared constant

tests/unit/reminderEngine.test.ts — +8 tests for the two new pure helpers
e2e/settings.spec.ts — updated the stale "Coming soon" count assertion
```

## 5. Verified / recommended / future work / known limitations

**Verified** (actually run in this sandbox):
- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors from before this phase (`categoryIntelligence.test.ts`,
  `exportCenter.test.ts`) remain, untouched by this work.
- `npx vitest run` (full suite) — 406 passed, 0 failed (up from 398 before
  this phase — the +8 are the new quiet-hours/vacation-mode unit tests).
  79 pre-existing `.todo()` placeholders and 13 pre-existing skipped
  integration suites, both unchanged.
- `tests/unit/reminderEngine.test.ts` — 40 tests total (32 from Phase 3 +
  8 new), covering the overnight quiet-hours wrap, the zero-width-window
  edge case, and vacation mode's indefinite-vs-dated-expiry behavior.

**Recommended, not yet built:**
- Applying quiet hours to event-triggered sends too (achievement unlocks,
  partner requests, etc.), which would need a per-send-time check at each
  of those ~15 call sites rather than the one check this phase added.
- Per-timezone vacation-mode expiry (currently UTC-date-based).

**Future work (explicitly out of scope for Phase 4):**
- Digest batching/generation — Phase 5.
- Email/SMS channels — Phases 9/10 (email architecture), and SMS has no
  phase in this sprint's plan at all (see §3e).
- Actual XP-notification and referral-notification send paths, which
  would make the `xp`/`referrals` categories live.

**Known limitations:**
- Quiet hours only covers the once-daily scheduled batch (§3b).
- Vacation-mode expiry is UTC-date-based, not per-user-timezone (§3c).
- Digest frequency only enforces "Immediate" today (§3d).
- No SMS column exists (§3e) — a deliberate choice, not an oversight.
