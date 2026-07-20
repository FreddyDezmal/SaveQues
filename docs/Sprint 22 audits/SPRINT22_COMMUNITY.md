# Sprint 22 — Community, Accountability & Social Saving

This is the master Phase 17 document. It doesn't re-derive what Phases
12–15 already audited in detail — it points at those documents and
summarizes their findings — but it does contain new material for Phases
16–17 themselves: the testing work, the architecture/data-model picture
pulled together across all 10 migrations, and a couple of gaps this pass
found that the earlier phase-specific audits didn't surface.

**Companion documents (Phases 12–15, already delivered):**
- `Audits/Sprint 22 audits/PRIVACY_AUDIT.md` — Phase 12
- `Audits/Sprint 22 audits/PERFORMANCE_AUDIT.md` — Phase 13
- `Audits/Sprint 22 audits/SECURITY_AUDIT.md` — Phase 14
- `Audits/Sprint 22 audits/ACCESSIBILITY_AUDIT.md` — Phase 15

---

## 1. Architecture Overview

```
                     ┌─────────────────────────────────────────┐
                     │   Postgres — Sprint 22 owns the logic    │
                     │   (SECURITY DEFINER RPCs + RLS + triggers)│
                     └─────────────────────────────────────────┘
045 social_foundation.sql        — 10 tables, RLS enabled on every one
046 friend_system_rpc.sql        — friendships hardening + search/list RPCs
047 accountability_partner_hardening.sql
048 group_hardening_rpc.sql
049 shared_goal_hardening_rpc.sql
050 group_quests.sql             — service-role-only completion RPC
051 activity_feed_writes.sql     — DB triggers post to activity_feed;
                                    lib/activityFeed.ts is the ONE exception
                                    (level_up has no state-change row to
                                    trigger off — see its file header)
052 leaderboards.sql             — leaderboard_* RPCs, all scoped through
                                    leaderboard_member_set()
053 invitations.sql              — token/link generation (lib/invites.ts)
                                    + redeem_invite() as the one place a
                                    user's XP is awarded for someone
                                    else's action (direct xp_awards insert,
                                    not award_xp() — see 053's comments)
054 privacy_system.sql           — Phase 12 audit's 2 real gaps, fixed
055 performance_audit.sql        — Phase 13 audit's 2 index gaps + a
                                    leaderboard LIMIT bug, fixed

                     ┌─────────────────────────────────────────┐
                     │   app/api/* — thin, mostly stateless      │
                     │   pass-throughs to the RPCs above         │
                     └─────────────────────────────────────────┘
49 route.ts files across friends/ groups/ shared-goals/ partner/
leaderboards/ invitations/ group-quests/ feed/ achievements/visibility

Almost every route follows the same shape: auth check → light input
validation → rate limit (checkAttemptRateLimit) → call the RPC or do a
narrow RLS-scoped table operation → translate the result/error into a
clean HTTP response. The AUTHORIZATION decision itself (who can friend
whom, who can approve a join request, who can see this feed row) lives
in Postgres, not in these route handlers — this is why Phase 16's
integration tests need a real database and can't be faked with mocks.

                     ┌─────────────────────────────────────────┐
                     │   components/social/* — 18 files, pure    │
                     │   presentation over the API responses     │
                     └─────────────────────────────────────────┘
UserAvatar.tsx / UserName — the one shared renderer for the safe-column
  profile shape (id, username, display_name, avatar_emoji) every social
  RPC returns. Reused by FriendCard, FriendRequestCard, GroupMemberRow,
  LeaderboardRow, ActivityFeedCard, UserSearchPicker.

                     ┌─────────────────────────────────────────┐
                     │   lib/ — only 2 genuinely new files        │
                     └─────────────────────────────────────────┘
lib/invites.ts       — token generation, URL building, email-send stub
                        (no email provider configured anywhere in this
                        codebase — see the file's own header)
lib/activityFeed.ts  — the one application-code feed write (level_up)
```

