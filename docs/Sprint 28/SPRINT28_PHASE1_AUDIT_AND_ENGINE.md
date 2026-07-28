# Sprint 28 — Financial Intelligence Engine: Audit + Phase 1 Delivery

## 1. What this document is

The Sprint 28 brief asked for a from-scratch "Financial Intelligence
Engine" across 17 phases. Before writing any code, the brief's own rule
("audit before building, never duplicate, extend don't replace") was
applied to itself. This document records that audit, then covers what was
actually built this round: the three genuine gaps the audit found, plus
closing a real gap in the migration rollback history.

## 2. The audit

A full-repo pass over `lib/`, `app/api/`, and `docs/` found that most of
what Sprint 28 asked for already exists, built and shipped across Sprints
19–24:

| Sprint 28 ask | Already exists as | Sprint |
|---|---|---|
| User financial profile | `lib/analyticsEngine.ts` | 19 |
| Predictive forecasting | `lib/forecast.ts` (including a single-scenario what-if, `whatIfWeeklyDelta`) | 19 |
| Trend detection | `lib/trends.ts` | 19 |
| Financial health score | `lib/goalHealth.ts` (per-goal) + `lib/accountHealth.ts` (account-level) | 19–20 |
| Intelligent insights | `lib/insights.ts` | 19 |
| Goal optimization / recommendations | `lib/recommendations.ts` | 20 |
| Behavioral profiling | `lib/financialPersonality.ts`, `lib/behaviorProfile.ts` | 20–21 |
| Risk/intervention detection | `lib/riskEngine.ts`, `lib/interventions.ts` | 21 |
| Category-level intelligence | `lib/categoryIntelligence.ts` | 24 |
| Coaching messages | `lib/coaching.ts` | 19 |
| Portfolio dashboard assembly | `lib/portfolioSummary.ts` | 20 |

None of this was rebuilt. Doing so under a new "Financial Intelligence
Engine" name would have been exactly the parallel-system duplication the
brief itself says never to create.

**Confirmed gaps** (grepped for, not found anywhere in `lib/` or `app/`):

- A scenario/what-if simulator beyond the single existing `whatIfWeeklyDelta()`
- A financial health score using the specific 6-tier scale the brief asks
  for (Excellent/Great/Healthy/Improving/Needs Attention/Critical) — the
  existing scores use a 4-band scale (Excellent/Good/Needs Attention/At
  Risk)
- A portfolio-wide (not per-goal) cash flow / quarter-ahead projection

This round built those three, plus closed an unrelated but real gap found
during the audit: `supabase/migrations/rollback/` only went up to
`062_down.sql` even though migrations run through `066` at the time of
this audit — four shipped migrations (063–066) had no rollback file.

## 3. What shipped this round

### 3.1 `lib/scenarioSimulator.ts` — Scenario Simulator (Phase 8)

Built on top of `lib/forecast.ts`'s existing `forecastGoal()` and
`whatIfWeeklyDelta()` rather than re-deriving pace/forecast arithmetic.
Four scenario types:

- `weekly_delta` — thin wrapper over the existing `whatIfWeeklyDelta()`.
- `skip_payment` — one-off delay equal to the time needed, at current
  pace, to earn back one average-sized deposit. Documented assumption:
  the skipped deposit is the goal's own historical average, not an
  invented number.
- `cadence_change` — e.g. "switch to biweekly." Keeps the historical
  average deposit *amount* fixed, recomputes weekly pace for the new
  interval, then reuses `whatIfWeeklyDelta()`.
- `lump_sum` — reuses `forecastGoal()` directly against a cloned goal
  with the lump sum pre-applied to `current_amount`, so it shares the
  exact same pace/remaining math as every other forecast in the app.

Never mutates its inputs (see the isolation test in
`tests/unit/scenarioSimulator.test.ts`). `simulateStandardScenarios()`
provides sensible defaults for a goal's "what if" panel; `simulateScenarios()`
takes custom inputs for callers that need them.

### 3.2 `lib/financialHealthScore.ts` — Financial Health Score (Phase 5)

Deliberately additive, not a replacement for `lib/accountHealth.ts`.
`computeAccountHealth()` is used today by the dashboard, `lib/interventions.ts`,
and `lib/portfolioSummary.ts` — widening its factor list or renaming its
bands in place would silently change point totals and 4-band statuses
those call sites (and their existing tests) depend on.

Instead, `computeFinancialHealthScore()` calls `computeAccountHealth()`,
takes its six existing factor scores, **rescales each proportionally** to
a new weight (the underlying formula in `accountHealth.ts` is never
re-derived, only its share of the 100-point total changes), and adds two
new factors:

- **Emergency readiness** (10 pts) — funded-ness of the user's `emergency`
  category goal, if one exists. No emergency goal = 0 pts + a
  recommendation, not a fabricated neutral default.
- **Goal diversification** (10 pts) — number of distinct categories among
  *active* goals, scaled to a max at 4+ categories.

Six-tier scale (distinct from `accountHealth.ts`'s 4-band scale, which is
unchanged and still used everywhere it already was):

