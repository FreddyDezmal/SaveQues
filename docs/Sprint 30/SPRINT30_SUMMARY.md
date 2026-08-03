# SPRINT30_SUMMARY.md — Premium Experience & Monetization (Feature Activation)

## Audit outcome (Phase 1)

Sprint 29 built the billing platform end to end; this sprint's Phase 1
audit found almost none of it actually connected to the app. Verified
directly against the repository, not assumed:

- `components/billing/{LockedCard,UpgradePrompt}.tsx` had **zero**
  imports outside their own files.
- `PremiumBadge` was rendered only inside the billing settings page
  itself — nowhere else in the app.
- `ai_coaching`, `scenarios_limit`, and `exports_limit` were seeded onto
  both plans in migration `069` but no route called
  `hasFeature()`/`enforceUsageLimit()` for the first two at all.
  (`exports_limit` turned out, on closer inspection during Phase 5, to
  already be correctly enforced server-side — the audit's first pass
  had this wrong; corrected once actually checked.)
- `lib/monthlyReport.ts` (Sprint 20) and `lib/getFinancialIntelligence`'s
  full `coachingMessages` array were both fully computed and completely
  unsurfaced anywhere in the UI.
- The Annual Report page existed with no link to it from anywhere in the
  app.

**Nothing from Sprint 29 was rebuilt.** Every phase below extends or
finally wires up existing infrastructure — the one new database table
(`saved_scenarios`) is additive, not a replacement of anything.

## What was built, phase by phase

### Phase 2 — Premium Dashboard Experience
**Extended.** `PremiumForecastCard` (new component) surfaces the
30/60/90-day breakdown `lib/cashFlowProjection.ts` had always computed —
free users kept the exact same ungated 90-day number they already had.
`PremiumBadge` added to the dashboard header (existed, unused
elsewhere). Gated by `advanced_forecasting` (seeded, previously unread).

### Phase 3 — Scenario Simulator Upgrade
**Extended, plus one real enforcement gap closed.** The
"3 simulations/day free" limit referenced in migration `069` was never
enforced anywhere — `ScenarioSimulatorCard` ran entirely client-side.
New `POST /api/goal/scenario-run` enforces it via
`enforceUsageLimit("scenarios_limit", ...)`. New, genuinely additive:
saved scenarios (`saved_scenarios` table, migration `070`; free 1/goal,
premium unlimited) using the same live-row-count pattern as
`goals_limit`. Scenario comparison (the bar visualization) is unchanged
Sprint 28.5 work, reused as-is.

### Phase 4 — Intelligence Center
**New route, `/intelligence`.** Composition only — every card on the
page (`IntelligencePanel`, `FinancialHealthCard`, `PremiumForecastCard`,
`CategoryIntelligenceCard`, `BehaviorInsights`, `RecommendedGoalCard`)
already existed. `getFinancialIntelligence()` called exactly once.
"Top Priority Goal" has no existing ranking engine behind it — uses the
real `is_primary` flag (already used by `reflection.ts`) rather than
inventing a new prioritization algorithm; documented as a limitation
below, not hidden.

