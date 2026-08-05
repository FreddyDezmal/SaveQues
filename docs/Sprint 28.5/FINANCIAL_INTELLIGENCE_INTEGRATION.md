# Financial Intelligence Integration (Sprint 28.5)

## 1. What this document is

Sprint 28 built the Financial Intelligence *engine* — the pure calculation
layer (`lib/scenarioSimulator.ts`, `lib/financialHealthScore.ts`,
`lib/cashFlowProjection.ts`, plus the pre-existing Sprint 19–24 engines it
audited and reused). Sprint 28.5's job was different: **make that
intelligence visible**, without building a second one. This document
covers the orchestration layer, the UI decisions, the visualization
approach, and the explainability rules that came out of that work.

Every claim below was checked against the actual code before being
written down — see each section's own "verified by" note.

## 2. Orchestration architecture

### 2.1 The problem

By Sprint 28, `app/(app)/dashboard/page.tsx` had accumulated ten separate,
hand-wired calls into the intelligence layer — one per sprint that added a
feature (`generateInsights`, `buildWeeklyReview`, `generateCoachingMessages`,
`computeHabitProfile`, `computeBehaviorProfile`, `computeBehavioralRisk`,
`generateInterventions`, `computeAccountHealth`, `computeCategoryIntelligence`,
`computeFinancialHealthScore`, `projectCashFlow`). Each call needed its own
input shaping from the same underlying `transactions`/`goals`/`activityLog`.
That wiring only existed in one file — a second page wanting the same
bundle would have had to copy it.

### 2.2 The fix: one orchestrator, zero calculation

`lib/intelligence/getFinancialIntelligence.ts` — `getFinancialIntelligence(input)`.

**Rule, enforced by review at every call site added to it:** this file
calculates nothing. Every field in `FinancialIntelligence` is a
pass-through from an engine that already existed. When two engines
needed the same intermediate value (`computeFinancialHealthScore()`
internally calling `computeAccountHealth()`, which the orchestrator also
needs directly for `interventions`), the fix was changing
`computeFinancialHealthScore()`'s signature to accept an optional
precomputed `AccountHealth` — not duplicating logic, and not silently
eating the double computation either (see §7, Performance).

**What's deliberately NOT in the bundle:** `forecastGoal()` and
`computeGoalHealth()` (per-goal, called directly by the goal detail page —
bundling them would mean running them for every goal on every dashboard
load) and `buildPortfolioSummary()` / `computePortfolioIntelligence()`
(portfolio-page-specific, called directly by that page with its own fetch
shape). See `getFinancialIntelligence.ts`'s own module comment for the
full reasoning.

*Verified by: `tests/unit/getFinancialIntelligence.test.ts` (9 tests),
including one that asserts the orchestrator's `accountHealth` output is
`toEqual` a direct `computeAccountHealth()` call with the same inputs —
proof there's no divergent recalculation.*

### 2.3 Two callers, two fetch shapes, one engine

The dashboard (`app/(app)/dashboard/page.tsx`) and the portfolio page
(`app/(app)/portfolio/page.tsx`) both need category/cash-flow data, but
fetch their base data differently (RPC + one extra query vs. four plain
selects). Rather than force both through the orchestrator, the portfolio
page calls `computeCategoryIntelligence()` / `projectCashFlow()` directly
and feeds the results into `computePortfolioIntelligence()`
(`lib/portfolioIntelligence.ts`, Sprint 28.5 Phase 5) as parameters. Same
reuse discipline as the orchestrator, without forcing one fetch shape onto
every page.

## 3. Dashboard decisions (Phase 3)

Audited against the Sprint 28.5 brief's own widget list before adding
anything. Already present pre-Sprint-28.5: Financial Health, Momentum
(`MomentumHeatmap`, wired since Sprint 21), Top Insight, Cash Flow,
Behavior Summary. Also present but consumed *internally*, not as a
separate widget: Recent Trend (`lib/trends.ts` feeds `insights.ts` /
`weeklyReview.ts` sentences directly — there's no separate trend number to
surface).

**Genuinely missing:** `lib/recommendations.ts` (Sprint 20) had never been
called from anywhere in the app. `RecommendedGoalCard` closes that gap —
shows only the single top recommendation (not the full list of up to 3
the engine can return), per "avoid dashboard overload."

*Verified by: grepped every `.tsx`/`.ts` file for
`from "@/lib/recommendations"` before building anything — zero hits
pre-Sprint-28.5.*

## 4. Goal detail decisions (Phase 4)

`GoalIntelligenceCard` and `ScenarioSimulatorCard` already covered
completion projections, required weekly pace, and the what-if panel.

**The actual bug:** `lib/goalHealth.ts` has computed a per-factor
`.explanation` string since Sprint 19. `GoalIntelligenceCard` rendered
`name` and `points/maxPoints` for every factor but never `explanation` —
computed and silently discarded on every render. Fixed by rendering it.
Same exact bug, same fix, found independently in two more places during
later phases (§6).

Also added: an explicit assumption line under the required-pace figure
("assumes even weekly deposits... not a lump sum at the end") — the
"never hide assumptions" rule made concrete.

