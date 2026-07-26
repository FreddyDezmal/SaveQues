# Sprint 27 — Phase 13: Performance

## 1. What this phase is

"Audit: Indexes, Cleanup jobs, Scheduler efficiency, Queue throughput,
Batch delivery, Memory, Duplicate work, Retry logic."

Two of these eight (Duplicate work, Retry logic) were already the
primary subject of Phase 8. Rather than re-litigate them, this phase
cross-references what Phase 8 already established and focuses new
audit effort on the six areas Phase 8 didn't cover: indexes, cleanup
jobs, the remaining scheduler N+1, queue throughput, batch delivery, and
memory.

## 2. Indexes — audited, two composite indexes added

`notification_logs` already had seven single-column indexes (`user_id`,
`sent_at`, `notification_type`, `read_at`, `archived_at`, `deleted_at`,
`dismissed_at`, `converted_at` — accumulated across five migrations).
Single-column indexes only partially serve a MULTI-column filter:
Postgres can use one as an index scan and then filters the rest in
memory. Two real query shapes, hit repeatedly, get purpose-built
composite indexes this phase:

1. **`notification_logs_dedup_idx (notification_type, sent_at, user_id)`**
   — the exact shape Phase 8's `getRecentlyNotifiedUserIds()` uses,
   called from **six** places (weekly/monthly/group-weekly summary
   dedup, `goal_almost_complete` dedup, `group_quest_ending` dedup).
   This is the single most-repeated query pattern in the whole
   notification system.
2. **`notification_logs_inbox_idx (user_id, sent_at DESC) WHERE
   deleted_at IS NULL`** — the Notification Center's own list query.
   This is **user-facing latency**, not just background cron efficiency
   — arguably the most latency-sensitive query in this entire system,
   since it runs every time anyone opens their notification bell. A
   partial index (excluding the minority soft-deleted rows) keeps it
   smaller and faster than an unconditional index would be.

## 3. Cleanup jobs — a real, previously-nonexistent gap, now fixed

**Before this phase: zero retention policy existed for either
`notification_logs` or `push_subscriptions`.** Every notification ever
sent, to every user, stayed in the table forever. Every deactivated push
subscription stayed forever too. However well the indexes above are
designed, an unboundedly growing table degrades every query against it
over time, and it's pure wasted storage past a point.

New `runNotificationLogsCleanupScheduler()`, gated to run weekly
(Sundays), does three independent purges (separate try/catch per
operation — one failing must not skip the others):

1. Soft-deleted `notification_logs` rows (a user explicitly deleted
   them) — kept 30 days as a grace period, then hard-deleted.
2. Every `notification_logs` row regardless of state — kept 180 days,
   generous for Phase 11's analytics dashboards, bounding total growth.
3. Deactivated `push_subscriptions` (permanent delivery failures,
   410/404 "gone") — kept 90 days after their last update, then purged.

**A second real bug found while building #3**: `deactivateSubscription()`
set `is_active = false` but never touched `updated_at` — and there's no
database trigger anywhere that auto-maintains that column for this
table (confirmed by auditing every migration touching
`push_subscriptions`). That meant `updated_at` never actually reflected
*when* a subscription went inactive — it silently held whatever value it
last had for some unrelated reason (or `created_at`, if never updated).
The retention purge above would have used a meaningless timestamp.
**Fixed** — `deactivateSubscription()` now explicitly sets
`updated_at = now()`, so the new cleanup logic (and any future
"how long has this been stale" query) actually works.

## 4. Scheduler efficiency — the N+1 Phase 8 flagged for follow-up, fixed

Phase 8's own doc flagged one remaining gap explicitly: *"the
`daily_quest_logs` check per-user in the loop already does one query per
active user regardless of send."* This phase fixed it.

**Why it couldn't just reuse Phase 3's batching pattern directly**:
Phase 3 batches goals/deposits for the whole `usersToProcess` set in one
query each, because those checks share one global boundary. "Did this
user complete today's quest" is genuinely per-user — "today" depends on
each user's own timezone via `todayInTZ()`.

**The fix**: group users by their own local "today" value first (bounded
by the number of distinct timezones actually represented in a given
run, not one query per user), then one batched query per group. The
grouping logic was extracted as `groupUserIdsByLocalToday()` — a pure
function, specifically so it has real unit test coverage without
mocking Supabase (4 new tests), rather than left as untested inline
scheduler code.

## 5. Queue throughput — architecture reasoning, cross-referenced from Phase 8/10

