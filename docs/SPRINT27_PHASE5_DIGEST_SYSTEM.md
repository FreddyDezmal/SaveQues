# Sprint 27 — Phase 5: Digest System

## 1. What this phase is

Build digest generation: daily/weekly/monthly, with the weekly example
(saved amount, quests completed, XP, level, streak, closest goal +
amount needed) and monthly example (savings graph, XP graph, quest
progress, achievements, best/worst week, momentum score) given explicitly
in the brief.

## 2. What already existed (re-confirmed for this phase)

| Requirement | Status before this phase |
|---|---|
| Weekly recap notification | Already existed — `runWeeklySummaryScheduler()`/`sendWeeklySummary()`, Monday-gated, but only ever sent "you saved $X this week" — a single number, none of the brief's other weekly fields. |
| Momentum score | Already existed — `lib/momentum.ts`, a 14-day recency-weighted algorithm, used elsewhere in the app (`MomentumHeatmap.tsx`). **Reused as-is, not reinvented** — see §4. |
| Week-start date grouping | Already existed — `getUTCWeekStartString()` in `lib/dateUtils.ts`. **Reused.** |
| Achievement catalog (id → title/icon) | Already existed — `lib/achievements.ts`'s `ACHIEVEMENTS` array. **Reused.** |
| Closest-goal selection | Already existed — `pickNearestGoal()`/goal-remaining math in `lib/reminderEngine.ts` (Phase 3). **Reused**, not a third goal-selection implementation. |
| `monthly_summaries` preference category | Already existed but **not live** — added in Phase 4, no sender existed. This phase is what makes it live. |
| Charting library | **Does not exist anywhere in this codebase** — confirmed by dependency and component audit. See §5. |

## 3. What this phase adds

### 3a. `user_digests` table (new)

A digest is a persisted snapshot, not a notification event — kept
separate from `notification_logs`. Two reasons, both in the migration's
own comment: (1) a digest should show what was true when generated, not
silently drift if underlying data changes later; (2) it avoids
re-running the same aggregation queries every time someone reopens an
old digest. RLS: read-only for the owning user; only the service-role
scheduler writes to it.

### 3b. `lib/digest.ts` (new, pure)

Same separation-of-concerns pattern as `lib/reminderEngine.ts`:
`groupDailyIntoWeeks()`, `findBestAndWorstWeek()`,
`buildWeeklyDigestPushCopy()`, `buildMonthlyDigestPushCopy()` — no DB
access, fully unit tested (10 tests: week-boundary grouping, best/worst
tie-breaking with 0/1/N weeks, copy content).

### 3c. Weekly digest — upgraded in place, not rebuilt

`runWeeklySummaryScheduler()` / `sendWeeklySummary()` still exist under
the same names, same Monday gate, same "piggyback the daily cron, no new
Vercel Cron slot" reasoning as before. What changed: it now assembles a
full `WeeklyDigestData` (quests completed via `daily_quest_logs`, XP via
`activity_log`, level via the already-existing `getLevelFromXP()`,
streak via `profiles.streak_days`, closest goal via Phase 3's
`pickNearestGoal()`), persists it, and the push deep-links to
`/digest/[id]` instead of `/dashboard`. The push body itself stays a
short highlight — the full breakdown lives on that page.

### 3d. Monthly digest — new

`runMonthlyDigestScheduler()`, gated to the 1st of the calendar month in
`app/api/cron/notifications/route.ts` (same gating-in-the-caller
convention the Monday jobs already use). Computes:
- **Savings graph** — deposits bucketed by day (`dailySavings`)
- **XP graph** — `activity_log` rows for the month (`dailyXP`)
- **Quest progress** — `daily_quest_logs` count for the month
- **Achievements** — `user_achievements` earned in the month, mapped
  through the existing `ACHIEVEMENTS` catalog
- **Best/worst week** — `groupDailyIntoWeeks()` + `findBestAndWorstWeek()`
  applied to the month's `dailySavings`
- **Momentum score** — `getMomentumState()` from `lib/momentum.ts`,
  called with the last 14 days of `activity_log` (NOT the calendar
  month — see §4 for why)

New `monthly_summary` notification type, wired through
`types.notifications.ts`, `notificationTaxonomy.ts`,
`notificationIcons.tsx`, and `canSendNotificationToUser` — this is what
makes Phase 4's `monthly_summaries` preference category live.

### 3e. `/digest/[id]` page (new)

Server page (`app/(app)/digest/[id]/page.tsx`) fetches the row directly
via Supabase with an explicit `user_id` filter on top of the table's own
RLS policy — same pattern `app/(app)/goals/[id]/page.tsx` already uses,
not a new API-route convention. `DigestClient.tsx` renders a weekly or
monthly view depending on `digest_type`: stat cards, a streak/closest-
goal card for weekly; stat cards, a momentum badge, two bar-series
graphs, best/worst week cards, and an achievements grid for monthly.

