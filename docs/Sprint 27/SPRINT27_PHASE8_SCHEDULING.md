# Sprint 27 — Phase 8: Scheduling

## 1. What this phase is

"Audit every scheduled notification. Prevent duplicates. Guarantee
idempotency. Support retries. Handle failures gracefully. Ensure every
scheduler can restart safely."

This phase audited all six schedulers in `lib/notifications.ts` against
those five requirements, found two real bugs (one of them a genuine,
previously-shipped duplicate-prevention failure), and hardened every
scheduler that had a gap.

## 2. The audit

| Scheduler | Duplicate prevention (before) | Duplicate prevention (after) | Per-user failure isolation (before) | Per-user failure isolation (after) |
|---|---|---|---|---|
| `runDailyNotificationScheduler` | Per-user `last_notification_sent_date` check — but written **after** the send decision, unconditionally. Racy under concurrent invocation (see §3). | Atomic conditional claim — the UPDATE itself is the decision (see §3). | **None** — an exception for one user aborted the whole run. | Per-user `try/catch`; a failure logs, increments `errors`, and moves to the next user. |
| `runWeeklySummaryScheduler` | **None.** A double-invoked Monday cron would send every user two weekly recaps and create two `user_digests` rows. | Batch-checked against `notification_logs` for the rolling 7-day window before the loop; already-notified users are skipped. | None | Per-user `try/catch`. |
| `runMonthlyDigestScheduler` | **None.** Same gap as weekly, for the 1st-of-month cron. | Batch-checked against `notification_logs` for the current calendar month before the loop. | None | Per-user `try/catch`. |
| `runPartnerReminderScheduler` | **Present in code, but silently broken** — see §4. The dedup queries filtered on a column (`notification_logs.created_at`) that has never existed on that table. | Fixed: now uses the shared `getRecentlyNotifiedUserIds()` helper, which correctly filters on `sent_at`. | Per-partnership `try/catch` already existed (Sprint 22). | Unchanged — already correct. |
| `runGroupWeeklySummaryScheduler` | **None.** Same double-invocation gap as the personal weekly summary. | Batch-checked against `notification_logs` for the rolling 7-day window before the loop. | Per-member `try/catch` already existed. | Unchanged — already correct. |
| `runGroupQuestEndingReminderScheduler` (Phase 3) | Already had same-day dedup via an inline query. | Refactored onto the shared helper (no behavior change, just consolidation). | Per-member `try/catch` already existed. | Unchanged — already correct. |

## 3. Bug #1 (found and fixed): a real race condition in the daily scheduler

**Before this phase:** `markNotifiedToday(userId, date)` was an
unconditional `UPDATE profiles SET last_notification_sent_date = ...`,
called after `shouldNotifyUserNow()` had already decided — using data
read from a batch `SELECT` at the *top* of the run — that this user
should be notified.