```
Excellent        90–100
Great             80–89
Healthy           65–79
Improving         50–64
Needs Attention   30–49
Critical           0–29
```

### 3.3 `lib/cashFlowProjection.ts` — Cash Flow Intelligence (Phase 10)

Portfolio-wide (all goals, not one) 30/60/90-day projection. Reuses
`forecast.ts`'s own pace formula rather than copying it — `recentWeeklyPace()`
and `PACE_WINDOW_WEEKS` were exported from `forecast.ts` (previously
private) specifically for this reuse.

Explicitly out of scope, documented in the module itself: this app has no
expense/income tracking, only savings deposits/withdrawals, so "cash flow"
here means "projected additional savings," not a full income/expense
model. Withdrawals are netted out of `currentBalance` (a real balance
figure must reflect them) but are not subtracted from the pace projection,
since assuming future withdrawal behaviour would be an invented number.

`fundableWithinQuarter` lists active goals whose remaining amount could be
covered by the quarter's projected savings *on their own* — explicitly not
a claim that all listed goals could be funded simultaneously at that pace,
which would double-count the same projected dollars.

### 3.4 `lib/financialHealthSnapshot.ts` + `/api/cron/financial-health-snapshot`

Persistence layer for the health score's trend history. The pure scoring
function in 3.2 answers "what's the score right now" with no storage
needed; a dashboard trend/sparkline needs "what was the score on each of
the last N days," which can't be cheaply recomputed retroactively (no
point-in-time tables in this schema). A daily cron job, following the
exact same pattern as `runWeeklySummaryScheduler()` in `lib/notifications.ts`
(per-user loop, per-user try/catch, service-role client), writes one
upserted row per user per day. Users with zero deposit history are skipped
— a flat ~50 score for a brand-new user is noise on a trend chart, not
signal. Registered in `vercel.json` at `0 10 * * *`.

### 3.5 Migration 067 + rollback

`financial_health_score_snapshots` — one row per user per UTC date, unique
constraint enforced, RLS scoped to the owning user, written only by the
service-role cron (same "server decides, client reads" shape as
`user_digests`, migration 064). `factors` stored as `jsonb`, matching the
same reasoning migration 064 used for its own payload column.

### 3.6 Missing rollbacks (063–066)

Wrote `063_down.sql` through `066_down.sql`, matching this project's
existing rollback style and warning conventions (see `rollback/062_down.sql`
for the precedent). Note for the requester: the project's migrations
actually run through **066**, not 062 — the rollback folder was the piece
that stopped at 062.

## 4. Testing

New test files, following this project's existing conventions exactly
(same `tx()`/`goal()` fixture helpers as `tests/unit/forecast.test.ts`):

- `tests/unit/scenarioSimulator.test.ts` — 12 tests, covering all four
  scenario types, the no-mutation guarantee, and insufficient-data paths.
- `tests/unit/financialHealthScore.test.ts` — 8 tests, covering the
  100-point factor sum invariant, tier boundaries, and both new factors.
- `tests/unit/cashFlowProjection.test.ts` — 7 tests.

All three files were run against the actual project (`npm install` +
`npx vitest run`), not just written and assumed correct. One real bug was
found and fixed during this process: `simulateScenario`'s `weekly_delta`
case didn't distinguish "no baseline pace at all" from "the adjusted pace
hit zero or below" — both produced a generic message instead of the
correct one for each case. Fixed, then verified.

**Full suite result after the fix:** `npx vitest run --project unit` — 51
test files, 469 tests, all passing (13 pre-existing `todo` integration
suites skipped, unrelated to this work). `npx tsc --noEmit` — clean for
every file touched or added this round.

**Known pre-existing issue, unrelated to this work:** `tsc --noEmit`
reports two type errors in `tests/unit/categoryIntelligence.test.ts` and
`tests/unit/exportCenter.test.ts` (a goal fixture missing `is_primary`).
Neither file was touched this round; flagging honestly rather than
silently leaving it undocumented.

## 5. Known limitations / honest gaps remaining

- No UI has been wired up yet for any of the three new modules — this
  round is the engine layer only (Phase 2's Raw Data → Metrics → Insights
  → Recommendations → Presentation split: everything shipped so far is
  Metrics/Insights, not Presentation).
- Phases 6/7/9/12–17 of the original 17-phase brief were not attempted
  this round because their substance already exists (insights, goal
  optimization, trend detection — see the audit table) or is process
  (testing/docs, partially covered here) rather than new code to write.
- `computeFinancialHealthScore()`'s emergency-readiness factor assumes
  exactly one meaningful `emergency`-category goal; a user with several
  emergency goals is scored on whichever is best-funded, not their sum —
  documented in the module's own comment, not hidden.

## 6. Next steps

- Wire `computeFinancialHealthScore()` and `projectCashFlow()` into a
  dashboard card (Phase 11).
- Wire `simulateStandardScenarios()` into a goal detail page "what if"
  panel (Phase 8's UI half).
- Accessibility pass on whatever UI gets built (Phase 14) — nothing to
  audit yet since no UI exists.