`lib/notificationActions.ts` gained `"View recap"` as the primary-action
label for both `weekly_summary` and `monthly_summary` — previously
`weekly_summary` had no specific label because it only ever pointed at
`/dashboard`; now that it points at a specific page, the label follows.

## 4. Reuse over rebuild — the specific decisions

- **Momentum score is NOT recomputed for the digest.** `lib/momentum.ts`
  already has a carefully-tuned 14-day recency-weighted algorithm, shown
  elsewhere in the app (`MomentumHeatmap.tsx`). Building a second,
  differently-scoped (calendar-month) momentum calculation for the
  digest would give users two numbers that sound like the same concept
  but disagree. The monthly digest's momentum is the exact same 14-day
  rolling figure shown everywhere else in the app — included for
  continuity, deliberately not month-scoped.
- **No new charting library.** Confirmed by dependency + component audit
  that no chart library (recharts, chart.js, etc.) exists anywhere in
  this codebase — `MomentumHeatmap.tsx` renders its own heatmap with
  plain styled `<div>`s. The digest's savings/XP graphs follow that same
  hand-rolled-bars convention rather than adding a new dependency for
  one page.
- **No new API route for the digest detail page.** `goals/[id]/page.tsx`
  already established "server component fetches directly via Supabase
  with RLS + an explicit ownership filter, passes props to a client
  component" as this app's convention for single-record detail pages.
  Followed exactly, rather than introducing a parallel `/api/digests/[id]`
  convention alongside it.

## 5. Honest scope: "Daily" digest was not built

The brief lists "Daily" alongside "Weekly" and "Monthly" for digest
generation, but gives no content example for what a daily digest would
contain — unlike weekly and monthly, which came with concrete field
lists. Two things kept this deliberately out of scope this phase rather
than fabricated:

1. **What would it even bundle?** A "daily digest" implies collecting a
   day's worth of otherwise-immediate notifications (achievement
   unlocks, partner requests, friend accepts, etc.) into one delivery.
   That's a genuine architectural change — batching event-triggered
   sends instead of firing them the moment they happen — not a content-
   assembly problem like weekly/monthly are. Phase 3's smart reminders
   already cover the "what should today's single push say" need for
   scheduled content.
2. **Phase 4 already flagged this precisely.** The `digest_frequency`
   preference's "daily"/"hourly"/"weekly" options were documented in
   Phase 4 as persisted-but-not-enforced, specifically because batching
   generation was "Phase 5 scope." This phase built weekly and monthly
   generation (matching the brief's own concrete examples) but did not
   build the batching engine that would make `digest_frequency: "daily"`
   or `"hourly"` actually change delivery — that remains accurately
   described as not-yet-built, not silently claimed as done.

If a literal daily digest (not the same thing as `digest_frequency`
batching) is wanted next, the natural shape — following this phase's own
pattern — would be a `WeeklyDigestData`-like `DailyDigestData` in
`lib/digest.ts`, a `runDailyDigestScheduler()` folded into the existing
daily loop, and a `daily_summaries` preference category. Not built here;
flagged as the clear next step instead of guessed at.

## 6. Verified / recommended / future work / known limitations

**Verified** (actually run in this sandbox):
- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing errors
  from before Phase 3 remain, untouched.
- `npx vitest run` (full suite) — 416 passed, 0 failed (up from 406
  before this phase — the +10 are `tests/unit/digest.test.ts`). Caught
  and fixed one real regression during this phase: adding "View recap"
  action labels broke an existing `notificationActions.test.ts`
  assertion that `weekly_summary`'s label was `null` — updated the test
  to match the new, intentional behavior rather than reverting the
  feature or leaving the suite red.
- 79 pre-existing `.todo()` placeholders and 13 pre-existing skipped
  integration suites, both unchanged.

**Recommended, not yet built:**
- A literal daily digest (see §5).
- Batching engine for `digest_frequency: "hourly"/"daily"/"weekly"`
  (Phase 4's own documented gap — still open).

**Future work (explicitly out of scope for Phase 5):**
- Email delivery of digests — Phase 9 (email provider architecture)
  hasn't been built; digests currently only reach push + the in-app
  `/digest/[id]` page, same channel limitation every other notification
  type in this app currently has.
- A digest history / archive list view (currently a digest is only
  reachable via the notification that announced it — there's no
  "browse past digests" page). Small, natural follow-up given
  `user_digests` already stores everything needed for one.

**Known limitations:**
- Monthly digest's per-user queries are not batched across the whole
  user base the way Phase 3's `runDailyNotificationScheduler()` batches
  goals/deposits — this scheduler runs once a month for actively-
  notifying users, at a much smaller scale and frequency than the daily
  loop, so the existing per-user-loop style (same shape
  `runWeeklySummaryScheduler()` already had before this phase) was kept
  rather than introducing a heavier batching rewrite for a monthly job.
- `bestWeek`/`worstWeek` can legitimately be the same week when a month
  has fewer than 2 distinct weeks of savings activity — not a bug,
  documented in `findBestAndWorstWeek()`'s own comment and tested.
