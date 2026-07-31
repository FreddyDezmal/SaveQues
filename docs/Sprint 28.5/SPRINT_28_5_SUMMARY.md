# Sprint 28.5 — Financial Intelligence Integration: Sprint Summary

## 1. Mandate

Sprint 28 built the Financial Intelligence engine. Sprint 28.5's brief was
explicit that it was not to build more intelligence — only to make the
existing engine (Sprint 19–28) visible, consolidated, and explainable. This
document is the honest record of what that took, phase by phase, with every
claim checked against the actual code rather than assumed.

## 2. Architecture

**`lib/intelligence/getFinancialIntelligence.ts`** — the one orchestrator
the brief asked for. Replaces ten hand-wired engine calls that had
accumulated inline in `app/(app)/dashboard/page.tsx` across Sprints 19–28
with one function call. Calculates nothing itself — every field is a
pass-through from an existing engine. Full reasoning and a diagram of what's
deliberately excluded (per-goal engines, portfolio-page-specific engines)
in `docs/Sprint 28.5/FINANCIAL_INTELLIGENCE_INTEGRATION.md` §2.

**`lib/portfolioIntelligence.ts`** — the one genuinely new calculation this
sprint added: per-goal comparison at portfolio scope (strongest/weakest
goal, completion/opportunity forecasting), built by running the existing
per-goal engines (`goalHealth.ts`, `forecast.ts`) once per goal — nothing
else in the codebase does that. Diversification and quarter projection are
explicit pass-throughs from `categoryIntelligence.ts` / `cashFlowProjection.ts`,
not recomputed.

## 3. What shipped, by phase

| Phase | Delivered |
|---|---|
| 1 (Audit) | Full audit of dashboard, goal detail, portfolio pages before touching anything |
| 2 (Orchestrator) | `getFinancialIntelligence.ts` |
| 3 (Dashboard) | `RecommendedGoalCard` — wired `lib/recommendations.ts` (Sprint 20, never previously called) into the dashboard |
| 4 (Goal detail) | Fixed `GoalIntelligenceCard` silently dropping factor explanations; added assumption disclaimer to required-pace line |
| 5 (Portfolio) | `lib/portfolioIntelligence.ts` + `PortfolioIntelligenceCard`; same explanation bug fixed on the portfolio page's own health block |
| 6 (Visualization) | `MomentumHeatmap` accessibility fix (sr-only summary, aria-hidden decorative grid); scenario comparison bars in `ScenarioSimulatorCard` |
| 7 (Explainability) | Systematic sweep found the same explanation-dropping bug a *third* time, in `FinancialHealthCard` (built earlier this same sprint) — fixed |
| 8 (Performance) | Found and fixed a real duplicate: orchestrator called `computeAccountHealth()` twice; `computeFinancialHealthScore()` now accepts a precomputed one |
| 9 (Security) | Verified no intelligence leaks into shared-goal/group/social pages via RPC-body and import-graph audit; tightened one query relying solely on RLS |
| 10 (Accessibility) | Computed real WCAG contrast ratios; fixed 11 instances of `text-white/40` (~3.83:1, fails AA) → `/55` (~5.5:1) across code written this sprint; fixed one missing landmark/heading |
| 11 (Testing) | `DashboardClient.test.tsx` (composition, previously zero coverage); 6 honest `it.todo()` integration stubs for DB-level scenarios |
| 12 (Documentation) | `FINANCIAL_INTELLIGENCE_INTEGRATION.md` |
| 13 (Final review) | Found `cashFlowProjection.ts` and `portfolioSummary.ts` independently computing the same one-line formula; consolidated into `lib/utils.ts`'s `sumGoalBalances()` |
| 14 (This document) | — |

## 4. Testing

Final state, all run for real against this environment (not assumed):
**493/493 unit tests passing** (91 honest `it.todo()`s, unchanged from
before this sprint — never converted to fake passes), **92/92 component
tests passing**, `tsc --noEmit` clean, `next lint` unchanged (2 pre-existing
warnings in files this sprint never touched).

