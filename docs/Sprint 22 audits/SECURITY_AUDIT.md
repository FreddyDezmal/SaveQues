# Sprint 22, Phase 14 — Security Audit

Unlike Phases 12 and 13, most of this phase's ground was already covered
as it happened — every table built since `045` was hardened and tested
for privilege escalation *at the time it was built*, not deferred to a
dedicated security pass at the end. This document does two things:
consolidates that work into one place (so "is X authorized correctly" has
a single answer to check rather than six migration files to re-read), and
covers what a fresh, focused security pass at the end still found that
the incremental work didn't.

## Privilege escalation bugs found and fixed during Phases 2–10

Every one of these was caught by actually testing the attack against a
real Postgres instance, not by inspection — restated here as a single
reference list rather than re-explained (each migration's own comments
have the full reasoning):

| Table | Bug | Fixed in |
|---|---|---|
| `friendships` | INSERT didn't restrict `status` — a client could insert `status='accepted'` directly, skipping the other party's consent | `046` |
| `friendships` | DELETE let either party remove a `blocked` row, letting a blocked user delete their way out of it | `046` |
| `friendships` | UPDATE didn't lock `requester_id`/`addressee_id` — a party could repoint a row at an unrelated third user | `046` |
| `accountability_partners` | Same INSERT-status and UPDATE-hijack gaps as `friendships` (identical shape, found by re-auditing in light of the `friendships` fix) | `047` |
| `groups` | UPDATE didn't lock `owner_id` — an admin (not just the owner) could set `owner_id = themselves` | `048` |
| `group_members` | UPDATE didn't restrict `role` — a member could self-promote to admin | `048` |
| `group_members` | DELETE let an admin delete the owner's own row directly, bypassing proper group deletion | `048` |
| `group_members` | INSERT had no valid path for a group's own creator (chicken-and-egg: no admin/owner exists yet to "invite" them) | `048` |
| `shared_goal_members` | UPDATE didn't lock `shared_goal_id`/`user_id` — a user with **any** legitimate invite could repoint their row onto an unrelated goal and mark themselves active, gaining write access to that goal's contribution ledger | `049` |
| `shared_goals`/`shared_goal_members` | Mutual RLS recursion between the two tables' SELECT policies | `045`→`049` (fixed via a shared, non-recursive helper) |
| `invitations` | Group-context invite creation used `user_group_role(...) <> 'admin'`, and `NULL <> 'admin'` evaluates to `NULL` (falsy in an `IF`) — a total non-member could create a group invite unchallenged | `053` (caught before shipping, via review, then confirmed by testing the exact attack) |
| `leaderboard_xp` etc. | Not a privilege bug, but a real one: adding a parameter via `CREATE OR REPLACE` created a second function overload instead of replacing the first, breaking old callers as "ambiguous" | `055` |

**The pattern worth naming:** almost every one of these is the same
shape — an UPDATE or INSERT policy that correctly checked *who* could
touch a row without also constraining *which columns* they could change,
or without handling a `NULL` comparison correctly. Once this pattern was
recognized (after the `friendships` and `accountability_partners` bugs),
every subsequent table got checked for it proactively rather than
reactively — `group_members`, `shared_goal_members`, and `invitations`
were all audited against this exact shape *before* being tested, not
after a bug was found. Worth keeping in mind for any future table:
"who can update this row" and "which fields can they change" are two
different questions, and RLS `USING`/`WITH CHECK` only answers the first
one unless you're explicit about the second.

## Enumeration attacks

Consistent pattern applied everywhere a lookup could otherwise confirm
whether something exists: return the same response (empty result, `NULL`,
or a generic 404) for "doesn't exist" and "exists but you can't see it."
Checked specifically:

- `get_shared_goal_detail`, `get_invite_preview` — `NULL` either way.
- `leaderboard_member_set` (group scope) — empty set for a non-member,
  same as a genuinely empty group, never an error naming the group.
- `search_users` — excludes private/blocked profiles from results
  entirely rather than returning a "found but hidden" marker.
- `/api/shared-goals/detail`, `/api/groups/members` — 404/empty, not
  distinguished from a real 404.

## Rate limiting — gaps found and fixed this phase

Systematically checked every write handler across all eleven social
route groups (`friends`, `partner`, `groups`, `shared-goals`,
`group-quests`, `feed`, `invitations`, `achievements`) for a
`checkAttemptRateLimit` call. Most write endpoints already had one; four
genuinely didn't and got one this phase:

- **`POST /api/groups/delete`** and **`POST /api/shared-goals/unshare`**
  — both irreversible, cascading destructive actions with no limit at
  all. Not really a "spam" concern (nobody profits from deleting their
  own group repeatedly) so much as cheap insurance against a compromised
  session or a buggy client retrying destructively. Added 5/hour and
  10/hour caps respectively.
