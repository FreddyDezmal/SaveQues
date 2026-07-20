# Sprint 22 Social Frontend — Delivery Report

Built entirely against the existing Sprint 22 backend as implemented. Zero
migrations touched, zero API routes modified, zero new backend logic —
verified by a real `next build` (exit 0) and `tsc --noEmit` (exit 0)
against your actual project, not just eyeballed.

---

## 1. Folder structure

```
app/(app)/
  friends/                    page.tsx, FriendsClient.tsx
  partner/                    page.tsx, PartnerClient.tsx
  groups/                     page.tsx, GroupsClient.tsx
    [groupId]/                page.tsx, GroupDetailClient.tsx
  shared-goals/                page.tsx, SharedGoalsClient.tsx
    [sharedGoalId]/           page.tsx, SharedGoalDetailClient.tsx
  leaderboards/                page.tsx, LeaderboardsClient.tsx
  feed/                        page.tsx, FeedClient.tsx
  achievements/                 page.tsx, AchievementsClient.tsx      (new — no prior UI existed)
  social/                       page.tsx                              (hub, links to all of the above)
    privacy/                    page.tsx, PrivacyClient.tsx           (new — no prior UI existed)
  profile/ProfileClient.tsx     — MODIFIED (one new link row only)

components/
  social/                       19 files — FriendCard, FriendRequestCard, GroupCard,
                                 GroupMemberRow, GroupQuestCard, SharedGoalCard, ContributionCard,
                                 ActivityFeedCard, LeaderboardRow, LeaderboardTable, UserAvatar,
                                 UserSearchPicker, InviteModal, ContributeModal, CreateGroupModal,
                                 CreateGroupQuestModal, CreateSharedGoalModal, GroupSettingsModal
  ui/                           Modal.tsx, ConfirmationModal.tsx, StatusBadge.tsx,
                                 VisibilityBadge.tsx, PrivacySelector.tsx  (5 new — all others reused as-is)

lib/hooks/useFocusTrap.ts       — new, extracted from NotificationCenter (see §5)
```

44 new files, 1 modified file (a single new `<a href="/social">` link row on
Profile — nothing else in that file was touched).

---

## 2 & 3. Every new / modified file

Listed above by directory. The zip (`sprint22_social_frontend.zip`)
preserves this exact path structure so it can be dropped straight into
the repo.

---

## 4. Accessibility decisions

- **Focus trap extracted, not duplicated.** `NotificationCenter.tsx`
  already had inline focus-trap/Escape/return-focus logic. Rather than
  copy it into the two new modal patterns this sprint needed
  (`ConfirmationModal`, `InviteModal` and everything built on `Modal`),
  I extracted it into `lib/hooks/useFocusTrap.ts` — same "extract on
  second use" reasoning your own `usePrefersReducedMotion.ts` documents.
  `NotificationCenter` itself was left untouched; retrofitting a working,
  shipped component for cosmetic equivalence wasn't worth the risk.
- **Every status badge has text + icon, never color alone** —
  `StatusBadge.tsx` covers every enum this sprint's backend introduced
  (friendships/group_members/accountability_partners/group_quests/
  invitations).
- **Accept/Decline buttons carry the person's name in `aria-label`**
  everywhere they appear (friend requests, group invites, join-request
  approvals, shared-goal invites) — `aria-label="Accept Alice's friend
  request"`, never a bare `"Accept"`.
- **Every destructive action is behind `ConfirmationModal`**: delete
  group, unshare goal, remove member, remove contributor, block friend,
  leave group, end partnership.
- **Privacy selectors are native `<select>` elements**
  (`PrivacySelector.tsx`) — no custom dropdown.
- **Leaderboard rank has no movement indicator** — see §7, this is
  because the data doesn't exist, not an accessibility oversight.
- **Feed pagination uses a "Load more" button, not scroll-triggered
  infinite loading** — more reliably keyboard/screen-reader operable
  than a hand-rolled `IntersectionObserver` pattern; an `aria-live`
  region announces "Loaded N more posts" after each load.
- **Reduced motion**: nothing new here uses JS-driven animation
  (confetti, etc.), so `usePrefersReducedMotion` wasn't needed directly —
  CSS transitions are already globally shortened for
  `prefers-reduced-motion` at the stylesheet level (`app/globals.css`).
- Verified with `tsc`/`eslint`/`next build`, **not** verified with an
  actual screen reader or axe-core run in this session — see §8.

---

## 5. Component reuse decisions