Every `lib/` module added has unit tests exercising real behavior, not
smoke tests — e.g. `getFinancialIntelligence.test.ts` asserts pass-through
*equality* against direct engine calls, not just "returns an object";
`financialHealthScore.test.ts`'s dedup test passes a deliberately
artificial `AccountHealth` object and confirms the output actually derives
from it. Every new component has isolated render tests. Composition is
tested too (`DashboardClient.test.tsx`), closing a gap that existed before
this sprint (no page-level component had ever been rendered in a test).

**Honestly documented gap:** DB-level integration tests (RLS enforcement
end-to-end, cron idempotency against a real table) are `it.todo()`,
following this project's own pre-existing convention for tests that need a
live Supabase test project — not available in this working environment.
The stubs specify exact SEED/ACTION/ASSERT for whoever picks them up.

## 5. Accessibility

Every chart-equivalent surface in the app (there is exactly one —
`MomentumHeatmap` — plus the new scenario comparison bars) now has a
screen-reader text description and correctly hides purely-decorative visual
reinforcement from assistive tech, rather than either exposing 30 redundant
per-cell announcements or nothing at all.

Contrast was computed, not eyeballed: card background `#17171f`,
`text-white/40` ≈ 3.83:1 (fails WCAG AA's 4.5:1 for normal text). Fixed in
every instance written this sprint. Left the ~48 pre-existing instances
elsewhere in the app untouched — that's this product's existing design
convention, not something to unilaterally overhaul under a "visualization"
phase's mandate.

## 6. Performance

One real duplicate calculation found and fixed (§3, Phase 8): the
orchestrator was computing `AccountHealth` twice per dashboard load.
Fixed via an optional precomputed-value parameter on
`computeFinancialHealthScore()`, backward compatible with every existing
caller. Everything else audited and confirmed already correct: no N+1
queries at the page level, the new cron scheduler matches this codebase's
own established sequential-per-user pattern, client-side memoization was
already correctly in place everywhere real per-render computation happens.

## 7. Security

No API route in this codebase exposes an intelligence engine directly —
everything is computed inside session-bound server components, so there's
no endpoint an attacker could probe with a different user ID. Verified via
import-graph grep, not assumed: every intelligence UI component renders
exclusively on the three owner-scoped pages (dashboard, goal detail,
portfolio); zero appear on shared-goal, group, social, or feed pages.
`get_shared_goal_detail`'s RPC body was read directly and returns only
aggregate goal data plus the owner's already-public profile fields — never
anything derived from personal transaction history. RLS was checked
directly in the migration SQL for every table this sprint's work depends
on. One defense-in-depth gap closed (goal detail page's transactions query
tightened to match every other query's explicit `user_id` scoping).

## 8. Known limitations

- **Existing-goal prioritization doesn't exist.** Corrected during this
  sprint's own Phase 3 audit: `lib/recommendations.ts` recommends *new*
  goal categories to start, not which of a user's *current* goals should
  get their next deposit. Flagged as a genuine Sprint 29 candidate in
  `FINANCIAL_INTELLIGENCE_INTEGRATION.md` §12, not silently left implied
  as already covered.
- **`lib/portfolioSummary.ts` (Sprint 20) has no dedicated test file.**
  Pre-existing gap, not introduced by this sprint. Touched carefully during
  Phase 13's dedup fix (verified behavior-preserving by direct reasoning
  plus tests on the new shared helper it now calls), but a full backfill
  suite for that module was out of this sprint's actual scope.
- **DB-level integration tests are stubs**, per §4 — real, but not
  executable in this working environment.
- **Sprint 28's `financial_health_score_snapshots` table (migration 067)
  and its daily cron are still unused by any UI.** Built for future
  trend/sparkline display; nothing currently reads from it. Not a bug —
  it was built ahead of the UI that will consume it, and is explicitly
  documented as such in its own migration.

## 9. Future extension points

Full detail in `FINANCIAL_INTELLIGENCE_INTEGRATION.md` §12. Summary: new
scenario types extend `lib/scenarioSimulator.ts`'s existing switch
statement; new health factors follow `financialHealthScore.ts`'s
`rescale()` pattern; new orchestrator fields only belong in
`getFinancialIntelligence.ts` if they're genuinely portfolio-wide and
reusable across more than one page. The concrete Sprint 29 (Premium) payoff
of this sprint's work: a paid-tier feature should extend these same seams,
never stand up a second analytics pipeline next to them.