## 5. Portfolio decisions (Phase 5)

`lib/portfolioIntelligence.ts` — the one file in this sprint that computes
something genuinely new (not previously computable anywhere): strongest/
weakest active goal (runs `goalHealth.ts`'s per-goal scorer once per goal
and ranks them — nothing else in the codebase does per-goal comparison at
portfolio scope) and completion/opportunity forecasting (same pattern with
`forecast.ts`'s per-goal forecaster — latest-finishing goal vs.
soonest-finishing goal).

Diversification and quarter projection are explicitly **not** recomputed
here — they're passed in from `categoryIntelligence.ts` and
`cashFlowProjection.ts`'s own output. See the module's docstring for why
that split exists.

## 6. Explainability philosophy (Phase 7)

**The rule:** every score, recommendation, insight, and prediction must
carry its own "why" as visible text, not just a number. This wasn't
established here — `lib/goalHealth.ts` and `lib/accountHealth.ts` have
computed per-factor explanations since Sprint 19–20. What Sprint 28.5
found is that the *rule was being silently violated at the UI layer*: the
same "explanation computed, never rendered" bug existed independently in
**three places** — `GoalIntelligenceCard` (Phase 4), the portfolio page's
own Financial Health block (found while working on Phase 5), and
`FinancialHealthCard` itself (found during Phase 7's systematic sweep,
in a file built earlier in this same sprint). Fixed identically in all
three, then verified every other UI file touching a scoring engine
(`BehaviorInsights`, `IntelligencePanel`, `CategoryIntelligenceCard`) was
already compliant.

**Practical rule going forward:** if a component renders `factor.points`,
it must also render `factor.explanation` in the same PR. A future
component test asserting the explanation text renders (see
`GoalIntelligenceCard.test.tsx`, `FinancialHealthCard.test.tsx`) is the
mechanical enforcement of this.

## 7. Visualization decisions (Phase 6)

**Audit finding:** zero chart libraries anywhere in this codebase (no
recharts, no Chart.js). `MomentumHeatmap` is the entire "chart" surface.

Two changes, both accessibility-first per the brief's own checklist (text
summary, accessible labels, screen-reader description, meaningful
colors):

- **`MomentumHeatmap`** had no `role`, no `aria-label`, and only a
  mouse-only `title` tooltip per cell. Fixed with a single `sr-only`
  summary sentence carrying every number the grid encodes, then marked
  the decorative grid and legend `aria-hidden` — duplicating the same
  facts as both a 30-cell announcement and a text summary is worse for a
  screen-reader user, not better (same pattern GitHub's own contribution
  graph uses).
- **`ScenarioSimulatorCard`'s comparison bars** — new, but zero new
  calculation: `Math.abs(deltaDays)` was already computed by
  `lib/scenarioSimulator.ts`; the bars just lay it out proportionally
  against the largest delta in the current set. Marked `aria-hidden`
  since `DeltaBadge` right next to each bar already states the same fact
  in text.

## 8. Performance (Phase 8)

One real duplicate calculation found: the orchestrator called
`computeAccountHealth()` directly, then called
`computeFinancialHealthScore()`, which called `computeAccountHealth()`
again internally with identical inputs. Fixed by adding an optional
`accountHealth` parameter to `computeFinancialHealthScore()` — every other
caller (including every existing test) is unaffected; the orchestrator
now computes `AccountHealth` once per dashboard load instead of twice.

Everything else audited and confirmed already correct: every page fetches
each table exactly once via `Promise.all` (no N+1); the new
`financialHealthSnapshot.ts` cron's sequential per-user loop matches the
codebase's own established scheduler pattern (`lib/notifications.ts`), not
an outlier; client-side `useMemo` was already in place everywhere real
per-render computation happens.

## 9. Security (Phase 9)

No API route anywhere calls an intelligence engine directly — everything
is computed inside server components that already have the session-bound
user, so there's no `/api/forecast`-style endpoint an attacker could probe
with a different ID. Every intelligence card's usage was grepped
end-to-end: all render exclusively on the three owner-scoped pages
(dashboard, goal detail, portfolio); zero appear on shared-goal, group,
social, or feed pages. `get_shared_goal_detail`'s RPC body was read
directly — it returns only aggregate goal data and the owner's *public*
profile fields, nothing personal. RLS was checked on every underlying
table (`savings_goals`, `transactions`, `activity_log`,
`financial_health_score_snapshots`) — all correctly `auth.uid() = user_id`
scoped. One defense-in-depth gap fixed: the goal detail page's
transactions query was the one query in the whole surface relying solely
on RLS rather than being explicitly `user_id`-scoped too; tightened to
match every other query.

## 10. Accessibility (Phase 10)

Beyond the chart-specific work in §7: computed actual WCAG contrast ratios
(card background `#17171f`) rather than eyeballing them.
`text-white/40` works out to ~3.83:1 — fails the 4.5:1 AA threshold for
normal text. Found in 11 places written during this sprint (mostly the
same factor-explanation text from §6 — no point fixing the "why" bug just
to make it unreadable). Bumped to `/55` (~5.5:1) in every file authored
this sprint; deliberately left the ~48 pre-existing `/30`–`/40` usages
elsewhere in the app alone — that's an existing design-system decision
across the whole product, not something this sprint introduced. Also
fixed one landmark/heading inconsistency (`PortfolioIntelligenceCard` was
missing the `<section aria-labelledby>` + `<h2>` pattern its sibling cards
use).