Reused as-is, zero modification: `.card`, `.btn-primary`, `.btn-ghost`,
`.input-field` (global CSS classes), `EmptyState`, `ErrorState`,
`Skeleton`, the `brand`/`emerald`/`surface` color tokens, `font-display`/
`font-body`. `formatCurrency`/`formatPercent` from `lib/utils.ts` — I'd
initially hardcoded a `"R"` prefix in `SharedGoalCard` before checking
whether a shared formatter existed; caught and fixed before shipping,
since this app supports multiple currencies and a hardcoded prefix would
have been wrong for non-ZAR users.

New primitives were built only where nothing equivalent existed:
`Modal`/`ConfirmationModal` (no dialog primitive existed outside
`NotificationCenter`'s inline one), `StatusBadge`/`VisibilityBadge` (no
badge component existed at all), `PrivacySelector` (new requirement),
`UserAvatar` (every social API response shares the same
id/username/display_name/avatar_emoji shape — one renderer instead of
each component reinventing it).

---

## 6. Performance considerations

- Group detail and shared-goal detail pages batch their initial fetches
  with `Promise.all` rather than sequential awaits.
- Leaderboard progress/history data loads on demand (expand-to-fetch in
  `GroupQuestCard`), not eagerly for every card in a list.
- Feed pagination respects the backend's actual cursor design
  (`before` param, 50-item server-side cap) rather than fetching
  everything and paginating client-side.
- **No client-side caching layer added** — consistent with
  `PERFORMANCE_AUDIT.md`'s finding that none exists anywhere in this
  codebase; each page/tab switch does a fresh fetch. Fine at this data
  scale, worth revisiting if these pages get slow in practice.

---

## 7. Security considerations

- **No client-side authorization logic anywhere.** Every "can this
  person do X" decision is left entirely to the backend (RLS + the
  transition triggers documented in `SECURITY_AUDIT.md`) — the UI only
  *hides* controls a user's role wouldn't be allowed to use (e.g. a
  regular member never sees the "remove member" button), it never
  relies on that hiding as the actual security boundary. A response
  error from the backend is always the real gate.
- **Two real gaps found and fixed while wiring the UI to the real API,
  not assumed correct:**
  1. My first draft picked the "current user" for the group Leave-group
     flow using a broken heuristic (first member matching my own role) —
     wrong whenever two members share a role. Fixed to use the
     established `lib/supabase/client.ts` → `auth.getUser()` pattern
     already used elsewhere in this codebase (`GoalDetailClient.tsx`).
  2. The Achievements settings page initially read `visibility` from
     `GET /api/achievements`, which wraps `get_user_achievements()` — a
     general-purpose "view ANYONE's achievements" RPC that deliberately
     never returns the raw override (correct for viewing someone else,
     wrong for managing your own). Fixed by querying `user_achievements`
     directly, which its own RLS (`auth.uid() = user_id`) already scopes
     correctly — same reuse-existing-RLS pattern used for the
     "goals eligible to share" list and the contribution history feed.
- Every mutating fetch call matches its route's real expected body shape
  exactly (verified against each route's source, not assumed from memory).

---

## 8. Production readiness assessment

**Compiles and builds cleanly**: `tsc --noEmit` exit 0, `eslint` exit 0
across every new/modified file (with 6 real `react/no-unescaped-entities`
errors caught and fixed during this pass), and a full `next build`
completed successfully with every new route appearing correctly in the
build manifest (`/friends`, `/groups`, `/groups/[groupId]`,
`/shared-goals`, `/shared-goals/[sharedGoalId]`, `/partner`,
`/leaderboards`, `/feed`, `/achievements`, `/social`,
`/social/privacy`).

**Not done, and you should know before calling this fully production-
ready:**
- **No manual QA against a running app.** I don't have a live Supabase
  instance with real session cookies in this sandbox, so I could not
  click through these flows end-to-end against real data — only
  compile/build/type-check them. The API contracts were verified by
  reading each route's actual source, not by exercising them live.
- **No screen reader or axe-core pass.** Built to satisfy the stated
  requirements (labels, roles, focus management, contrast via existing
  tokens) but not independently audited with real assistive tech.
- **Three deliberate scope gaps versus your original spec**, all because
  the backend doesn't support them (see the note at the top of
  `LeaderboardsClient.tsx`): no "Global" leaderboard tab (Phase 9's own
  audit rejected this for privacy reasons), no "All Time" period filter
  (the API only accepts week/month), no "Savings" dollar column or
  rank-movement arrows (leaderboards never expose amounts, and nothing
  in the schema tracks a previous rank to diff against). I built the UI
  against what the API actually returns rather than fabricate data for
  what it doesn't.
- **Per-goal visibility control** (`savings_goals.goal_visibility`) was
  *not* wired into the existing goal detail page — that file is 741
  lines and I chose not to make an unreviewed edit to it under this
  task's time constraints. It's fully functional via the existing
  `PATCH /api/goal/edit` endpoint whenever that page is next touched.
