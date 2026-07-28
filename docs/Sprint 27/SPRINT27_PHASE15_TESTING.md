# Sprint 27 — Phase 15: Testing

## 1. What this phase is

"Unit tests, Component tests, Integration tests, Scheduler tests,
Failure tests, Retry tests, Notification routing, Preference
enforcement, Deep links, Accessibility. Document honest TODOs where
infrastructure is unavailable."

Every phase in this sprint already added tests as it went — this phase
is the dedicated audit pass: take stock of what exists against each of
the ten named categories, fix real hygiene problems found along the
way, add genuinely new coverage where a good opportunity existed, and
write down, explicitly, what still can't be tested here and why.

## 2. Found and fixed: three dead, orphaned test files

Auditing `tests/integration/` turned up `notification-delivery.spec.ts`
— a `.spec.ts` file (not `.test.ts`) containing pure prose/pseudocode
scenarios, zero real `describe`/`it()` blocks, and **not even included
in Vitest's test glob** (`vitest.config.ts` only picks up
`*.test.ts`/`*.test.tsx`). It was already fully superseded: the current
`notification-delivery.test.ts`'s own header comment states plainly,
*"Same issue as the other two integration files: dead `.spec.ts` prose,
never executed. Converted to `it.todo(...)`."* — meaning this exact
cleanup had already been done for its content back in Sprint 18, and
the original file was simply never deleted afterward.

That comment's *"other two"* turned out to be real too:
`quest-completion-flow.spec.ts` and `transaction-flow.spec.ts`, both
equally dead (0 real test blocks each) and both already fully
superseded by their own `.test.ts` counterparts, which already exist
and run. **All three were deleted.** This isn't notification-specific
scope creep — it's the same class of issue, found while auditing the
notification test file specifically, and leaving two of three dead
files in place while fixing only the notification one would have been
an inconsistent, arbitrary line to draw.

## 3. New: real scheduler-level tests (a genuinely new coverage category)

Every scheduler function in `lib/notifications.ts`
(`runDailyNotificationScheduler`, `runWeeklySummaryScheduler`, etc.) had
**zero** automated test coverage before this phase — consistent with
this codebase's established boundary that DB-orchestration code gets
documented manual-verification TODOs, not unit tests, since it needs a
real database to fully verify.

This phase found a way to add real, honest coverage anyway, for one
scheduler: `runNotificationLogsCleanupScheduler()` (Phase 13). Using
this codebase's **other** established pattern — mocking the Supabase
client itself (`tests/unit/businessMetrics.test.ts`,
`tests/unit/recordOutcome.test.ts` already do this) — 6 new tests in
`tests/unit/notificationCleanupScheduler.test.ts` verify the actual
orchestration logic: correct count aggregation across all three purges,
and critically, that **a failure in one purge doesn't prevent the other
two from running** — the entire reason Phase 13 used three separate
`try`/`catch` blocks instead of one. That design decision was previously
only backed by a code comment explaining the intent; now it's backed by
a test proving the intent is actually what the code does.

**Why this scheduler and not the others**: it was the best-suited
candidate — three independent, simple `delete()` calls with minimal
branching, versus the daily scheduler's much larger surface (many
chained queries, per-user branching across 8 checks) where an
inaccurate mock would risk producing a test that *looks* like coverage
but doesn't actually verify real behavior — arguably worse than no test
at all, since it would create false confidence. This is a considered
scope boundary, not an oversight — see §7 for what's still open.

## 4. New: extended the integration-test TODO list for Phases 8–14

Six new `it.todo(...)` entries added to
`tests/integration/notification-delivery.test.ts`, each specifying seed
state, action, and exact assertions precisely enough to implement
directly, covering gaps from this sprint's later phases that had no
placeholder at all until now:

- **Phase 8**: a genuinely *concurrent* (not just sequential) double
  cron invocation doesn't double-send — the exact race
  `tryClaimDailyNotificationSlot()` was built to close, which
  fundamentally requires two real overlapping database transactions to
  verify (no mock can substitute for that).
- **Phase 8**: the weekly/monthly/group-summary schedulers' dedup
  actually prevents a double-send across two real invocations.
- **Phase 9**: a real email send through a real configured provider
  (Resend, with disposable test credentials) — the one thing the unit
  tests structurally cannot verify, since they only test request
  *building*, never real network delivery.
- **Phase 10**: the same, for a real push send through Expo (chosen as
  the simplest of the four alternative adapters — no OAuth flow, no
  HTTP/2 requirement).
- **Phase 11**: `attributeConversion()` correctly attributes a real
  deposit to a real preceding click, and correctly does *not* attribute
  one with no relevant click.
- **Phase 4/14**: end-to-end confirmation that a disabled preference
  category genuinely blocks delivery via a live cron run — explicitly
  flagged as the honest counterpart to §7's decision not to force a
  risky mocked version of this.

## 5. Coverage against each of the ten named categories

