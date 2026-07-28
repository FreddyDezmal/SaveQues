# NOTIFICATION_AUDIT.md — Sprint 27 (Notification & Communication System)

Final-phase consolidated audit of the whole notification system as it
stands after all 16 phases. Every count below was produced by actually
querying the codebase this phase (grep/awk against the real source),
not recalled from memory of having written it.

## Inventory (verified counts)

| Metric | Count | How verified |
|---|---|---|
| `NotificationType` union members | **23** | `awk` extraction of the actual union declaration, filtered to lines matching the `\| "..."` syntax — excludes several preference-category names that appear only in adjacent comments and could otherwise inflate the count. |
| `notification_preferences` category booleans | **11** | `achievements`, `goal_reminders`, `streak_reminders`, `weekly_summaries`, `milestone_celebrations`, `product_announcements`, `groups`, `partners`, `xp`, `referrals`, `monthly_summaries` — read directly from `20260723_notification_preferences_expansion.sql`. |
| Centralized template registry keys | **33** | Extracted from `lib/notificationTemplates.ts`'s `en` locale object. |
| Scheduler functions | **7** | `runDailyNotificationScheduler`, `runWeeklySummaryScheduler`, `runMonthlyDigestScheduler`, `runPartnerReminderScheduler`, `runGroupWeeklySummaryScheduler`, `runGroupQuestEndingReminderScheduler`, `runNotificationLogsCleanupScheduler` — `grep -c "^export async function run"` against `lib/notifications.ts`. |
| Email provider adapters | 5 (4 real + 1 documented stub) | Resend/SendGrid/Postmark/Mailgun real; SES stub (SigV4). |
| Push provider adapters | 5 (4 real + 1 documented stub) | Web Push (the live default)/Expo/OneSignal/Firebase real; APNs stub (HTTP/2 transport). |
| Notification-specific tests | **495 - lib tests unrelated to notifications** — see `docs/SPRINT27_PHASE15_TESTING.md` for the itemized per-file breakdown (161+ across 13 unit test files alone, plus component/integration coverage). |

## Which of the 23 notification types are "live" (gate on a real, wired preference check) vs. global-switch-only

Read directly from `lib/notifications.ts`'s actual `canSendNotificationToUser()`/
`getPref()`/`getUsersAllowedCategory()` call sites, not assumed from the
type list alone:

**Gated by a specific category:**
`streak_at_risk`, `daily_quest`, `weekly_expiry`, `seasonal_expiry`
(`streak_reminders`/`goal_reminders`); `achievement_unlocked`
(`achievements`); `milestone_celebration`, `group_quest_completed`
(`milestone_celebrations`); `weekly_summary`, `group_weekly_summary`
(`weekly_summaries`); `monthly_summary` (`monthly_summaries` — made live
in Phase 5, the last of the six original Sprint 16 categories to
actually get a sender); `goal_almost_complete`,
`goal_deadline_approaching`, `missed_weekly_deposit` (`goal_reminders`,
Phase 3); `group_quest_ending`, `group_invite`, `goal_invitation`
(`groups`, Phase 4); `partner_request`, `partner_accepted`,
`partner_nudge`, `partner_reminder` (`partners`, Phase 4).

**Global-switch-only (`notifications_enabled`), no dedicated category —
documented, not accidental**: `friend_request`, `friend_accepted`,
`inactive`. "Social/Friends" was never one of the categories any phase's
brief asked for; `inactive` is a system-level nudge with no natural
category home.

**Preference categories that exist but gate nothing yet** (persisted,
not fabricated as functional): `xp` (no notification type exists for a
bare XP gain distinct from `achievement_unlocked`), `referrals` (no
referral feature exists anywhere in this codebase at all — confirmed by
full-repo grep during Phase 3's original audit and never contradicted
since), `product_announcements` (no content/CMS system exists to
populate it).

## What Sprint 27 built, phase by phase (summary — see each phase's own doc for full detail)

