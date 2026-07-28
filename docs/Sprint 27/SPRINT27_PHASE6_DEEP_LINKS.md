# Sprint 27 — Phase 6: Deep Links

## 1. What this phase is

"Every notification opens the correct screen. Never dump users onto
Dashboard." By the time this phase started, a lot of this ground had
already been covered organically — Phase 2 built the navigable
Notification Center with `resolveNotificationHref()`'s category-fallback
system, and Phases 3/5 wired real (if sometimes generic) URLs into every
new notification type as they were built. This phase is the dedicated
audit-and-upgrade pass: go through every single notification type and
make sure its deep link is as *specific* as this app's actual page
structure allows, not just present.

## 2. What already existed (re-confirmed for this phase)

| Requirement | Status before this phase |
|---|---|
| Notifications are tappable/navigable at all | Already existed — Phase 2's `resolveNotificationHref()` + `NotificationCenter.tsx`. |
| Category-level fallback when `deep_link` is null | Already existed — `CATEGORY_FALLBACK_HREF` in `lib/notificationActions.ts`, keyed off the taxonomy, "never /dashboard unless the category is genuinely dashboard-relevant." |
| Most notification types pass *some* real URL | Already existed — every sender in `lib/notifications.ts` already called `sendToUser(..., url)` with something other than the old blanket default. |

What this phase found on audit: several of those URLs were *category*
pages (`/goals`, `/groups`, `/shared-goals`) rather than the *specific
item* the notification was actually about — technically not "dumped on
Dashboard," but not as sharp as the brief's own examples ("Goal
notification → Goal page" reads as the specific goal, not the goal list).

## 3. Upgrades made this phase

| Notification type | Before | After |
|---|---|---|
| `goal_almost_complete` | `/goals` | `/goals/{goalId}` |
| `goal_deadline_approaching` | `/goals` | `/goals/{goalId}` |
| `missed_weekly_deposit` | `/dashboard` | `/goals/{goalId}` when a goal exists, `/dashboard` otherwise (there's genuinely nothing more specific to link to with no active goal) |
| `milestone_celebration` | `/goals` | `/goals/{goalId}` |
| `achievement_unlocked` | `/profile` (arguably just wrong) | `/achievements?highlight={id}` — see §4 |
| `group_quest_ending` | `/groups` | `/groups/{groupId}` |
| `group_quest_completed` | `/groups` | `/groups/{groupId}` (falls back to `/groups` only if an upstream best-effort lookup came back empty — see code comment) |
| `group_weekly_summary` | `/groups` | `/groups/{groupId}` |
| `group_invite` | `/groups` | `/groups/{groupId}` |
| `goal_invitation` | `/shared-goals` | `/shared-goals/{sharedGoalId}` |

Every upgrade required threading an ID through from wherever it was
already available — none of these needed a new query, just passing an
existing value one level further: `lib/awardXP.ts` (achievement id, goal
id) and three API routes (`groups/invite`, `shared-goals/invite`,
`group-quests/check-completion`) all had the ID in scope already.

## 4. Achievement deep link — no detail route exists, so this page had to gain one capability

There's no `/achievements/[id]` route — `/achievements` is a flat list
where each card *is* the detail view (icon, title, description, privacy
control). So "deep-link to the achievement" doesn't mean "a new page," it
means "open this page already scrolled to and highlighting the right
card." `AchievementsClient.tsx` gained:
- Reads `?highlight=<achievement_id>` via `useSearchParams()`
- Scrolls the matching card into view and gives it a highlight ring once
  achievements have loaded
- `page.tsx` wrapped in `<Suspense>`, required by Next.js for
  `useSearchParams()` in the app router

`sendAchievementUnlocked()` now requires an `achievementId` parameter
(previously just title + icon) — the one call site
(`checkAndAwardAchievements()` in `lib/awardXP.ts`) already had
`achievement.id` in scope.

## 5. Confirmed-correct as already-maximally-specific (not gaps)

Three categories were checked and found to already be as specific as
this app's page structure allows — not oversights:

- **`/quests`** (`daily_quest`, `weekly_expiry`, `seasonal_expiry`) — no
  per-quest detail route exists anywhere in the app; the quests page
  shows daily/weekly/seasonal together as the whole feature.
- **`/partner`** (`partner_request`, `partner_accepted`, `partner_nudge`,
  `partner_reminder`) — a 1:1 relationship, so the single `/partner` page
  already *is* "the specific partner's page."
- **`/friends`** (`friend_request`, `friend_accepted`) — matches the
  sprint brief's own example verbatim: *"Friend request → Friends page."*
  The brief itself specifies the list page here, not a per-friend one.

## 6. Deliberate remaining `/dashboard` links

`streak_at_risk` and `inactive` still link to `/dashboard` — both are
genuinely non-item-specific (a streak isn't tied to one goal; "come back,
we miss you" isn't about any particular thing). `notificationActions.ts`
already documents this as the legitimate "system category" fallback
case, unchanged by this phase, and it's now covered by a dedicated test
(`system-category types legitimately fall back to /dashboard`).

## 7. Verified / recommended / future work / known limitations

**Verified** (actually run in this sandbox):
- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors from before Phase 3 remain.
- `npx vitest run` (full suite) — 416 passed, 0 failed, unchanged from
  Phase 5 (this phase changed URL strings and one function signature,
  not logic the existing suite exercises differently) plus 1 new test
  case added to `notificationActions.test.ts` covering the Phase 3/5
  additions' fallback hrefs.
- Manually grepped every `sendToUser(...)` call site in
  `lib/notifications.ts` after all edits to confirm no notification type
  was missed and no stale generic URL was left unaudited.

**Recommended, not yet built:**
- A dedicated `/quests/[id]` detail route, which would let
  `daily_quest`/`weekly_expiry`/`seasonal_expiry` deep-link to the
  specific quest instead of the quests page as a whole — genuinely
  blocked on that route not existing, not something this phase could
  wire around.

**Future work (explicitly out of scope for Phase 6):**
- Inline actions from the notification itself (the brief's "Accept /
  Decline" / "Reply" buttons acting without navigating away) — already
  flagged as a larger, separate change in `lib/notificationActions.ts`'s
  own file header from Phase 2; this phase is about *where a tap goes*,
  not making the tap unnecessary.

**Known limitations:**
- `sendGroupQuestCompleted`'s `groupId` parameter is typed
  `string | null | undefined` and falls back to the generic `/groups`
  list — its own upstream quest lookup (in
  `app/api/group-quests/check-completion/route.ts`) is itself
  best-effort and allowed to fail without failing the already-successful
  quest completion, so this fallback is a deliberate defensive default,
  not an oversight.