## 11. Testing (Phase 11)

Every new `lib/` module has unit tests exercising real logic, not just
smoke tests (e.g. `getFinancialIntelligence.test.ts` asserts pass-through
equality against direct engine calls, not just "returns an object").
Every new component has isolated render tests. The gap found in Phase 11
itself: nothing tested that the cards actually *compose* correctly on a
real page — `DashboardClient.test.tsx` closes that, using the real
orchestrator against a realistic fixture rather than hand-rolled
per-card mocks. DB-level scenarios (RLS enforcement end-to-end, cron
idempotency against a real table) are `it.todo()`, following this
project's own established convention for tests that need a live Supabase
test project — not faked, not silently skipped.

## 12. Extension points (for Sprint 29 — Premium)

This is the concrete payoff of the orchestrator: a Premium feature that
wants "deeper" intelligence should extend `getFinancialIntelligence()`'s
inputs/outputs or call the same underlying engines with different
parameters (e.g. a longer forecast horizon, a paid-tier scenario type) —
never introduce a second analytics pipeline. Specific seams:

- **New scenario types**: add a case to `ScenarioType` in
  `lib/scenarioSimulator.ts` and a corresponding branch in
  `simulateScenario()` — `ScenarioSimulatorCard` and its comparison bars
  need no changes, they already iterate whatever `ScenarioResult[]` they're
  given.
- **New health factors**: `lib/financialHealthScore.ts`'s `rescale()`
  pattern is the template — take an existing factor's already-computed
  points and reweight, or add a genuinely new factor function following
  `computeEmergencyReadiness`/`computeGoalDiversification`'s shape (real
  data or an honest zero, never a fabricated neutral default).
- **New orchestrator fields**: add to `FinancialIntelligence` in
  `getFinancialIntelligence.ts` only if the data is portfolio-wide and
  reusable across pages — per-goal or single-page-specific data belongs in
  that page's own server component, per §2.3.
- **Existing-goal prioritization**: flagged during Sprint 28.5's Phase 3
  audit as a genuine gap — `lib/recommendations.ts` recommends *new* goal
  categories to start, but nothing in this codebase currently answers
  "which of my existing goals should get my next deposit, and why." A
  natural Sprint 29 candidate, building on `goalHealth.ts` +
  `forecast.ts` per-goal outputs the same way `portfolioIntelligence.ts`
  already does for strongest/weakest ranking.

## 9. Currency compatibility audit (Sprint 31, Phase 8)

Sprint 31 checked whether any of this document's engines assumed a
single currency. 14 of 15 modules didn't need changes — `forecast.ts`,
`coaching.ts`, `financialHealthScore.ts`, `cashFlowProjection.ts`,
`categoryIntelligence.ts`, `behaviorProfile.ts`, `goalHealth.ts`,
`portfolioIntelligence.ts`, `riskEngine.ts`, `interventions.ts`,
`adaptiveGoals.ts`, and `analyticsEngine.ts` all compute in ratios and
percentages relative to a user's *own* numbers — inherently
currency-agnostic by construction, not by luck. `insights.ts` was
already properly currency-aware (`formatCurrency` threaded through
since it was written).

The one real bug — the exception this section exists to document, per
this file's own §1 rule that every claim gets verified against the
code: `lib/recommendations.ts`'s `TEMPLATES.baselineTarget` catalog
("Emergency Fund: 15000," etc.) was authored in raw ZAR and used
completely unconverted for every user, regardless of `currency_code`.
Worse, the capacity-scaling math compared a user's own-currency weekly
savings against that same ZAR-denominated reference rate, so
currencies with very different unit values than ZAR (JPY, KWD) would
mostly hit the scaling clamp rather than scaling meaningfully.

Fixed via dependency injection, not a rewrite of the scaling math —
same pattern `lib/scenarioSimulator.ts` already used for injecting
`formatAmount` (§8 above): `generateGoalRecommendations()` takes an
optional `convertFromZar` function, defaulting to identity (zero
regression for ZAR users, and for any caller that doesn't pass one).
`getFinancialIntelligence()` had to stay pure and synchronous per its
own §2.2 rule — it doesn't await anything itself. Instead,
`lib/currencyConversion.ts`'s `createZarConverter()` resolves the real
exchange rate *once*, asynchronously, in the two page routes that call
the orchestrator, and hands the (now-synchronous) resulting closure
down through `FinancialIntelligenceInput`. The orchestrator's "this
file calculates nothing" rule (§2.2) held — it still doesn't do the
conversion itself, just threads through a function its caller already
resolved.

**Left as documented future work, not silently fixed**: the "round to
nearest 100" step in `recommendations.ts`'s suggested-target math still
assumes a ZAR-like unit value — cosmetically wrong for BHD/KWD, not a
magnitude bug, not touched.
