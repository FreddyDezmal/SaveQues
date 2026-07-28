# PERFORMANCE_AUDIT.md — Sprint 27 (Notification & Communication System)

Final-phase audit. Consolidates Phase 13's dedicated performance pass
and adds one significant finding this final pass caught that Phase 13's
own N+1 audit missed — stated plainly, the same way Sprint 22's
performance audit named what its incremental work had missed too.

## Findings

### 1. FIXED (this phase, final pass) — a real N+1 hiding inside a function call, not visible at the loop

**The bug**: `canSendNotificationToUser()` does two Supabase queries
internally (`profiles.notifications_enabled`, then the specific
`notification_preferences` column). Re-auditing every call site of this
function for this phase's final pass found it was being called **once
per user, inside a loop**, in three places:

| Scheduler | Loop bound | Impact |
|---|---|---|
| `runWeeklySummaryScheduler` | every notifications-enabled user in the app | Largest — this app's entire active user base, every Monday |
| `runMonthlyDigestScheduler` | same | Same, monthly |
| `runGroupQuestEndingReminderScheduler` | members of groups with an ending quest | Smaller, bounded by group size |

Phase 8's and Phase 13's own dedicated N+1 audits both missed this,
because the two queries are hidden *inside* `canSendNotificationToUser()`
— nothing about the call site itself (`await canSendNotificationToUser(userId, "weekly_summaries")`)
looks like a database query the way the previously-fixed
`daily_quest_logs` per-user `.from(...).select(...)` call obviously did.

**Fix**: `getUsersAllowedCategory(userIds, category)` — batches both
underlying queries once for the whole set of user IDs, returns a `Set`
for O(1) membership checks inside the loop. Wired into all three call
sites. 6 new tests
(`tests/unit/getUsersAllowedCategory.test.ts`, using the Phase 15
Supabase-mocking pattern) verify the batched logic matches
`canSendNotificationToUser()`'s own documented defaults exactly
(no-preferences-row → allowed; global switch off → excluded regardless
of category value).

**Why this matters more than the daily_quest_logs fix (Phase 13)**: that
fix was bounded by however many users were *already* being processed in
one timezone-hour bucket. This one was unconditionally hitting **every**
notifications-enabled user in the weekly/monthly schedulers, every
single run — the largest-blast-radius N+1 found in this entire sprint.

### 2. Indexes (Phase 13, reconfirmed) — two composite indexes added

`notification_logs` had seven single-column indexes but no composite
ones for its two hottest real query shapes:
- `notification_logs_dedup_idx (notification_type, sent_at, user_id)` —
  the shape `getRecentlyNotifiedUserIds()` uses, called from six places.
- `notification_logs_inbox_idx (user_id, sent_at DESC) WHERE deleted_at
  IS NULL` — the Notification Center's own list query. **User-facing
  latency**, not just background cron efficiency — runs every time
  anyone opens their notification bell.

### 3. Cleanup jobs (Phase 13, reconfirmed) — a real, previously-nonexistent gap

Zero retention policy existed for `notification_logs` or
`push_subscriptions` before Sprint 27 — both grew unboundedly.
`runNotificationLogsCleanupScheduler` (weekly) now purges soft-deleted
rows after 30 days, all rows after 180 days, and stale deactivated
subscriptions after 90 days — three independent, isolated purges (one
failing doesn't block the others). A second real bug was found while
building this: `deactivateSubscription()` never touched `updated_at`,
and no DB trigger auto-maintains it, so the timestamp meant to answer
"how long has this been inactive" was meaningless until fixed alongside
the cleanup job.

### 4. Scheduler efficiency (Phase 13, reconfirmed) — the daily_quest_logs N+1

Fixed by grouping users by their own local "today" (timezone-dependent,
can't be a single global batch) before one query per distinct date
group instead of one query per user. Extracted as a pure, tested
function (`groupUserIdsByLocalToday`).

### 5. Memory (Phase 13, reconfirmed) — unbounded admin analytics query

`/api/admin/notifications` selected `notification_logs`' entire
contents with no limit on every request. Fixed with a 90-day default
window (`?days=` override, capped at 365).

### 6. Queue throughput / Batch delivery — verified architectural constraints, not fixable gaps

No job queue exists anywhere in this codebase. Push delivery
structurally cannot be batched into fewer requests — Web Push, FCM,
OneSignal, Expo, and APNs all require one request per recipient (each
Web Push subscription has its own encryption keys per RFC 8291; even
providers with a nominal multi-token API address each recipient
individually under the hood). Stated explicitly rather than left
unmentioned, so it isn't mistaken for an overlooked gap.

### 7. Duplicate work / Retry logic — cross-referenced from Phase 8

Phase 8 already addressed both thoroughly: the atomic per-user daily
claim (closing a real concurrent-invocation race), the shared
`getRecentlyNotifiedUserIds()` dedup helper (now used in **seven**
places after this phase, up from six), a real previously-broken
partner-reminder cooldown bug (filtered on a `created_at` column that
never existed on `notification_logs`) found and fixed, and bounded push
retries (`sendWebPushWithRetry`, one retry, transient failures only).

## Verified (actually run in this sandbox)

- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors from before Phase 3 remain.
- `npx vitest run` (full suite) — 495 passed, 85 todo, 0 failed as of
  this phase (up from 489/85 before this final pass — the +6 are
  `getUsersAllowedCategory.test.ts`).
- Re-audited **every** call site of `canSendNotificationToUser()` across
  `lib/notifications.ts` specifically for this final pass (not just the
  ones already known from earlier phases) — this is what caught
  finding #1.
- Confirmed all three fixed call sites (`runWeeklySummaryScheduler`,
  `runMonthlyDigestScheduler`, `runGroupQuestEndingReminderScheduler`)
  compile and the full suite stays green after the change.

## Recommended (not yet built)

- Applying the same "audit every call site of a function with hidden DB
  queries" method to other frequently-called internal helpers in
  `lib/notifications.ts`, as a standing practice rather than a one-time
  pass — this finding's own lesson is that N+1s can hide behind an
  innocuous-looking function call, not just an obviously-inline query.
- A durable job queue, replacing the once-daily single-request
  scheduler model — the real, larger-scope answer to "queue
  throughput" beyond what auditing-and-fixing the current architecture
  can achieve.
- Chunking the cleanup scheduler's deletes (`DELETE ... LIMIT N` in a
  loop) if the row counts involved ever grow large enough for a single
  statement to be slow.

## Future work (out of scope)

- Read replicas / connection pooling tuning — infrastructure decisions
  outside this codebase's scope.
- Compressing/archiving (rather than deleting) rows past the hard
  retention window, for longer-term analytics history.

## Known limitations

- The new batched preference check (#1) still issues 2 queries total
  (not 1) per scheduler run — profiles and notification_preferences are
  separate tables with no join available through the Supabase client
  the way a raw SQL join would allow. Two queries regardless of user
  count is still an enormous improvement over 2×N, and further
  collapsing to one query would need a database view or RPC function,
  judged out of scope for this pass.
- Cleanup scheduler purges run sequentially within one function
  invocation, not chunked — fine at current scale, a real
  consideration if the deleted-row counts grow very large (see
  Recommended).