### Phase 5 — Premium Reports
**New: Monthly Report (`/reports/monthly`) + `/reports` hub.**
`buildMonthlyReport()` (Sprint 20) had zero UI/export surface before
this phase. CSV export gated by the pre-existing, already-correct
`exports_limit`. Deliberately no historical-month picker —
`buildMonthlyReport()` computes goal health against *today's* real
balances, so a past month through it would be actively misleading (the
exact problem `buildAnnualReport()` was already written to avoid — see
`lib/exportCenter.ts`'s header). **Deferred**: Quarterly Report, a
standalone Goal Performance report, and Health Score History (needs a
new historical-snapshot table/cron — genuinely new infrastructure, not
a display extension) were not built.

### Phase 6 — Goal Detail Enhancements
**Mostly already satisfied by Phase 3** — `ScenarioSimulatorCard`
already is the "What if…" panel the brief describes, already on
`/goals/[id]`. Audit found and fixed a real, separate bug while
verifying: every scenario label hardcoded a `$` symbol regardless of the
app's actual `currency_code` (ZAR by default). Fixed by threading an
optional `formatAmount` through `lib/scenarioSimulator.ts`, defaulting
to the exact previous behavior so no existing caller broke.

### Phase 7 — Premium Coaching
**Extended.** New `PremiumCoachingCard` unlocks the coaching messages
beyond what two different surfaces already showed for free
(`IntelligencePanel`'s `topCoachingMessage` = index 0;
`GoalIntelligenceCard`'s `coaching.slice(1,3)`) — same
`generateCoachingMessages()` output both already compute, just
previously discarded past the free slice. Gated by `ai_coaching`
(seeded, previously unread). "Action plans" in the brief's literal sense
was not built — the closest existing equivalent
(`lib/interventions.ts`'s reason/evidence/expectedBenefit objects) is
already shown in full, uncapped, to every user; there was nothing left
to gate without either duplicating an engine or removing something
already free.

### Phase 8 — Explainability
**Audit, two real bugs fixed.** Most cards were already compliant
(earlier Sprint 28.5 work). Found: `BehaviorInsights`' expanded
intervention list showed `expectedBenefit` but silently dropped
`reason` for every item past the first. Found in my own Phase 5 code:
`lib/monthlyReport.ts`'s `topMilestone` embedded a raw unformatted
number (`Math.round(amount)`, no currency symbol), and the client
rendered the raw internal key `"monthly_savings"` directly into the UI
with no stated comparison baseline. Both fixed.

### Phase 9 — Upgrade Experience
**Audit, one real broken-UX bug fixed.** `LockedCard`/`UpgradePrompt`
were already well-built (preview/explanation/CTA, no dark patterns).
Found: every CSV export link in the app (`AnnualReportClient.tsx`) was
a plain `<a href>` — a free user who exhausted `exports_limit` and
clicked one was navigated out of the app to the raw JSON error body.
New `lib/hooks/useGatedDownload.ts` fixes this and now also backs the
Monthly Report's CSV export, which Phase 5 had left completely unlinked
in the UI.

### Phase 10 — Performance Audit
**One real duplicate calculation found and fixed, inside the
orchestrator itself.** `forecastGoal()` was being computed twice per
active goal on every `getFinancialIntelligence()` call — once inside
`lib/coaching.ts`, again independently inside `lib/accountHealth.ts`.
Both now accept an optional precomputed map, populated once by the
orchestrator; every other caller is unaffected. Verified with tests that
feed in a deliberately fabricated forecast and confirm the dependent
output reflects it — proof the substitution is real, not decorative.

### Phase 11 — Accessibility Audit
**Real bugs found, not just checkbox compliance.** Orphaned
`aria-labelledby` on two new cards (referenced heading ids that didn't
exist). A genuine visual bug: the Scenario Simulator's "Run" button used
`className="btn-secondary"` — a class that doesn't exist anywhere in
the stylesheet, meaning it had been rendering unstyled since Phase 3.
Missing `aria-hidden` on several decorative icons, and missing
focus-visible rings on custom buttons/inputs added this sprint
(inconsistent with an explicit pre-existing Sprint 14 team convention
for exactly this). All fixed; regression-tested with a query
(`getByRole("region", {name})`) that only passes if the labelling
genuinely resolves.

### Phase 12 — Security Audit
**Action-level enforcement confirmed solid; one duplication found and
fixed.** Every premium-gated *action* (scenario runs, saved scenarios,
all exports) always calls the server unconditionally and the server
decides — no client-state bypass path exists. Found: `PremiumForecastCard`
and `PremiumCoachingCard` each independently wrote an identical
entitlement-check expression. Extracted into `lib/hooks/useFeatureEntitlement.ts`.
One finding deliberately **not** "fixed": `LockedCard`'s blur-preview
pattern means locked content is present in the page payload,
inspectable via devtools — a real property of the architecture, but the
component's own documented Sprint 29 design intent, not an oversight;
written up rather than silently overridden (see
`PREMIUM_ARCHITECTURE.md`'s Sprint 30 section).

### Phase 13 — Testing
Ran `vitest run --coverage` for real numbers rather than estimate. Found
and fixed one real gap: `annualReportMonthlyToCSV`/
`annualReportCategoryToCSV`/`milestonesToCSV` (pre-existing, same file as
this sprint's `monthlyReportGoalsToCSV`) had zero test coverage — added.
Found `lib/billing/gate.ts` (this sprint's actual enforcement backbone)
has no unit tests, and deliberately did **not** add any: an explicit,
documented Sprint 29 team decision (`tests/unit/billing/entitlements.test.ts`'s
own header) tests only pure logic and leaves Supabase-fetching wrappers
for integration tests. Overriding that unilaterally would have
contradicted a previous deliberate decision, not fixed an oversight.

### Phase 14 — Documentation
`docs/PREMIUM_ARCHITECTURE.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`
updated with Sprint 30 sections, matching each doc's existing voice and
cross-referencing rather than duplicating. One self-caught error during
writing: initially inserted `ARCHITECTURE.md`'s new section *before* the
Sprint 29 section it explicitly references as "the plumbing above" —
caught by checking actual heading order with `grep`, not by assuming the
edit landed where intended, and corrected before finishing.

## Verification actually performed, not just claimed

- `npx tsc --noEmit -p tsconfig.json` — run after every phase's changes,
  every time. Clean throughout, with exactly one pre-existing, unrelated
  error present before this sprint started and never touched
  (`lib/billing/providers/stripe.ts`'s Stripe API-version type mismatch)
  — confirmed present at the start of this sprint's very first
  investigation, not introduced by anything here.
- `npx vitest run` — full suite, run after every phase. Final state:
  **77 test files, 653 tests passing, 0 regressions** (up from the 613
  passing tests `SPRINT29_SUMMARY.md` recorded at the end of Sprint 29
  — the intervening growth is this sprint's new/updated tests, net of
  the Phase 12 test-file rewrite that changed some individual test
  counts non-additively). The 91 `it.todo` integration-test placeholders
  predate this sprint and are unrelated to it.
- Every new test that exercises a fix was checked to actually fail
  before the fix and pass after — not just written to pass against the
  final code. Concretely verified this way for: the scenario-simulator
  currency fix (Phase 6), the `forecastGoal()` dedup substitution
  (Phase 10), and the `aria-labelledby` fix (Phase 11).
- Package installation and a real `npx tsc`/`vitest` run were both
  performed in this environment specifically to get ground truth rather
  than reason about the code statically.

## What was intentionally deferred (documented, not hidden)

- **Quarterly Report, standalone Goal Performance report, Health Score
  History.** The first two would be new report *types* built from
  already-existing data (feasible, just not scoped into this sprint's
  time); Health Score History specifically needs a new
  historical-snapshot table and a cron to populate it — genuinely new
  infrastructure, not a display extension of anything that exists.
- **"Action plans"** (Phase 7's literal ask) — see that phase's note
  above. Building one would mean either a second coaching-generation
  engine or duplicating `lib/interventions.ts`'s already-free content.
- **`lib/billing/gate.ts` unit tests** — deliberately left to match an
  existing, documented Sprint 29 testing-policy decision (see Phase 13
  above), not an oversight.
- **Server-side filtering of "premium" data before it reaches the
  client** for `PremiumForecastCard`/`PremiumCoachingCard`. Would close
  the Phase 12 devtools-inspection finding, but at the cost of either
  duplicating the entitlement check server-side and client-side (this
  codebase's central billing rule) or replacing `LockedCard`'s
  documented "real blurred preview" UX with a generic locked state — a
  product decision, not an engineering fix, and not made unilaterally
  here.
- **A real Stripe/database environment was not available in this
  sandbox** — migration `070` was written and reviewed but not run
  against a live Supabase instance; the person should apply it through
  their normal migration flow before deploying.

## Known limitations

- **"Top Priority Goal"** (Intelligence Center) uses the user-set
  `is_primary` flag, not an intelligence-computed ranking — there is no
  existing engine that ranks a user's *current* goals by priority
  (confirmed via audit: `interventions`/`behaviorProfile` are
  account-wide, not per-goal; `goalRecommendations` suggests goal
  categories the user doesn't have yet). Building a new ranking engine
  was avoided deliberately, per this sprint's own "don't duplicate
  business logic" principle — see Phase 4 above.
- **Devtools-inspectable premium preview data** — see Phase 12 above and
  `PREMIUM_ARCHITECTURE.md`'s Sprint 30 section for the full reasoning.
  Real, documented, not a silent gap.
- **Plain `<Link>` navigation cards** added this sprint (dashboard
  entry points, the Reports hub) rely on the browser's native default
  focus outline rather than the app's themed amber-tinted ring —
  matches the pre-existing Portfolio link (Sprint 20) exactly; fixing
  only the new ones would have made the app *more* visually
  inconsistent, not less. Flagged as systemic rather than patched in
  isolation.

## Future work

- Build Quarterly Report and a standalone Goal Performance report
  (feasible now — same data, same reused modules as the Monthly Report).
- Design and build Health Score History (new snapshot table + cron).
- Decide, as a product call, whether `LockedCard`'s preview should keep
  showing real (blurred) data or switch to a generic locked state for
  the two data-heavy cards this sprint activated it for.
- Apply migration `070_scenario_simulator_premium.sql` in the real
  deployment pipeline (not yet run against a live database).
- Consider whether `lib/billing/gate.ts` warrants dedicated
  integration-level tests (against a real/mocked Supabase instance) as
  a follow-up, now that this sprint made it the enforcement point for
  five separate routes rather than the original one or two.
