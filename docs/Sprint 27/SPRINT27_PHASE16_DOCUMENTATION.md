# Sprint 27 — Phase 16: Documentation

## 1. What this phase is

"Update: Architecture, Notification flow, Scheduler flow, Preference
system, Email architecture, Push architecture, Future provider
integration, Testing strategy."

Fifteen phases each already produced their own detailed
`SPRINT27_PHASE{N}_*.md` doc — those are the historical record of what
changed and why. What was still stale: the **living, general-audience**
docs (`ARCHITECTURE.md`, `API.md`, `DATABASE.md`, `DEVELOPMENT.md`) that
a new engineer reads first, none of which had been touched since well
before this sprint. This phase updates those, rather than writing a
17th phase-specific doc — extending existing documentation, not
duplicating it, the same "reuse, don't rebuild" principle this whole
sprint has applied to code.

## 2. Audit: how stale were they?

Read literally, not assumed. `ARCHITECTURE.md`'s "Notification
architecture" section still said: *"one row per user, six category
booleans"* (actually 11, since Phase 4) and described only two delivery
paths — a daily cron and a Monday-only weekly summary (actually seven
distinct schedulers as of Phase 13, with a monthly digest, partner
reminders, group summaries, group-quest-ending reminders, and a Sunday
cleanup job). No mention anywhere of email architecture, push-provider
abstraction, templates, analytics, or any of Phase 14's security
hardening — all of it postdates the last time this section was written.
`API.md` was missing `/archive`, `/delete`, and the admin analytics
route entirely, and its Cron table still described the pre-Phase-13
scheduler set. `DATABASE.md` had the same stale "six category booleans"
claim, no mention of `user_digests`, and a notification_logs column
list missing five of the columns added since Sprint 16.

## 3. What changed

**`docs/ARCHITECTURE.md`** — the "Notification architecture" section
was rewritten in full, organized under the sprint brief's own eight
named sub-topics as subsections (Notification flow, Scheduler flow,
Preference system, Email architecture, Push architecture, Future
provider integration, Testing strategy, plus Analytics and Data
retention as natural additions the brief's list implies but doesn't
name outright). Each subsection is a current-state summary with
pointers into the relevant `SPRINT27_PHASE*.md` doc for full reasoning,
not a repeat of that reasoning — keeping this file useful as a fast
orientation read rather than a second copy of fifteen phases' worth of
detail. The existing Security model section also gained one paragraph
covering Phase 14's two hardening fixes, since that's exactly where a
reader would look for them.

**`docs/API.md`** — the Notifications table gained the four routes it
was missing (`/archive`, `/delete`, `/admin/notifications`, plus a note
on why digests have no separate route) and a note on the new `?days=`
parameter (Phase 13). The Cron table now describes the real seven-
scheduler system instead of "daily + Monday-only weekly."

**`docs/DATABASE.md`** — the Notifications section now lists all four
tables (including `user_digests`, previously absent entirely), the
correct category count (11, not 6), and the full current
`notification_logs` column list, with a callout to the real `created_at`
bug Phase 8 found and fixed (a query filtering on a column that never
existed on that table). The pre-existing "residual RLS gap" note
(columns an UPDATE can touch aren't restricted by RLS) was updated to
name the current column list, including `dismissed_at`, which is now
also client-writable via `/track` and wasn't when that note was
originally written. Top-of-file counts were corrected using an actual
`ls` count of migration files (57) rather than left at the stale
"Sprint 18" number — and where an exact updated table/policy count
wasn't independently verified this phase, the note says so explicitly
(dated to Sprint 18, with the one known addition called out separately)
rather than asserting a precise new total that wasn't actually counted.

**`docs/DEVELOPMENT.md`** — the environment variable table gained
`EMAIL_PROVIDER` and `PUSH_PROVIDER` (both optional, both documented as
inert by default, pointing to `.env.local.example` for the full
per-provider variable list rather than duplicating it here). The
"Writing new tests" section gained a paragraph on the scheduler-mocking
pattern Phase 15 established (mock Supabase directly, but only where
the query shape is simple enough that the mock can't silently diverge
from real behavior — otherwise prefer an honest `it.todo()`), matching
this file's existing convention of pointing to specific example test
files rather than describing the pattern abstractly.

## 4. What this phase deliberately did not do

- **Did not rewrite any of the fifteen `SPRINT27_PHASE*.md` docs.**
  Those are a historical record — what was found, what was decided, and
  why, at the time each phase happened. Editing them after the fact to
  "clean them up" would erase exactly the kind of reasoning-in-context
  this sprint's engineering rules have consistently valued. This phase
  only touched the docs that are meant to describe *current* state.
- **Did not duplicate detailed reasoning into the general docs.** Every
  new claim in `ARCHITECTURE.md`'s rewritten section links back to the
  phase doc that actually established it, rather than re-explaining
  (and risking re-explaining slightly differently, drifting out of
  sync) the full reasoning inline.
- **Did not fabricate precise counts that weren't independently
  verified this phase** — see §3's note on `DATABASE.md`'s table/policy
  totals.

## 5. Verified / recommended / future work

**Verified** (actually checked in this sandbox):
- Every route named as newly added to `API.md` was confirmed to exist
  via the actual file tree (`app/api/notifications/archive/route.ts`,
  `/delete/route.ts`, `app/api/admin/notifications/route.ts`), not
  assumed from memory of having built them.
- The migration file count (57) was produced by an actual `ls | wc -l`
  against `supabase/migrations/`, not estimated.
- `npx tsc --noEmit` and `npx vitest run` were both re-run after these
  doc-only changes to confirm nothing was inadvertently touched: 0 new
  type errors (same 2 pre-existing, unrelated ones), 489 passed / 85
  todo / 0 failed — identical to Phase 15's end state, as expected for
  a documentation-only phase.

**Recommended, not yet built:**
- A similar pass over any other general docs this sprint touched only
  implicitly (e.g. if a `SECURITY.md` or `TESTING.md` exists elsewhere
  in the repo outside `docs/` — not found during this phase's search,
  but worth a second look if one surfaces later).

**Future work (explicitly out of scope for Phase 16):**
- Phase 17's final audit docs (`NOTIFICATION_AUDIT.md`,
  `PERFORMANCE_AUDIT.md`, `SECURITY_AUDIT.md`,
  `ACCESSIBILITY_AUDIT.md`, `SPRINT_27_SUMMARY.md`) are that phase's
  job, not this one's — this phase updated *ongoing* reference
  documentation, not the sprint's closing audit deliverables.