**The race:** if the cron were ever invoked twice with any overlap (a
platform-level retry after a slow response, or two overlapping requests
from a misconfigured monitor — something Vercel Cron does not promise
can't happen), both invocations could read "not yet notified today" for
the same user before either had written back. Both would then proceed to
send. The write only ever happened *after* the decision; it was never
part of it.

**The fix:** `tryClaimDailyNotificationSlot()` replaces the unconditional
write with a conditional one — `UPDATE ... WHERE id = X AND
(last_notification_sent_date IS NULL OR last_notification_sent_date !=
today)`, checking the actual row count returned. Postgres's row-level
locking during the `UPDATE` serializes two concurrent attempts for the
same user: only one can possibly see itself update a row that still
needs updating. The other's `WHERE` clause matches nothing, and it
correctly treats "lost the claim" as "nothing to do this run," not an
error.

**Why idempotency-by-construction instead of a run-level lock:** an
alternative design would add a lock (e.g. a `cron_runs` table with a
unique constraint per day, acquired at the top of the route) to prevent
a second invocation from starting at all. This phase deliberately chose
per-row idempotent claims instead, because a lock can itself fail unsafe
— if the process holding it crashes or times out mid-run (a real
possibility for a function processing thousands of users), the lock
either has to be released with a timeout (adding its own complexity and
its own race) or stays stuck, blocking every future run until manually
cleared. An idempotent claim has no such failure mode: it's safe to run
concurrently, safe to run twice, and safe to crash mid-run and resume
later, all without any cleanup step.

## 4. Bug #2 (found and fixed): partner-reminder duplicate prevention was silently non-functional

While consolidating scheduler dedup logic onto one shared helper (§5),
auditing `runPartnerReminderScheduler`'s existing cooldown queries
surfaced this:

```ts
.from("notification_logs")
.select("user_id")
.eq("notification_type", "partner_nudge")
.in("user_id", allUserIds)
.gte("created_at", fiveDaysAgo)   // ← this column does not exist
```

`notification_logs` has never had a `created_at` column — only `sent_at`
(confirmed against every migration that touches this table: `014`
consolidated schema, `038`, `062`, `20260613_notifications.sql`). A
filter against a nonexistent column causes PostgREST to return an error;
the original code destructured only `{ data }` from the response,
discarding `error` silently. `data` came back `null`, `(data ?? []).map
(...)` produced an empty array, and the resulting "recently nudged /
recently reminded" sets were **always empty** — meaning the 5-day nudge
cooldown and 7-day reminder cooldown this scheduler was written to
enforce have likely never actually worked since they were introduced.

**Fixed** by routing both queries through the new
`getRecentlyNotifiedUserIds()` helper, which correctly filters on
`sent_at`. This is a real behavior change (the cooldowns will now
actually suppress repeat nudges/reminders), not a cosmetic refactor —
called out explicitly here rather than folded quietly into "consolidated
some queries."

## 5. Shared duplicate-prevention helper

`getRecentlyNotifiedUserIds(userIds, type, sinceISO)` — one
implementation of "which of these users already got a notification of
this type since this time," used by:
- `runWeeklySummaryScheduler` (new usage)
- `runMonthlyDigestScheduler` (new usage)
- `runGroupWeeklySummaryScheduler` (new usage)
- `runPartnerReminderScheduler` (fixed usage, §4)
- `goal_almost_complete`'s existing 14-day dedupe in
  `runDailyNotificationScheduler` (refactored from an inline query)
- `runGroupQuestEndingReminderScheduler`'s existing same-day dedupe
  (refactored from an inline query)

Six call sites, one query shape, one place to get the column name right.

## 6. Retries

`lib/webpush.ts` gained `sendWebPushWithRetry()`: one retry, a short
fixed delay, and **only** for failures that are plausibly transient
(network-level errors with no status code, or HTTP 408/429/500/502/503/
504). Permanent failures — 410/404 Gone, or other 4xx like 400/401/403 —
are never retried, since a second identical request would fail the same
way. `sendToUser()` now calls this instead of the non-retrying
`sendWebPush()` directly.

**Deliberately bounded, not a durable queue.** No job/queue
infrastructure exists anywhere in this codebase (confirmed during the
Phase 1 audit). This function is a single extra attempt inside the same
request, not a persisted retry that survives past the current
function's execution. The reasoning is explicit in the code's own
comment: `runDailyNotificationScheduler()` already processes many users
sequentially in one request, so an unbounded or long-backoff retry here
would risk this app's serverless function timeout. A true durable retry
queue (persist failed sends, retry them on a later cron run) is real,
valuable future work — not built this phase, and not pretended to be.

## 7. Restart safety

**The daily scheduler was already largely restart-safe by design**, even
before this phase's fixes — worth stating plainly rather than implying
everything here was broken. Because `shouldNotifyUserNow()`'s "overdue"
fallback guarantees at least one notification per user per day
regardless of exactly when the cron lands, a user not reached in a run
that crashes partway through is naturally caught up on the next run
(today, if re-invoked, or tomorrow via the overdue path) — no manual
resume logic needed. This phase's fix (§3) closes the one real gap: it
was restart-safe against *sequential* crash-and-resume, but not against
*concurrent* double-invocation. Both are now handled by the same atomic
claim.

The weekly/monthly/group schedulers are restart-safe in the same
sequential sense (an interrupted run simply processes fewer users; the
next scheduled run picks up whichever users still fall inside that run's
period window) and, after this phase, also safe against concurrent
double-invocation via §5's period-scoped dedup checks.

## 8. Verified / recommended / future work / known limitations

**Verified** (actually run in this sandbox):
- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors remain.
- `npx vitest run` (full suite) — 433 passed, 0 failed (up from 428
  before this phase — the +5 are `tests/unit/webpush.test.ts`, covering
  the new `isRetryable()` decision function's every branch: success,
  permanent 4xx, permanent 410/404-gone, retryable 5xx/429/408, and
  network-level failures with no status code).
- Confirmed the `created_at` column claim (§4) against every migration
  touching `notification_logs`, not just the table's original
  definition — no later migration ever added it.
- Manually traced every scheduler's loop structure after the try/catch
  additions to confirm brace-matching and that `continue` statements
  inside each try block behave correctly (verified via a clean
  `tsc --noEmit`, which would fail on any structural mismatch).

**Recommended, not yet built:**
- A durable retry queue for push sends that exhaust the one in-process
  retry (§6) — persist the failure, retry on a later cron run, rather
  than accepting the loss once both attempts fail.
- Applying the same per-user `try/catch` isolation to
  `runGroupQuestEndingReminderScheduler`'s and
  `runGroupWeeklySummaryScheduler`'s *group-level* iteration (currently
  isolated at the member level within each group, but a failure fetching
  one group's data could still affect that group's members) — a smaller,
  lower-risk gap than the ones fixed this phase, since groups are
  processed independently already for the parts that matter most.

**Future work (explicitly out of scope for Phase 8):**
- A `cron_runs` observability table (start time, end time, per-scheduler
  counts) for verifying in production that runs are completing and not
  silently overlapping — this phase hardened the code to be safe *if*
  they overlap, but doesn't add monitoring to detect whether they do.

**Known limitations:**
- The atomic claim in §3 protects against duplicate *sends*, not
  duplicate *processing* — two concurrent runs can both do the read
  work (fetching goals, computing eligibility) for the same user before
  one of them loses the claim at send time. This is a wasted-work
  concern, not a correctness one — the loser genuinely sends nothing.
- `getRecentlyNotifiedUserIds()`'s dedup window for the weekly/monthly/
  group schedulers is a fixed lookback (7 days / current month), not a
  precise "has this exact period's notification already been sent"
  check — sufficient to prevent a same-day or same-run double-send, but
  not a general-purpose idempotency key.
