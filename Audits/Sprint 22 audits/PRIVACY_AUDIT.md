# Sprint 22, Phase 12 — Privacy System Audit

Every social feature built in Phases 2–11, reviewed against one question:
**can anyone see something they shouldn't?** Findings are evidence-based —
each line below reflects what the code actually does, verified against a
real Postgres instance where the finding involved a table or function
(the migrations from Phases 2–11 were all tested this way as they were
built; this pass re-reads them specifically for cross-cutting visibility
correctness, and adds new tests for the two gaps found and fixed in
`054_privacy_system.sql`).

## Visibility columns (all from `045_social_foundation.sql`)

| Column | Values | Default | Governs |
|---|---|---|---|
| `profiles.profile_visibility` | private / friends / public | `friends` | Whether **strangers** can find/view you at all |
| `profiles.activity_visibility` | private / friends / groups / public | `friends` | Default visibility for feed posts and achievements with no per-item override |
| `savings_goals.goal_visibility` | private / friends / **group** / public | `private` | Feed visibility when a goal is completed |
| `user_achievements.visibility` | private / friends / **groups** / public, nullable | `NULL` (inherits `activity_visibility`) | Per-achievement override |

**Known naming wart, not fixed:** `goal_visibility` uses `'group'`
(singular) while `activity_visibility`/`user_achievements.visibility` use
`'groups'` (plural). Both `051`'s `feed_on_goal_completed` and `054`'s
`get_user_achievements` handle this correctly (mapped/matched
explicitly), but it's a real inconsistency worth fixing in a future pass
if these constraints are ever touched again — not worth a migration on
its own.

## Table-level RLS re-check

Nothing below was widened by this sprint. Confirming the boundary still
holds is the point of an audit — re-reading isn't redundant when the goal
is "make sure I didn't create a hole," not "assume the first pass was
right."

- **`profiles`** — SELECT is `auth.uid() = id` only, unchanged since
  `014`. Every single cross-user profile read added in Phases 2–12 goes
  through a `SECURITY DEFINER` function returning an explicit safe-column
  allowlist (`search_users`, `get_friend_profile`, `get_group_members`,
  every leaderboard, `get_user_achievements`, etc.) — never a widened
  policy. This is the one property that made most of this sprint's
  privacy guarantees possible: a bug in an RPC's logic can leak at most
  what that RPC explicitly selects, never `is_admin`, notification
  prefs, or anything else on the row.
- **`savings_goals`**, **`transactions`** — both still `auth.uid() =
  user_id` only (`014`), untouched. All money-adjacent reads elsewhere
  (group quest progress, leaderboards, shared goal detail) go through
  `SECURITY DEFINER` functions that select specific aggregate or
  explicitly-consented fields, never these tables directly.
- **`user_achievements`** — still `FOR ALL USING (auth.uid() = user_id)`
  from `014`. Flagged in `051`'s file header and unchanged here: this
  policy lets a user INSERT their own achievement row directly,
  bypassing `award_achievement()`. Out of scope for a privacy audit
  specifically (it's an integrity issue, not a visibility leak — a fake
  achievement is only visible under the same rules a real one would be),
  but restated here since Phase 14 (Security) should pick it up.
- **`activity_feed`** — the one table whose OWN RLS enforces per-row
  dynamic visibility rather than relationship-gating a whole table. Its
  policy was refactored in `051` to share a single function
  (`can_view_activity_row`) with the read RPC specifically so the two
  could never drift — and did, briefly, in this sprint's own earlier
  draft of Phase 8, caught by testing before it shipped.

## RPC-by-RPC review

Every function is either (a) gated by an established relationship
(friendship, shared group, shared goal invite) as a prerequisite for
returning *anything*, which makes `profile_visibility` irrelevant to it
by construction (no relationship = no data, independent of any
visibility setting), or (b) one of the handful that actually reads
`profile_visibility`/`activity_visibility` directly. Listed as such:

**Relationship-gated (profile_visibility not applicable — access requires
an established connection regardless of the setting):**
`get_friend_profile`, `list_friends`, `get_partner_status`,
`get_group_members`, `list_my_groups`, `get_shared_goal_detail`,
`list_my_shared_goals`, `compute_group_quest_progress`, all six
leaderboard functions, `get_invite_preview` (narrower still — never
exposes anything beyond inviter display name/group name).

**Directly visibility-aware:**
- `search_users` (`046`) — excludes `profile_visibility = 'private'`
  and anyone on either side of a block. This is the original,
  correctly-scoped "can a stranger find you" gate.
- `activity_feed` triggers + `get_activity_feed` (`051`) — full
  private/friends/groups/public enforcement per row, shared between
  write-time defaulting and read-time filtering via one function.
- `get_user_achievements` (`054`, **new this phase**) — see below.

## The two gaps this phase found and closed

**1. No way to browse achievements at all.** They only ever appeared
once, in the activity feed, at the moment of unlocking. The brief lists
"Public achievements" as a visibility *level*, which implies something
you can look up, not a post that scrolls away. Added
`get_user_achievements()` — two-layer enforcement (outer:
`profile_visibility` for strangers; inner: per-achievement visibility
falling back to `activity_visibility`) — plus `GET /api/achievements` and
`POST /api/achievements/visibility` to actually set the per-achievement
override, which had a database column since `045` but no way to change
it.

**2. Inconsistent handling of a locked-down profile.** My first draft of
`get_user_achievements` blocked *everyone* but the owner once
`profile_visibility = 'private'`, including existing friends. That
directly contradicted `get_friend_profile` (`046`), which never
re-checks `profile_visibility` for an accepted friend — the same
person's data would have behaved under two different privacy rules
depending only on which endpoint you asked. Caught by testing the new
function against the old one's established behavior, not by inspection.
Fixed: `profile_visibility` now gates **strangers only** everywhere
(consistent across both functions) — an existing friend or fellow group
member retains their own relationship-based access; revoking that
requires unfriending/leaving, not a discoverability toggle.

**3. (Found and fixed inline, not a design question)**
`user_achievements.visibility`'s CHECK constraint never actually allowed
`'groups'` as a storable value, even though `get_user_achievements` was
built to handle that case via the `activity_visibility` fallback. A
per-achievement override could never explicitly select "groups only."
Extended the constraint in `054` for consistency with `activity_visibility`.

## Settings routes — the other concrete gap

`045` added every visibility column; nothing existed to change most of
them except by hand. This phase found that `profile_visibility` and
`activity_visibility` were already writable through the pre-existing
`profiles` UPDATE policy (a named column-lock allowlist covering only
`xp_total`/`streak_days`/`is_admin`/quest counters — the two new columns
were never in that list), and `goal_visibility` likewise through
`savings_goals`' existing owner-only policy. So no RLS changes were
needed — only routes, and specifically *extending the two already-
consolidated write paths* (`PATCH /api/profile`, `PATCH /api/goal/edit`)
rather than creating competing ones to the same tables, consistent with
those routes' own documented "single write path" purpose. Verified via a
real update that the pre-existing `xp_total` column lock still holds
even in the same statement as a legitimate visibility change — the whole
statement is rejected, not partially applied.

## Known gaps, deliberately not closed this phase

- **No leaderboard opt-out.** Friends/group leaderboards (`052`) are
  correctly relationship-scoped (not a leak), but there's no per-user
  "don't rank me" toggle. Not explicitly requested by the brief; a
  reasonable future addition, not built here to avoid scope creep beyond
  what Phase 12 actually asked for.
- **`user_achievements`' insertable-by-anyone-for-themselves policy**
  (see table review above) — an integrity gap, not a visibility one,
  restated for Phase 14's attention rather than fixed here.