| Phase | What it added |
|---|---|
| 3 | Smart Reminder Engine — goal/deposit reminders with real numbers in the copy, not generic nagging. |
| 4 | Preferences expanded 6→11 categories, quiet hours, vacation mode, digest frequency. |
| 5 | Digest System — weekly/monthly recaps, persisted snapshots, a real `/digest/[id]` page. |
| 6 | Deep link audit — every notification type upgraded to the most specific destination this app's routes allow. |
| 7 | Centralized template registry — zero hardcoded notification strings left anywhere. |
| 8 | Scheduling hardening — a real race condition fixed, a real silently-broken cooldown bug fixed, bounded retries added. |
| 9 | Email provider abstraction — 4 real adapters, 1 honest stub, inactive by default. |
| 10 | Push provider abstraction — same shape, defaults to the already-live Web Push implementation. |
| 11 | Analytics — a real "Dismissed never actually tracked" bug found and fixed, conversion attribution. |
| 12 | Accessibility — computed contrast ratios, real ARIA/focus fixes. |
| 13 | Performance — indexes, cleanup jobs (previously nonexistent), one N+1 fixed. |
| 14 | Security — deep-link and preference-bypass defense-in-depth, one inaccurate comment corrected. |
| 15 | Testing — three dead files removed, a genuinely new scheduler-test category added. |
| 16 | Documentation — the four living reference docs brought current. |
| 17 | This document, plus a **second, larger N+1** the final pass caught that Phase 13's own dedicated pass missed (see `PERFORMANCE_AUDIT.md`). |

## Real bugs found and fixed across the whole sprint (consolidated list)

Stated together here because their pattern is worth seeing as a set,
not just individually per-phase:

1. **Phase 8**: partner-reminder cooldown queries filtered on
   `notification_logs.created_at` — a column that has never existed on
   that table. The cooldown had likely never actually worked.
2. **Phase 8**: a real race condition in the daily scheduler's
   duplicate-prevention — fixed with an atomic conditional claim.
3. **Phase 11**: "Dismissed" tracking never actually recorded anything
   — the service worker's dismiss button silently skipped reporting it,
   and no `notificationclose` listener existed at all.
4. **Phase 13**: `deactivateSubscription()` never touched `updated_at`,
   and no DB trigger auto-maintains it — the timestamp meant to answer
   "how long inactive" was meaningless.
5. **Phase 14**: a security comment asserting `notification_logs` has
   no UPDATE RLS policy — factually wrong; one has existed since Sprint
   15.
6. **Phase 17 (final pass)**: `canSendNotificationToUser()` called once
   per user inside three scheduler loops — the largest-blast-radius N+1
   in this sprint, hiding inside a function call rather than visible at
   the loop.

The common thread across most of these: **bugs hiding behind an
assumption that was never re-verified** (a column that was assumed to
exist, a cooldown assumed to be working because the code *looked*
right, a comment assumed accurate because it sounded confident). This
is the same lesson Sprint 22's own security audit drew from its
findings, holding again here.

## Honest gaps — never fabricated as complete

- **"Subscription renewal" and "Referral joined"** from the original
  sprint brief's Phase 2 examples were never built — no
  subscription/billing concept and no referral feature exist anywhere
  in this codebase. Documented from Phase 3 onward rather than
  fabricated.
- **Digest frequency batching** (`hourly`/`daily`/`weekly` beyond
  `immediate`) is persisted but not enforced — real batching-engine
  work, explicitly Phase 5-and-later scope, not built.
- **SES and APNs** are documented stubs, not working adapters — AWS
  SigV4 and APNs' HTTP/2 requirement are both judged too risky to
  hand-roll without the ability to test against real infrastructure.
- **No live provider round-trip has ever been verified** against real
  email/push infrastructure for any of the 8 non-default adapters —
  every one is tested at the request-building level only (see
  `docs/SPRINT27_PHASE15_TESTING.md`'s `it.todo()` list for exactly
  what real verification would look like).

## Verified (actually run in this sandbox, this phase)

- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors from before Phase 3 remain, confirmed still present
  and still unrelated to any Sprint 27 file.
- `npx vitest run` (full suite) — 495 passed, 85 todo, 0 failed.
- Every count in the Inventory table above was produced by an actual
  command run against the current source this phase, not recalled.
