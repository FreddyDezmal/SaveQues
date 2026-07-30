# Sprint 28.5 — Phase 1: UX + Architecture Audit

## 0. Ground rule

Per the brief: this sprint does not create a new Financial Intelligence
Engine. Sprint 28's own audit already confirmed the engine exists. This
document audits what happened *after* that engine shipped — is it
actually visible to users? — before any code changes were made.

## 1. What was audited

Every page under `app/(app)/`: dashboard, goal detail, goals list,
portfolio, shared goals. Every `lib/*.ts` intelligence module and its
call sites (`grep -rl` for each exported function across `app/` and
`components/`, not just an assumption from the filename).

## 2. Finding: the dashboard and goal detail are already fully integrated

This was the first and most important finding, and it changes the shape
of this sprint. `app/(app)/dashboard/page.tsx` already:

- Computes `computeAccountHealth`, `computeFinancialHealthScore`,
  `projectCashFlow`, `computeBehaviorProfile`, `computeBehavioralRisk`,
  `generateInterventions`, `computeCategoryIntelligence`,
  `generateInsights`, `generateCoachingMessages` — gated behind the same
  `hasDeposit && userStage !== "new"` check, all reusing one transaction
  fetch.
- Passes all of it into `DashboardClient`, which renders
  `FinancialHealthCard`, `CategoryIntelligenceCard`, and the behavior/risk
  surfaces.

`app/(app)/goals/[id]/GoalDetailClient.tsx` already renders
`GoalIntelligenceCard` (forecast + goal health + required weekly pace +
coaching, with a collapsible factor breakdown) and `ScenarioSimulatorCard`
(the Phase 8 "what if" panel from Sprint 28, standard scenarios + custom
input, deltas explained in plain language).

**Conclusion for Phase 3 (Dashboard) and Phase 4 (Goal Detail): no
changes were made.** Building either again, or restructuring working,
tested, already-integrated UI to fit a new pattern, would be exactly the
duplication this sprint is supposed to prevent. This is a documented
decision, not an oversight — see the brief's own instruction to "stop,
explain the conflict, justify the decision, and preserve the
architecture" when a phase would otherwise force unnecessary rework.

## 3. Genuine gap #1: no shared orchestration layer

The intelligence-assembly logic above (~80 lines: fetch → gate → call
8 modules → pass to client) exists exactly once, inline, in
`dashboard/page.tsx`. `portfolio/page.tsx` calls a *different* subset
directly (`buildPortfolioSummary` only). `goals/[id]/GoalDetailClient.tsx`
calls a third subset client-side (`forecastGoal`, `computeGoalHealth`).
Nothing wrong with any one of these individually, but there was no single
place a fourth integration point could call into — the next one would
have copied the dashboard's 80 lines a second time. This is Phase 2's
target and is addressed below.

## 4. Genuine gap #2: `lib/recommendations.ts` had zero UI consumers

```
grep -rln "generateGoalRecommendations" app components lib
→ lib/recommendations.ts   (only the definition itself)
```

Fully built, fully tested (`tests/unit/recommendations.test.ts`, 4
passing tests), explainable (every recommendation carries a `reason`
string derived from a real template, scaled to the user's own deposit
capacity) — and never called from anywhere a user could see it. This is
the clearest "hunt for useful information" case the audit was asked to
look for, except inverted: the information didn't need to be *found* on
an existing page, it needed a first home at all.

## 5. Genuine gap #3: the portfolio page didn't use the Sprint 28 modules

`portfolio/page.tsx` — the page explicitly designed as the "premium,
lifetime overview" (see its own Sprint 20 header comment) — predates
Sprint 28 and had never been revisited to include
`financialHealthScore.ts` or `cashFlowProjection.ts`, both of which are
portfolio-scale by design (`cashFlowProjection.ts`'s own module comment:
"Portfolio-wide (all goals, not one)"). This is arguably where that
module's data belongs *most*, and it wasn't there.

## 6. Where NOT to add anything (avoiding clutter)

- **Portfolio + `financialHealthScore`'s 6-tier score**: portfolio
  already shows `accountHealth`'s 4-band score prominently near the top.
  `financialHealthScore.ts`'s own comment is explicit that its 6-tier
  scale is a *distinct, additive* surface, not a replacement — showing
  both scores for the same account on the same page would be confusing,
  not clarifying. Not added.
- **Goal detail**: already covered per §2. No additional cards.
- **Dashboard**: already covered per §2. No reordering, no new widgets —
  the brief for this exact page (Sprint 20 Phase 4) already said "reorder
  only, don't rebuild," and that's still true here.

## 7. What this sprint actually built (see PHASE 2+ below / SPRINT_28_5_SUMMARY.md)

1. `lib/intelligence/getFinancialIntelligence.ts` — the orchestrator
   Phase 2 asked for, calling every existing module, calculating nothing.
2. `portfolio/page.tsx` + `PortfolioClient.tsx` — wired to the new
   orchestrator for two, and only two, new pieces of information this
   page didn't already have: a portfolio-wide quarter cash-flow
   projection, and a recommended next goal (closing gap #2 and #3 above
   in one integration, without touching dashboard or goal detail).
