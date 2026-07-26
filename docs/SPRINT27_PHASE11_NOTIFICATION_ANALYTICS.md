# Sprint 27 — Phase 11: Notification Analytics

## 1. What this phase is

"Track: Delivered, Opened, Dismissed, Clicked, Converted, Ignored. Build
reporting hooks. Support future dashboards."

## 2. What already existed

More than a blank slate — this phase extended real, working
infrastructure rather than building analytics from scratch:
- `notification_logs` already had `delivered_at`, `clicked_at` (Sprint
  13) and `read_at` (Sprint 15).
- `public/sw.js` already tracked delivered (on `showNotification`
  success) and clicked (on `notificationclick`, excluding the dismiss
  action) via `/api/notifications/track`.
- `app/api/admin/notifications/route.ts` already existed as a real
  reporting endpoint — sent/delivered/clicked totals and rates, both
  overall and by notification type — consumed by a real admin dashboard
  panel (`app/(app)/admin/AdminClient.tsx`). This is genuinely a
  reporting hook the brief asks for; it just covered half the metrics.

## 3. Terminology mapping — stated explicitly, not left implicit

The brief names six things to track. Two needed new state; four map onto
what already existed:

| Brief's term | Maps to | New or existing? |
|---|---|---|
| Delivered | `delivered_at` | Existing (Sprint 13) |
| Clicked | `clicked_at` | Existing (Sprint 13) |
| Opened | `read_at` | Existing (Sprint 15) — the in-app inbox's read state IS "opened," reused under this phase's name rather than duplicated as a second column meaning the same thing |
| Dismissed | `dismissed_at` | **New column** — and a **real bug fixed** (§4) |
| Converted | `converted_at` | **New column** + new attribution logic (§5) |
| Ignored | *(computed, no column)* | Delivered, but none of clicked/read/dismissed/converted ever happened — a reporting category, not a tracked event |

## 4. Bug found and fixed: "Dismissed" was never tracked at all

Auditing `public/sw.js` for this phase surfaced a real gap: the
`notificationclick` handler explicitly checked `event.action !==
"dismiss"` before calling `trackEvent(...)` — meaning tapping the
"Dismiss" action button closed the notification and reported **nothing**.
There was also no `notificationclose` listener at all, so a notification
swiped away or closed via the OS's own controls (without the in-app
action buttons) was equally invisible. Every notification this app has
ever sent has `dismissed_at` permanently null, not because nothing was
ever dismissed, but because dismissal was never wired up.

**Fixed**, two ways:
1. The dismiss action button now calls `trackEvent(notificationId,
   "dismissed")` instead of silently skipping.
2. A new `notificationclose` listener catches dismissals that don't go
   through the action button at all (swipe-away, OS-level close).

**Honest caveat, not glossed over:** `notificationclose` browser support
is real but inconsistent — it does not fire for notifications closed
automatically when the tag is reused via `renotify`, and some platforms
don't fire it for auto-expired notifications. This is a real, additive
signal, not a guarantee of catching every dismissal. Documented in
`public/sw.js`'s own comments and here, not presented as complete
coverage.

The two dismiss-tracking paths can both fire for the same dismiss (the
action button closes the notification, which then also triggers
`notificationclose`) — harmless by design: `/api/notifications/track`'s
write is idempotent (`.is(column, null)`), so the second report is a
no-op, not a double-count.

## 5. "Converted" — new, and honestly scoped to one real call site

`lib/notificationAttribution.ts`'s `attributeConversion()` finds the
most recently *clicked* (not just delivered) notification of a relevant
type for a user within a time window and marks it `converted_at`. Wired
into exactly one real call site this phase: **deposit creation**
(`app/api/transactions/route.ts`), fire-and-forget, `.catch()`'d, never
awaited — the same pattern every notification send in this codebase
already uses, so a failure here can never affect the deposit it's
attributing (which has already succeeded by the time this runs).

**Why deposits, and why not all ~30 notification types:** "a deposit
shortly after clicking a savings reminder" is this app's single most
valuable and unambiguous conversion signal, consistent with the
product framing this whole sprint has used. Wiring every other
plausible conversion (a partner nudge → the partner logging in, a group
invite → someone joining) would apply the exact same pattern at each of
those actions' own call sites — straightforward now that the helper
exists, genuinely not done. Flagged as recommended follow-up (§8), not
silently claimed as comprehensive.

