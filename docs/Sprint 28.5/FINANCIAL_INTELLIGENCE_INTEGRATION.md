# Financial Intelligence — Integration Architecture (Sprint 28.5)

## Architecture

```
                    ┌─────────────────────────────┐
                    │   lib/intelligence/          │
                    │   getFinancialIntelligence() │  ← orchestrates only,
                    └──────────────┬────────────────┘    never calculates
                                   │ calls (unchanged, pre-existing)
      ┌───────────┬───────────┬───┴───────┬───────────┬───────────┬─────────────┐
      ▼           ▼           ▼           ▼           ▼           ▼             ▼
accountHealth  financial   cashFlow   behavior    riskEngine  category    recommendations
   .ts        HealthScore  Projection  Profile      .ts      Intelligence     .ts
                  .ts          .ts       .ts                     .ts
                                                          ↓
                                                    interventions.ts
                                                    (behaviorProfile + risk
                                                     + accountHealth + coaching)
```

Every box already existed before this sprint. The orchestrator is a thin
assembly function: given `{ transactions, goals, activityLog, profile }`,
it returns one `FinancialIntelligence` object with every module's output,
plus a handful of "top pick" convenience fields (`topInsight`,
`topRecommendation`, `topCoachingMessage`, `topInterventionMessage`) for
callers that just want the headline item.

It gates on deposit count the same way `dashboard/page.tsx` already did
inline: zero deposits → every field null/empty except `recommendations`
(which works from goal templates alone and is most useful for a
brand-new user with nothing else to go on).

## Dashboard decision

Not migrated to the orchestrator this sprint. `dashboard/page.tsx`
computes `accountHealth` once and explicitly reuses that same object for
`interventions` — its existing shape already satisfies the "assemble
once" goal the orchestrator exists to guarantee elsewhere. Migrating it
would mean either the orchestrator special-cases the dashboard's exact
call order, or the dashboard keeps two parallel assembly paths during a
transition. Given the dashboard's assembly is already correct, tested,
and performant, forcing that migration now was judged higher-risk than
valuable — see the brief's own "preserve architecture over forcing the
spec" clause. It's listed under **Extension points** below as the
natural next step once there's a second reason to touch that file.

## Goal detail decision

Not touched. `GoalIntelligenceCard` + `ScenarioSimulatorCard` already
cover forecast, goal health (with factor breakdown), required weekly
pace, coaching, and the full scenario simulator "what if" panel. See
`SPRINT28_5_PHASE1_AUDIT.md` §2.

## Portfolio integration (what actually changed)

`portfolio/page.tsx` now calls `getFinancialIntelligence()` once,
alongside its existing `buildPortfolioSummary()` call (left completely
unchanged — this is additive, not a replacement). Two fields from the
result are passed to `PortfolioClient`:

- `cashFlow` → a new "Quarter Projection" card: 30/60/90-day projected
  balance, current weekly pace, and which active goals could individually
  be funded within the quarter at that pace (explicitly not a claim they
  could all be funded *simultaneously* — see `cashFlowProjection.ts`'s
  own `fundableWithinQuarter` doc comment, carried through unchanged).
- `topRecommendation` → a new "Suggested Next Goal" card: the
  highest-priority `GoalRecommendation`, first real UI consumer of
  `lib/recommendations.ts` in the app's history.

`financialHealthScore` (the 6-tier score) was deliberately **not** added
to this page — see the audit's §6 for why.

The goal query in `portfolio/page.tsx` widened from a hand-picked column
list to `select("*")` (matching the existing pattern in
`goals/[id]/page.tsx`) because `computeCategoryIntelligence` — called
internally by the orchestrator — reads the full `savings_goals` row
shape.

## Visualization decisions (Phase 6)

No new charts were added. The two new portfolio cards follow the existing
convention in this codebase (`FinancialHealthCard.tsx`,
`CategoryIntelligenceCard.tsx`): numbers and short explanatory sentences,
not graphics, with `aria-labelledby` headings and no color-only signal
(difficulty and pace status are always paired with text, e.g. "Easy fit,"
"90 days"). This matches what was already there rather than introducing a
new visual language for two cards.

## Explainability philosophy (Phase 7)

Already strong throughout the codebase before this sprint — every module
audited carries an `explanation` or `reason` string per factor/item
(`AccountHealthFactor.explanation`, `GoalRecommendation.reason`,
`CashFlowProjection.fundableWithinQuarter[].remaining` paired with the
"individually, not simultaneously" caveat in the UI copy, etc.). The two
new cards follow the same rule: nothing is shown as a bare number without
an adjacent sentence saying what it means or what it assumes (e.g. "at
your current pace of R{x}/week").

## Performance (Phase 8)

The orchestrator computes `accountHealth` exactly once and passes that
same object into `generateInterventions` — no second
`computeAccountHealth()` call. It's called once per portfolio page render
(server component, no client-side re-invocation). No new database
queries were introduced beyond widening the existing goals `select()` to
`"*"` from a five-column list (same query, more columns, no additional
round trip).

## Security (Phase 9)

No new API routes were added. The orchestrator is a pure function — it
receives already-RLS-scoped data (`portfolio/page.tsx`'s existing
`.eq("user_id", user.id)` filters, unchanged) and returns derived data to
the same request. It has no I/O of its own, so it cannot leak across
users by construction — there's nothing in it that could accidentally
drop a `user_id` filter, because it never queries anything.

## Accessibility (Phase 10)

Both new cards use `aria-labelledby` pointing at a heading `id`, matching
`FinancialHealthCard.tsx`'s existing convention. All values are rendered
as text (not conveyed by color alone); the existing `.card` styling and
touch-target sizing from the rest of the portfolio page apply unchanged
since no new interactive controls were added — both cards are read-only
(the recommendation card's only control is the existing `Link` component
used everywhere else on this page).

## Testing (Phase 11)

- `tests/unit/getFinancialIntelligence.test.ts` — 5 new tests covering
  the orchestrator's own job (gating, wiring, "top pick" correctness) —
  deliberately not re-testing math already covered by each module's own
  test file.
- Full existing suite re-run after these changes: **474 passed, 0
  failed** (`npx vitest run --project unit`).
- `npx tsc --noEmit`: clean.
- `npx next lint` on all changed/new files: clean.
- No component or E2E tests were added for the two new `PortfolioClient`
  cards — see `SPRINT_28_5_SUMMARY.md`, "Known limitations," for why this
  is an honest gap rather than a silent omission.

## Extension points

- **Dashboard migration**: once there's another reason to touch
  `dashboard/page.tsx`'s intelligence block, it's a reasonable candidate
  to move onto `getFinancialIntelligence()` for consistency — not urgent
  on its own.
- **Sprint 29 (Premium)**: per the brief's own framing, premium features
  should be able to call `getFinancialIntelligence()` and gate/expand
  individual fields (e.g. showing all `recommendations` instead of just
  `topRecommendation`, or the full `scenarioSimulator` output set)
  without introducing a second analytics system. The orchestrator's
  return shape already carries everything a premium surface would need.