| Category | Status |
|---|---|
| **Unit tests** | Extensive — 161 tests across 12 files for pure notification logic alone (`reminderEngine`, `digest`, `notificationTemplates`, `notificationAnalytics`, `notifications` pure helpers, `notificationTaxonomy`, `notificationGrouping`, `notificationActions`, `webpush`, `emailProvider`, `pushProvider`, plus this phase's new `notificationCleanupScheduler`). |
| **Component tests** | `Toggle.test.tsx` (6 — switch semantics, the exact thing Phase 12 found missing on the un-migrated instance), `BarSeries.test.tsx` (3 — the Phase 12 accessible-chart fix). Not every notification component has one — see §7. |
| **Integration tests** | `notification-delivery.test.ts` — 13 `it.todo()` scenarios (7 pre-existing + 6 new this phase), each specified precisely enough to implement directly once real test infrastructure exists. Honestly incomplete by design (§4), not silently claimed as done. |
| **Scheduler tests** | New this phase (§3) — previously zero, now real coverage for one scheduler with the mocking technique proven; the rest remain `it.todo()`. |
| **Failure tests** | `notificationCleanupScheduler.test.ts`'s per-purge failure isolation (§3); `pushProvider`/`emailProvider` tests cover permanent-vs-transient failure classification per provider. |
| **Retry tests** | `webpush.test.ts`'s `isRetryable()` — every branch (success, permanent 4xx, permanent 410/404, retryable 5xx/429/408, network error with no status). |
| **Notification routing** | `notificationActions.test.ts`'s `resolveNotificationHref()` suite, including this sprint's own Phase 6 deep-link-specificity tests and Phase 14's security-validation tests (see next row — routing and deep-link validation share the same test suite since they're the same function). |
| **Preference enforcement** | Tested only *indirectly* — see §7 for why a direct test wasn't forced this phase, and the new `it.todo()` in §4 for the honest live-verification plan. |
| **Deep links** | `notificationActions.test.ts` — both the Phase 6 specificity tests (goal/group/achievement links resolve correctly) and the Phase 14 security tests (absolute URLs, protocol-relative URLs, and `javascript:` URLs are all rejected). |
| **Accessibility** | `Toggle.test.tsx` (switch role/state), `BarSeries.test.tsx` (chart `role="img"` summary + hidden data table). `AchievementsClient`'s Phase 12 focus-management fix has no dedicated component test — see §7. |

## 6. Verified (actually run in this sandbox)

- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors from before Phase 3 remain.
- `npx vitest run` (full suite) — **489 passed, 85 `.todo()`, 0 failed**
  (up from 483 passed / 79 todo before this phase — +6 real tests, +6
  honest todos, and 3 fewer files after the dead-file cleanup).
- Manually confirmed all three deleted `.spec.ts` files were (a) not
  matched by Vitest's `include` glob, (b) not referenced anywhere else
  in the codebase (`grep` across `.ts`/`.tsx`/`.json`/`.md`), and (c)
  each had a real `.test.ts` counterpart already covering the same
  scenarios, before deleting any of them.
- The new scheduler tests were checked against the actual
  `runNotificationLogsCleanupScheduler()` implementation's exact call
  order (notification_logs deleted from twice, in a specific sequence)
  to ensure the mock's call-counting logic matches real behavior, not
  an assumed one.

## 7. Honest TODOs — infrastructure genuinely unavailable

Stated plainly, not glossed over:

- **No real database, browser, or network egress exists in this
  sandbox.** Every `it.todo()` across `notification-delivery.test.ts`
  needs a dedicated test Supabase project, seeded users, and (for the
  provider ones) real API credentials — none of which this environment
  has or could safely fabricate.
- **Preference enforcement has no direct unit test.** `getPref()` and
  `canSendNotificationToUser()` aren't exported, and accurately mocking
  the full `sendToUser()` dependency chain (vacation check → master
  switch → push subscription fetch → log creation → per-subscription
  send) carries real risk of the mock silently diverging from actual
  Supabase query-builder behavior — a test built on an inaccurate mock
  is worse than no test, because it creates false confidence rather
  than none. Verified instead via code reading across Phases 4/8/14 (a
  uniform pattern, checked repeatedly), and flagged as a live-cron
  `it.todo()` in §4 for when real infrastructure exists.
- **Component tests don't cover every notification UI surface.**
  `NotificationCenter`, `NotificationSettings`,
  `NotificationPreferencesClient`, `DigestClient`, and `AchievementsClient`
  have no dedicated component tests — each requires mocking
  Supabase-backed data fetching (and in some cases `useSearchParams`),
  and no established fetch-mocking convention exists yet in
  `tests/component/` to build on safely. `Toggle` and `BarSeries` were
  chosen specifically because they're close to pure/presentational,
  making them low-risk, high-confidence additions; the others are a
  larger, separate lift flagged as recommended follow-up, not
  attempted here under time pressure that could produce a
  fragile/inaccurate mock.
- **No live push/email delivery has ever been verified against real
  provider infrastructure**, for any of the six providers built across
  Phases 9–10 (Resend, SendGrid, Postmark, Mailgun for email; Expo,
  OneSignal, Firebase for push, plus the existing Web Push
  implementation). Every one of them is tested at the request-building
  level only. Two of the highest-value real round-trips are now
  specified as `it.todo()` (§4); the rest remain implicitly covered by
  the same documented gap.

## 8. Recommended / future work

**Recommended:**
- Establish a fetch-mocking convention in `tests/component/` (even a
  small shared helper) specifically to unblock testing
  `NotificationCenter` and friends — the components most in need of
  coverage are exactly the ones blocked on this.
- Once a real test Supabase project exists, implement the 13
  `it.todo()` scenarios in priority order: the two concurrency/race
  ones (§4) are the highest-value, since they verify Phase 8's core
  correctness claims behaviorally, not just by code reading.

**Future work (explicitly out of scope for Phase 15):**
- Load/stress testing the daily scheduler against a realistically large
  user base — a performance-testing concern, not a correctness one,
  better suited to Phase 13's territory revisited at a later date than
  this phase's scope.
- End-to-end browser testing (Playwright or similar) of the actual push
  notification permission flow, click-to-navigate behavior, and service
  worker lifecycle — `e2e/settings.spec.ts` exists as a start for
  settings-page flows but nothing exercises the service worker's own
  `notificationclick`/`notificationclose` handlers in a real browser.
