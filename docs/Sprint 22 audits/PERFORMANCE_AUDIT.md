# Sprint 22, Phase 13 — Performance Audit

Same method as Phase 12: read everything built in Phases 2–12 against a
specific question — here, "does this scale past a handful of test rows,
and did I actually verify that or just assume it." Two real bugs were
caught this way, one of which directly contradicted a claim I'd written
in this migration's own first-draft comments.

## Indexes

Two gaps found, both additive — nothing from `024_performance_indexes.sql`
(the pre-sprint baseline) was touched, since it's already tuned and
documented for its own query paths.

| New index | Serves | Verified |
|---|---|---|
| `idx_transactions_deposit_user_created` (partial, `WHERE transaction_type='deposit'`) | `group_quest_raw_progress` (050), `leaderboard_consistency_inputs` (052) — both filter transactions to deposits only across a member set | Structurally correct (confirmed via `SET enable_seqscan=off`, returned the right row count); **not yet planner-preferred** at test-database scale — see honest note below |
| `idx_group_contributions_goal_user` (`shared_goal_id, user_id`) | `get_shared_goal_detail`'s (049) per-member SUM subquery, `leaderboard_group_contributions`'s (052) GROUP BY | Same category — additive, not measured as a speedup at test scale |

**Honest note on "verified":** I seeded ~165K transaction rows and ran
`EXPLAIN ANALYZE` — the query planner chose a sequential scan over the
new index at every volume I tested, because the table fits comfortably
in memory at that size and a seq scan is genuinely cheaper there. That's
Postgres working correctly, not a broken index — I forced the index path
with `enable_seqscan=off` and confirmed it returns identical, correct
results. These indexes are added on the same reasoning that justified
`024`'s original ones: proactively, for the query *shape* the new social
features introduce (filtering to one transaction type across many
users), which becomes worth an index at genuine production data volumes
even though a local test database doesn't cross that threshold. I'm not
claiming a measured speedup I don't have.

## A real bug: `CREATE OR REPLACE` does not mean what I assumed

While adding a `p_limit` parameter to the six leaderboard functions, my
first draft's comment claimed this was "backward compatible — existing
callers that don't pass it keep working unchanged." That's wrong, and
testing caught it before it shipped: Postgres identifies a function by
name *and parameter type list*. Changing the signature via `CREATE OR
REPLACE` doesn't replace the old function — it creates a **second
overload** alongside it. Calling `leaderboard_xp('friends', NULL,
'week')` with the old 3-argument shape then became genuinely ambiguous
between "the 3-arg function" and "the 4-arg function with its default
filled in," and failed with `function ... is not unique`. Fixed by
explicitly `DROP FUNCTION`-ing every old signature before creating the
new one — verified the old call shape works again afterward, plus the
new 4th argument, plus that an absurd limit (10000) clamps to the 100
cap and a zero/negative one clamps to at least 1.

## Leaderboards had no result cap at all

Friends-scope is self-bounding — nobody has an unbounded friends list —
but group-scope isn't, and none of the six `052` leaderboard functions
had a `LIMIT` clause. "Leaderboard" implies a top N; a large group would
have returned its entire membership, unranked-by-cutoff, on every
request. Added `p_limit` (default 50, clamped to a 100 max) to all six.

## N+1 query patterns in application code

The real anti-pattern — N *separate round trips* from TypeScript, not
just a correlated subquery inside one SQL statement — appeared in two
places, both in Phase 11's cron schedulers (never user-facing request
paths, but still worth fixing since a cron job that scales linearly with
partnership/group count is still a real cost):

- **`runPartnerReminderScheduler`** issued up to 3 queries *per active
  partnership* (one nudge check, up to two reminder checks). Refactored
  to 2 queries total regardless of partnership count — batch-fetch every
  relevant `notification_logs` row across all involved users up front,
  match against each partnership in memory.
- **`runGroupWeeklySummaryScheduler`** issued 2 queries *per active
  group* (members, completed quests). Same fix: batch-fetch both across
  all groups in 2 queries total, group results in memory by `group_id`.

Both still send notifications in a per-user loop — that's inherent to
the existing push-notification architecture (`sendToUser` does its own
per-user subscription lookup), predates this sprint, and rewriting it is
out of scope for a Phase 13 audit of the *social* features built on top
of it.

**Not refactored, and why:** correlated subqueries like `list_my_groups`'
per-group member-count subquery, or `get_shared_goal_detail`'s
per-member contribution SUM, are evaluated once per row *inside a single
SQL statement* — not a network round trip per row. These are indexed
(the new `idx_group_contributions_goal_user` directly serves the second
one) and bounded by realistic group/goal sizes; they're a different
category from the scheduler issue above and don't need the same fix.

## Pagination / unbounded results

- **`get_activity_feed`** (051) — already cursor-paginated (`p_before`,
  capped `p_limit` of 50), no change needed.
- **Leaderboards** — fixed above (this phase).
- **`get_group_members`** (048) — no limit. Left as-is: a savings group
  (family, friends, travel) realistically tops out at dozens of people,
  not thousands, so this is low-risk. Flagged rather than changed, since
  adding a cap here risks silently hiding legitimate members in an edge
  case that doesn't currently exist.
- **`invitations` list, `list_my_shared_goals`, `list_my_groups`** — all
  scoped to "things belonging to the caller," self-bounding by
  definition.

## Real-time subscriptions / Supabase channels

Checked: **this codebase does not use Supabase Realtime anywhere** — no
`.channel()` calls, no replication/publication setup, in any pre-sprint
or sprint code. Every screen works by fetching on load and on user
action, not by subscribing to live updates. This is a legitimate
architectural absence, not a bug, and adding Realtime is a real
infrastructure decision (enabling logical replication on specific
tables, new client-side subscription code, connection-count implications
at scale) — the same category of call as the "no email provider" finding
in Phase 10, not something to introduce as a surprise inside a
performance audit.

**Where it would matter most, if adopted:** `activity_feed` (a live "new
post" indicator instead of a refresh-to-see-it feed) and
`notification_logs` (a live unread-count badge). Recording this as a
recommendation, not implementing it — same "architecture only" treatment
this sprint has used consistently for infrastructure that doesn't exist
yet and isn't mine to add unilaterally.

## Caching

No caching layer (Redis, in-memory TTL cache, `unstable_cache`, etc.)
exists anywhere in this codebase currently — checked alongside the
Realtime search. The best caching candidates from this sprint's own
functions:

- **`leaderboard_my_groups`** and **`get_group_members`** — read-heavy,
  change only on explicit user actions (join/leave/quest completion),
  good candidates for a short TTL cache if leaderboard/roster screens
  become measurably slow at real usage volume.
- **`get_activity_feed`** — deliberately *not* a good caching candidate;
  it's meant to feel current, and per-viewer viewer-relative filtering
  (friends/groups) makes a shared cache key awkward without real design
  work.

Not implemented — no evidence yet that any of this sprint's endpoints
are actually slow enough to need it, and adding a caching layer
speculatively is exactly the kind of premature optimization worth
naming as a recommendation rather than acting on without a measured
problem.