**Reuse, not rebuild** (Phases 5–7's explicit requirement, verified):
- Group XP and group quest completion award real `xp_awards` rows and
  drive the same `getLevelFromXP()` used everywhere else — no parallel
  leveling system.
- `checkAchievements()` (Sprint 18) gained a `"social"` category
  (`referral_first` / `referral_five` / `referral_ten`) rather than a
  second achievement engine.
- `lib/notifications.ts` gained 7 new send functions (`sendFriendRequest`,
  `sendFriendAccepted`, `sendPartnerRequest`, `sendPartnerAccepted`,
  `sendPartnerNudge`, `sendGroupQuestCompleted`, plus group invite/join
  types) inside the existing send/preference-check architecture — no
  second notification pipeline.
- `group_quest_raw_progress` (050) reads `transactions` directly rather
  than re-deriving deposit logic that `lib/analyticsEngine.ts` already
  owns for the personal case (it can't reuse that module directly since
  it needs to aggregate across a member set inside SQL, but it mirrors
  the same definition of "a deposit").

---

## 2. Data Model

| Table | Purpose | Key constraint |
|---|---|---|
| `friendships` | One row per pair, `status` pending/accepted/declined/blocked | unconditional unique pair index — never more than one row per pair, in either direction |
| `accountability_partners` | One active/pending partnership per user | `enforce_single_accountability_partner` trigger (045) |
| `groups` / `group_members` | Groups with owner/admin/member roles, active/pending_approval/removed status | `owner_id` immutable except via ownership transfer; owner can never self-remove |
| `shared_goals` / `shared_goal_members` | Wraps an existing `savings_goals` row for shared visibility | `enforce_shared_goal_ownership` verifies real ownership + group membership at share time |
| `group_contributions` | Separate tracked-contribution ledger — **never** `transactions` | `enforce_contribution_membership`; deliberately can't touch `savings_goals.current_amount` (see Phase 6 note below) |
| `group_quests` | Quest wrapper over an existing group, 4 requirement types | `service_complete_group_quest` REVOKEd from `authenticated` — service-role only |
| `activity_feed` | Append-only, trigger-populated, no amounts ever | `can_view_activity_row` enforces per-row visibility on every SELECT |
| `invitations` | Token-based invite/referral links | `redeemed_by` write-once; one invite redeemable per account, ever |

Every table above has RLS enabled (`ALTER TABLE ... ENABLE ROW LEVEL
SECURITY`) — confirmed by direct grep against all 10 migrations, not
assumed. Full endpoint-by-endpoint privilege-escalation findings (5 real
bugs found and fixed during Phases 2–10) are in `SECURITY_AUDIT.md`.

**Money stays untouched — verified, not just claimed.** `savings_goals`
RLS is unchanged since before this sprint: `FOR ALL USING (auth.uid() =
user_id)`. Nothing in Phases 2–11 weakens it. A shared-goal contribution
writes only to `group_contributions`; `shared-goals/contribute`'s own
response uses `tracked: true` specifically so a client can't present it
as a real deposit.

---

## 3. Phase 16 — Testing (this pass)

**What's genuinely unit-testable, and what isn't.** Almost all Sprint 22
business logic lives in Postgres (RPCs, RLS, triggers), not TypeScript —
this is a deliberate architectural choice (see Phase 14's audit: pushing
authorization into the database means it can't be bypassed by a route
handler bug). That leaves very little *pure* application-layer logic to
unit test. Audited before writing anything:

| File | Testable? | Result |
|---|---|---|
| `lib/invites.ts` | Yes — `generateInviteToken`/`buildInviteUrl` are pure; `sendInviteEmail` is a pure stub with a documented contract | `tests/unit/invites.test.ts` — **8 tests, passing** |
| `lib/activityFeed.ts` | No — `postLevelUpToFeed` is a thin RPC-call wrapper with no branching logic of its own | Not unit tested, same reasoning already applied to similar wrappers elsewhere in this codebase |
| 49 `app/api/**/route.ts` files | No, not with mocks — the authorization decisions live in RPCs/RLS/triggers that a mocked Supabase client can't exercise honestly | Integration test stubs, see below |
| 18 `components/social/*.tsx` | Partially — most are thin presentation; 3 have real conditional/interactive logic worth pinning down | Component tests written for those 3 |

**New component tests** (following the existing `tests/component/`
convention — React Testing Library, accessible-name-first queries):
- `UserAvatar.test.tsx` (9 tests) — emoji fallback (including the `""`
  edge case), decorative `aria-hidden`, size variants
- `LeaderboardRow.test.tsx` (5 tests) — rank display, `sr-only` rank
  label, self-highlight styling, missing-profile-field fallbacks
- `FriendRequestCard.test.tsx` (6 tests) — incoming vs outgoing branch,
  per-person `aria-label`s, `onAccept`/`onDecline` called with the right
  `friendship_id`

**New integration test stubs**, following the exact pattern this
codebase already established in `transaction-flow.test.ts` (Sprint 18 —
Phase 2 fix): `it.todo(...)` with a full SEED/ACTION/ASSERT description,
not fake-passing tests. Each one requires a real Supabase *test* project
(see `docs/DEVELOPMENT.md`'s "Integration tests" section) to actually
implement, because each asserts on real RLS enforcement, real trigger
behavior, or a real cross-table invariant that a mock can't honestly
prove or disprove:

| File | Stubs | Covers |
|---|---|---|
| `friend-system-flow.test.ts` | 10 | request/respond state machine, mutual-request auto-accept, blocked-user 403, declined-row reuse/replacement, rate limiting |
| `accountability-partner-flow.test.ts` | 5 | single-partner trigger, mutual auto-accept, respond authorization, privacy of `GET /api/partner`, nudge's 3/day cap |
| `groups-flow.test.ts` | 5 | owner-on-create trigger, join/approve flow + non-admin rejection, owner-role-change restriction, owner-can't-self-remove, delete cascade vs shared-goal nulling |
| `shared-goals-flow.test.ts` | 4 | ownership/membership verification on share, contribution ledger isolation from real balance, unshare cascade scope, detail endpoint's amount-exposure exception |
| `group-quests-flow.test.ts` | 4 | non-member 404 vs member 403, idempotent settlement, active-member-only XP award, owner/admin-only creation with real quest types |
| `feed-and-privacy-flow.test.ts` | 4 | zero amount fields across every event type, per-row visibility enforcement, cursor pagination integrity, own-row-only delete |
| `leaderboards-flow.test.ts` | 3 | friends-scope membership boundary, group-scope non-member rejection, week-vs-month window correctness, zero balance fields across all 5 metrics |
| `invitations-flow.test.ts` | 4 | anonymous preview's narrow field set + indistinguishable not-found states, XP-award idempotency, group auto-join, self-referral/double-redemption guards, referral achievement thresholds |

**Verified, not just written.** Ran the full suite after every addition:

```
unit + integration projects:  229 real tests passing, 61 todo, 0 failing
component project:             50 real tests passing, 0 failing
```

**Corrections made while writing these** (worth recording, since this is
exactly the "verify, don't assume" instruction Sprint 22 opened with): my
first drafts of two stubs were wrong until I actually read the route
code —
- `shared-goals/detail` does **not** call `computeGoalHealth()` /
  `forecastGoal()`. It only wraps `get_shared_goal_detail()` (raw amounts
  + per-member contribution totals). See the Known Limitation below.
- `groups/members/remove` does a status transition
  (`'active'` → `'removed'`), not a row delete, and `groups/delete`
  **nulls** `shared_goals.group_id` rather than cascading the shared goal
  itself away.

---

## 4. Known Limitations

**Goal Health / forecast is not visible to shared-goal contributors —
only to the owner.** Phase 6 asked for "Goal health / Forecasting ...
All Sprint 19 intelligence must continue working" on shared goals. It
does, but only for the goal's actual owner, via their existing, private
`/goals/[id]` page (`GoalDetailClient.tsx` calls `computeGoalHealth()`
directly, unmodified since Sprint 19). A **contributing member** has no
RLS access to the underlying `savings_goals` row at all (`FOR ALL USING
(auth.uid() = user_id)`, unchanged) — their only view into the goal is
`get_shared_goal_detail()` (049), which returns amounts and per-member
contribution totals but never a health score or pace comparison. This
wasn't caught by the Phase 12 privacy audit because it's an
under-exposure, not an over-exposure — nothing leaks, something arguably
useful is just missing for non-owners. Left as-is this sprint rather
than modifying `computeGoalHealth()`'s caller surface without a product
decision on whether contributors should see the owner's pace at all
(the *existence* of a low health score is itself information about the
owner's real financial behavior, which is a privacy question, not just
an engineering one).

**`goal_visibility` singular vs `activity_visibility`/`user_achievements.
visibility` plural** — a real, harmless naming inconsistency
(`'group'` vs `'groups'`) already documented in `PRIVACY_AUDIT.md`, both
sides handled correctly by the code that reads them. Listed here too so
it isn't missed by anyone reading only this summary.

**Integration test stubs are specifications, not coverage.** The 46
`it.todo()` stubs added this phase describe exactly what should be
verified and how, but none of them run yet — they need a seeded Supabase
test project per `docs/DEVELOPMENT.md`. Reporting them as "tested" would
be dishonest; Vitest reports them explicitly as `todo` in every run for
exactly this reason (same rationale as the pre-existing
`transaction-flow.test.ts`, `quest-completion-flow.test.ts`, and
`notification-delivery.test.ts`).

**Email delivery is a documented stub.** No email provider is configured
anywhere in this codebase (checked `package.json` and grepped `lib/` and
`app/`). `sendInviteEmail()` always returns `{ sent: false,
reason: "no_provider_configured" }` and logs what it would have sent.
The invite system is fully functional without it — `/api/invitations/
create` always returns a working shareable link.

---

## 5. Future Extension Points

- Wiring `sendInviteEmail()` to a real provider (Resend/SendGrid/Postmark)
  is a scoped, isolated change — the integration point is already named
  and tested for its no-op contract.
- QR code rendering for invite links was left as architecture-only per
  the brief ("architecture only if asset generation isn't available") —
  `buildInviteUrl()` already returns a plain URL suitable for any
  client-side QR library to render.
- A resolution to the Goal Health limitation above (owner-only opt-in
  sharing of health/forecast with contributors, most likely) is the
  clearest next-sprint candidate coming out of this phase.
- Implementing the 46 integration stubs against a real Supabase test
  project is the other clear next step — they're fully specified, just
  not yet executable in CI.