No job/queue infrastructure exists anywhere in this codebase (confirmed
during Phase 1's original audit, reconfirmed here). "Throughput" in this
architecture means: how many users can `runDailyNotificationScheduler()`
process in one HTTP request before hitting this app's serverless
function timeout. Phase 8 already addressed the two things that matter
most for this — idempotent per-user claims (safe to resume, safe to run
concurrently) and per-user failure isolation (one bad row doesn't abort
the run). This phase's addition (§4) reduces the query count per user
in the hot loop, which is the other lever available for raising
effective throughput within a single request without a queue. Building
an actual durable queue (persist notification jobs, process them via a
worker separate from the request/response cycle) remains real future
work — flagged, not built, consistent with how Phase 8 and Phase 10
already flagged the same kind of "no queue exists" gap.

## 6. Batch delivery — verified as an architectural constraint, not a fixable gap

Checked whether push sends could be batched into fewer requests to the
underlying push services. **They can't, structurally**: Web Push,
Firebase, OneSignal, Expo, and APNs (Phase 10's five adapters) all
require one request per recipient — each Web Push subscription has its
own per-subscription encryption keys (RFC 8291), and even the
providers with a nominal "send to multiple tokens" API still address
each recipient individually under the hood. This isn't a gap this phase
left unfixed; it's a verified constraint of how push delivery works,
worth stating explicitly rather than silently not mentioning it and
leaving a reader to wonder whether it was overlooked.

## 7. Memory — a real gap, fixed

`app/api/admin/notifications/route.ts` (extended in Phase 11) selected
`notification_logs`' entire contents — every column this phase's
analytics module reads, for every row, with no limit — into memory on
every single request. Phase 11's own doc flagged this explicitly as
*"fine at this app's current scale, a real scaling concern once the
table grows large enough that Phase 13 would need to revisit it."* This
is that revisit.

**Fixed**: the route now defaults to a 90-day window (`.gte("sent_at",
...)`), accepts an optional `?days=` override capped at 365, and returns
the effective `windowDays` in its response so a caller always knows what
window it's looking at rather than silently guessing. 90 days is
generous for the admin dashboard's only current use case (recent
trends) while keeping the row count and response payload bounded
regardless of how large the underlying table gets — which, thanks to
§3's new cleanup job, is now bounded anyway, but the route shouldn't
depend on that alone.

## 8. Duplicate work / Retry logic — cross-referenced from Phase 8, not re-litigated

Both already addressed thoroughly in Phase 8: the atomic per-user claim
(closing a real race condition), the shared `getRecentlyNotifiedUserIds()`
dedup helper (now used in eight places counting this phase's own
reuse of the same pattern for cleanup-adjacent logic), the previously-
broken partner-reminder cooldown (a real bug fixed there), and bounded
push-send retries (`sendWebPushWithRetry`, one retry, transient
failures only). Nothing new found in these two areas this phase beyond
confirming Phase 8's fixes are still in place and unmodified.

## 9. Verified / recommended / future work / known limitations

**Verified** (actually run in this sandbox):
- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors from before Phase 3 remain. Caught and fixed one real
  bug of my own mid-phase: an initial draft of the `groupUserIdsByLocalToday`
  inline loop used direct `for...of` Map iteration, which this codebase's
  TS target doesn't support without `downlevelIteration` — the
  typecheck caught it immediately; fixed by matching the
  `Array.from(map.entries())` pattern already used two lines below in
  the same function.
- `npx vitest run` (full suite) — 478 passed, 0 failed (up from 474
  before this phase — the +4 are `groupUserIdsByLocalToday`'s new test
  suite in `tests/unit/notifications.test.ts`).
- Confirmed via full migration-history audit that no trigger anywhere
  auto-maintains `push_subscriptions.updated_at`, backing §3's bug
  finding.

**Recommended, not yet built:**
- A durable job queue for notification delivery, replacing the
  once-daily single-request scheduler model — the real, larger-scope
  answer to "queue throughput" that this phase's scope (auditing and
  fixing the current architecture) deliberately didn't attempt.
- Applying the same 90-day-default-with-override pattern (§7) to any
  other admin/reporting endpoint that might grow an unbounded query over
  time, if any are added later.

**Future work (explicitly out of scope for Phase 13):**
- Read replicas / connection pooling tuning — this app's current scale
  doesn't warrant it, and it's an infrastructure decision outside this
  codebase's scope, not a code-level fix.
- Compressing/archiving (rather than deleting) `notification_logs` rows
  past the hard retention window, for longer-term analytics history
  than 180 days without keeping the live table large — a reasonable
  middle ground between "keep everything forever" and "delete it," not
  built here.

**Known limitations:**
- The new cleanup scheduler's three purges run sequentially within one
  function invocation — at very large scale, a single `DELETE` matching
  many rows could itself take a while; this phase didn't add batching/
  chunking to the deletes themselves (e.g. `DELETE ... LIMIT N` in a
  loop), which would be the natural next step if the deleted-row counts
  ever get large enough for a single statement to be slow.
- §5's "throughput" improvement is a query-count reduction within the
  existing single-request model, not a fundamental architecture change
  — the real ceiling (how many users one serverless function invocation
  can process before timing out) is unchanged until a queue exists.
