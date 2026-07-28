# SPRINT_27_SUMMARY.md — Notification & Communication System

Final close-out document. Read alongside the four companion audits
(`NOTIFICATION_AUDIT.md`, `PERFORMANCE_AUDIT.md`, `SECURITY_AUDIT.md`,
`ACCESSIBILITY_AUDIT.md`) and the 14 per-phase docs
(`docs/SPRINT27_PHASE{3-16}_*.md` — Phases 1–2 predate this
conversation's written record, Phase 17 is this document itself) for
full detail. This file is the orientation read: what shipped, what was
verified, what's honestly still open.

## What this sprint built

SaveQuest had a working but narrow notification system before Sprint
27: push delivery, a basic inbox, six preference categories, and a
Monday-only weekly summary. Sixteen phases later:

- **23** notification types (up from ~18), spanning smart reminders,
  digests, social actions, and group activity.
- **11** preference categories, plus quiet hours, vacation mode, and a
  digest-frequency setting.
- **7** schedulers, orchestrated from one cron entry point, hardened
  against concurrent-invocation races and duplicate sends.
- A **centralized template registry** (33 keys) — zero hardcoded
  notification strings left anywhere in the codebase.
- **Pluggable email and push provider architecture** — 4 real email
  adapters, 4 real push adapters (plus the pre-existing live Web Push
  implementation), 2 honest documented stubs (SES, APNs) where hand-
  rolling the integration was judged too risky without live
  infrastructure to test against.
- **Real analytics** — Delivered/Opened/Dismissed/Clicked/Converted/
  Ignored, including fixing a bug where "Dismissed" had never actually
  been tracked despite the UI appearing to support it.
- **A weekly/monthly digest system** with persisted snapshots and a
  real detail page, not just push notifications.
- **Accessibility, performance, and security hardening**, each with a
  dedicated phase and real, verified findings — not a rubber-stamp
  pass.

## Architecture at a glance

```
Trigger (scheduler or request-time action)
  → lib/notificationTemplates.ts   (render title/body)
  → notification_logs row created  (in-app record, always)
  → lib/push/  or  lib/email/      (provider-abstracted delivery)
  → tracked (delivered/clicked/dismissed/opened/converted)
  → lib/notificationAnalytics.ts   (aggregate reporting)
```

Full detail in `docs/ARCHITECTURE.md`'s Notification architecture
section (rewritten this sprint, Phase 16).

## New database objects

4 new migrations this sprint (57 total in the project):
`20260723_notification_preferences_expansion.sql`,
`20260724_user_digests.sql`, `20260725_notification_analytics.sql`,
`20260726_notification_performance_indexes.sql`. One new table
(`user_digests`). `notification_logs` gained 5 columns across three of
these phases (`deep_link`, `archived_at`, `deleted_at` predate this
sprint from Sprint 17; `dismissed_at`, `converted_at` are new this
sprint). Two new composite indexes targeting the two hottest real query
shapes in the system.

## Testing

495 passing tests, 85 honestly-documented `it.todo()` scenarios, 0
failures, as of this document. A genuinely new test category was added
this sprint: real scheduler-orchestration tests (not just pure-function
unit tests), using an established Supabase-mocking pattern applied
carefully — only where the query shape was simple enough that an
inaccurate mock couldn't silently produce false confidence. Three dead,
orphaned test files (pure prose, zero real test blocks, already fully
superseded) were found and removed during this sprint's testing audit.
Full breakdown in `docs/SPRINT27_PHASE15_TESTING.md`.

## The pattern worth naming

Six real, previously-existing bugs were found and fixed across this
sprint (full list in `NOTIFICATION_AUDIT.md`), plus a seventh found in
this final phase alone. Almost every one of them shares a shape: **an
assumption that was never re-verified** — a column believed to exist
that didn't, a cooldown believed to work that silently never fired, a
security comment believed accurate that wasn't, an N+1 hidden behind an
innocuous function call rather than an obvious inline query. None of
these were found by looking for bugs in the abstract; all of them were
found by *reading the actual code* against a specific question each
phase's brief asked, and *computing or querying* an answer instead of
recalling one. That discipline — verify, don't assume; compute, don't
estimate; grep the real count, don't recall it — is the throughline
across all seventeen phases, not just a phase-17 audit habit applied
retroactively.

## Known limitations (honest, not hidden)

| Limitation | Where documented |
|---|---|
| SES and APNs adapters are documented stubs, not working code | Phases 9, 10 |
| No live provider round-trip verified against real infrastructure for 8 of 10 adapters | Phase 15 |
| Digest frequency batching (hourly/daily/weekly) persisted but not enforced | Phase 4 |
| `xp`/`referrals`/`product_announcements` preference categories gate nothing yet | Phase 4 |
| Conversion attribution wired to deposits only, not every notification type | Phase 11 |
| No durable job queue — once-daily single-request scheduler model | Phases 8, 13 |
| Archive/Delete touch targets below the 44px mobile guideline (above WCAG AA minimum) | Phase 12 |
| Preference enforcement has no direct unit test (indirect verification only) | Phase 15 |

## Recommended next steps, in priority order

1. Implement the two highest-value `it.todo()` integration scenarios
   (concurrent cron invocation, scheduler dedup) once a real test
   Supabase project is available — these verify Phase 8's core
   correctness claims behaviorally, not just by code reading.
2. A real APNs `send()` via Node's `http2` module or a library built on
   it — the JWT half is already done and cryptographically verified.
3. Extend conversion attribution beyond deposits to other real actions
   (partner check-ins, group joins) using the existing
   `attributeConversion()` pattern.
4. A durable retry/job queue for notification delivery, the real answer
   to this sprint's repeatedly-flagged "no queue exists" limitation.

## Closing note

Every phase in this sprint produced its own detailed doc with real
verification, and the final phase found one more genuine bug (the
largest-blast-radius N+1 in the whole sprint) that sixteen phases of
incremental, careful work still missed — which is itself the honest
point: a dedicated final audit pass earns its place, and "verified" one
phase ago doesn't mean "verified forever." Nothing in this sprint's
documentation claims more than what was actually checked.