**Known limitation, stated plainly:** attribution is a heuristic
(freshest click within 24 hours wins), not a certainty. A user who
clicked two relevant reminders and then deposited gets that deposit
attributed to whichever was clicked more recently — a reasonable
default, not a claim of precise causality.

## 6. `lib/notificationAnalytics.ts` — the reporting hook

Pure computation, same pattern as `lib/reminderEngine.ts` /
`lib/digest.ts`: `countEngagement()`, `computeEngagementRates()`,
`computeEngagementBreakdown()`, `computeEngagementByType()`. Rates are
each computed against the denominator that makes them meaningful, not
uniformly against `sent`:
- Click/open/dismiss/ignored rate: against `delivered` (you can't click,
  open, dismiss, or ignore something that was never shown).
- Conversion rate: against `clicked` (conversion is defined as following
  through on a click, not a coincidental deposit with zero notification
  interaction).

This is the actual "reporting hook" the brief asks for — a future
dashboard (or a different admin view, or an export, or an alert) calls
these same functions with a fresh set of rows; nothing about the
computation is coupled to the admin API route that happens to call it
today.

## 7. `app/api/admin/notifications/route.ts` — extended, not rebuilt

Now selects all six engagement columns and calls the new analytics
module instead of recomputing a sent/delivered/clicked-only subset
inline. `NotificationMetrics` (the shared type) gained the new fields
additively — every field the type had before this phase is still there,
unchanged, so nothing that already read `delivery_rate`/`click_rate`/
`by_type[].sent` etc. broke. `AdminClient.tsx` gained four new metric
cards (open/conversion/dismiss/ignored rates) and a third per-type line
(conversion rate), in the same visual style as the existing two.

## 8. Verified / recommended / future work / known limitations

**Verified** (actually run in this sandbox):
- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors from before Phase 3 remain.
- `npx vitest run` (full suite) — 471 passed, 0 failed (up from 460
  before this phase — the +11 are `tests/unit/notificationAnalytics.test.ts`).
- The analytics module's rate calculations are specifically tested
  against the "which denominator" design decision (§6) — e.g. a
  fixture with 10 sent, 5 delivered, 5 clicked asserts a 100% click
  rate (5/5 delivered), not 50% (5/10 sent), to catch exactly the kind
  of subtle-but-wrong metric a less careful implementation could ship.
- The "ignored" classifier is tested against both a genuinely-ignored
  row (delivered, nothing else) and an undelivered row (never shown at
  all) to confirm the latter isn't miscounted as ignored — an easy
  off-by-one-concept bug this test would have caught.

**Recommended, not yet built:**
- Conversion attribution for other real actions beyond deposits (§5) —
  partner check-ins, group joins, quest completions — using the same
  `attributeConversion()` helper at each action's own call site.
- A `notificationclose`-driven dismiss signal is real but incomplete
  (§4) — a periodic reconciliation job (e.g. "delivered >24h ago, still
  no clicked/read/dismissed/converted → probably dismissed, mark it so"
  as a lower-confidence inferred signal) could improve coverage for
  platforms that don't fire the event reliably.

**Future work (explicitly out of scope for Phase 11):**
- Time-series/trend views (this week vs. last week) — the current admin
  panel and analytics module compute all-time totals only; the
  underlying rows have `sent_at` for a future date-range filter to use,
  but no UI or query for it exists yet.
- Export/CSV of the metrics for external BI tools — "support future
  dashboards" is satisfied by the reporting hook existing and being
  reusable (§6), not by building a second consumer of it this phase.

**Known limitations:**
- Conversion attribution heuristic (§5) — freshest click wins, not
  precise causal attribution.
- `notificationclose` browser support gaps (§4) — real signal, not
  complete coverage.
- The admin metrics route still queries the entire `notification_logs`
  table with no date-range filter or pagination — fine at this app's
  current scale, a real scaling concern once the table grows large
  enough that Phase 13 (Performance) would need to revisit it.