- **`POST /api/groups/members/role`** and **`POST /api/groups/members/
  remove`** — privileged, owner/admin-only actions that could be used to
  grief members (rapid promote/demote or kick cycling) if a session were
  compromised. Added 30/hour caps to both.

**Left as-is, and why:** routes like `friends/respond`, `partner/
respond`, `groups/invite/respond` are bounded by how many pending
requests you actually have — which is itself capped by the *sender's*
rate limit — so they're self-limiting without their own explicit cap.
Read-only routes (leaderboards, `feed`, lists) weren't rate limited;
scraping risk exists but is low-value (all relationship-scoped, nothing
to scrape that isn't already visible to the requester through the
relationship they'd need anyway).

## `GET /api/invitations/preview` — a rate-limiting gap that can't be
## closed with the existing mechanism

This is the one deliberately unauthenticated endpoint in the entire
sprint (`053` — a brand-new visitor previewing an invite before they've
signed up). It has no rate limiting, and checked whether it could get
one: `checkAttemptRateLimit`'s underlying `rate_limit_attempts` table has
`user_id UUID NOT NULL REFERENCES profiles(id)` (`026`) — a hard foreign
key to a real account. There is structurally no way to attach an
anonymous visitor's request to that table without either a fake/null
user reference (which the FK rejects outright) or building a **separate,
IP-keyed** rate-limiting mechanism, which doesn't exist anywhere in this
codebase.

**Not fixed — recommendation instead**, same "architecture only"
treatment this sprint has given every other genuine infrastructure gap
(no email provider in `053`, no Realtime/caching in `055`): the realistic
threat here is scraping/load, not token brute-forcing (tokens are
131-bit-entropy, `053` — guessing one is computationally infeasible
regardless of any rate limit). Two reasonable paths forward, neither
implemented here: edge/CDN-level rate limiting (Vercel/Cloudflare, a
platform config choice, not a code change) or a new IP-keyed table
mirroring `rate_limit_attempts`' shape but without the profile FK.

## Notification spam — bounded, not eliminated

Checked whether a malicious actor could use the social notification
types (`051`) to harass a target with pushes. Two vectors exist, both
already bounded by existing rate limits rather than fully closed:

- **Friend request decline-then-reinvite cycling**: `/api/friends/
  request`'s decline-then-resend path (`046`) sends a fresh
  `friend_request` push each time. Capped at 20/hour by that route's
  existing rate limit — genuinely annoying if fully exploited, not
  unbounded.
- **Group invite decline-then-reinvite**: same shape via `/api/groups/
  invite`'s stale-row-replacement path, capped at 30/hour.

Not fixed — the existing per-sender caps already bound the worst case to
"annoying for an hour," and adding a per-*target* cooldown (distinct from
the existing per-*sender* rate limit) is a reasonable future refinement,
not a gap that needs closing before this ships.

## A consistency note, not a leak: retroactive visibility changes

`profiles.activity_visibility` is read **live** by `get_user_achievements`
(`054`) — change your default today, and every achievement without an
explicit override reflects the new setting immediately, past and future.
`activity_feed` (`051`) is different: visibility is stamped onto each row
**at insert time**, using whatever `activity_visibility` was set *then*.
Changing your default later does not retroactively relabel old feed
posts. Both behaviors are internally consistent and neither leaks
anything beyond what the user themselves chose at the time — but the two
features apply "change my default" differently, which could surprise
someone expecting one global switch. Not changed here: making the feed
retroactive would mean either a live visibility join on every feed read
(a real design/performance tradeoff, not a quick fix) or a bulk-rewrite
trigger on every settings change. Flagged for a future decision, not
treated as a bug.

## Confirmed NOT exploitable (verified, not assumed)

- **`invitations` redemption bypass** — the UPDATE policy's `WITH CHECK`
  requires `redeemed_by IS NULL`, so even the inviter themselves cannot
  set `redeemed_by` via a direct client UPDATE; only `redeem_invite()`
  (`SECURITY DEFINER`, its own independent verification) can ever set it.
- **`service_complete_group_quest` / `service_post_level_up`** — both
  `REVOKE`d from `authenticated` entirely (`050`, `051`); confirmed via a
  direct call attempt returning `permission denied`, not just by reading
  the `REVOKE` statement.
- **`activity_feed` retroactive tampering** — no UPDATE policy exists at
  all (only SELECT/INSERT[revoked]/DELETE), so a post's visibility can
  never be changed after the fact, only deleted outright.
