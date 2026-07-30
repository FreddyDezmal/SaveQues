# Sprint 28.5 — Summary

## What this sprint was

Not a new intelligence engine (Sprint 28 already built and audited that).
This sprint's job was to make the existing intelligence actually visible
and reusable. See `SPRINT28_5_PHASE1_AUDIT.md` for the full audit; the
short version is that most of the brief's asks (dashboard integration,
goal-detail scenario simulator, explainability, accessible presentation)
were **already done** by Sprints 19–28, and building them again would
have violated this sprint's own first rule. Three real gaps were found
and closed instead.

## What shipped

1. **`lib/intelligence/getFinancialIntelligence.ts`** (Phase 2) — the
   orchestrator. Pure assembly of 9 existing modules into one object,
   with data-availability gating and "top pick" convenience fields.
   Calculates nothing itself.
2. **Portfolio page intelligence** (Phase 3/5) — `portfolio/page.tsx` now
   calls the orchestrator and `PortfolioClient.tsx` renders two new
   cards: a portfolio-wide 30/60/90-day cash flow projection, and a
   recommended next goal. Both are genuinely new information this page
   didn't have; neither duplicates anything already on the page or on the
   dashboard.
3. **First UI use of `lib/recommendations.ts`** — this module had zero
   call sites in the app before this sprint despite being fully built and
   tested. It now has one.
4. **Tests** — `tests/unit/getFinancialIntelligence.test.ts` (5 tests,
   all passing). Full existing suite re-verified: 474 passed, 0 failed,
   `tsc --noEmit` clean, `next lint` clean on all changed files.

## What did NOT ship, and why

- **A rebuilt dashboard or goal-detail page.** Both already integrate
  the full intelligence layer (forecast, health, coaching, category
  intelligence, scenario simulator, behavior/risk/interventions). Audited
  and confirmed in Phase 1; not touched.
- **Dashboard migration onto the new orchestrator.** Deliberately
  deferred — see `FINANCIAL_INTELLIGENCE_INTEGRATION.md`, "Dashboard
  decision," for the reasoning. Listed as an extension point, not done
  here, to avoid restructuring tested, working, performance-sensitive
  code without a concrete need driving it.
- **`financialHealthScore`'s 6-tier score on the portfolio page.**
  Considered and explicitly rejected as clutter — the page already shows
  `accountHealth`'s 4-band score, and the two would compete for the same
  attention without adding distinct information at a glance. Documented
  in the audit rather than silently skipped.
- **New charts/visualizations (Phase 6).** The two new cards use the same
  text-first, aria-labelled, no-color-only-signal convention already
  established by `FinancialHealthCard.tsx` and
  `CategoryIntelligenceCard.tsx`. No new chart type was judged necessary
  for a quarter projection and a single recommended goal — both are
  better served by a few labelled numbers than a graph at this scale.
- **Component/E2E tests for the two new `PortfolioClient` cards.** Honest
  limitation: this sprint added unit coverage for the orchestrator
  (`getFinancialIntelligence.test.ts`) but not a new
  `PortfolioClient.test.tsx` or Playwright coverage for the two new
  cards. The existing `tests/component/` and `e2e/` suites were not
  extended. This should be closed before the cards are considered fully
  covered — flagged here rather than claimed as done.
- **Full manual accessibility audit (contrast ratios, screen reader
  pass, reduced-motion check) of the two new cards.** They follow an
  established, already-audited pattern (same card component, same aria
  convention as existing cards on the same page), but that's an inference
  from consistency, not a fresh manual pass. Flagged honestly rather than
  asserted.
- **Security review beyond code inspection.** Confirmed by reading the
  code path (no new queries, no new API routes, orchestrator is a pure
  function over already-scoped data) rather than by running a
  penetration test or RLS policy audit — there was nothing new to audit
  at the database/API layer this sprint, since no new endpoints or tables
  were added.

## Known limitations

- The orchestrator's "assemble once, reuse `accountHealth` for
  interventions" guarantee is verified by code inspection (one call site)
  and covered indirectly by the orchestrator's tests, not by a dedicated
  spy/mock asserting `computeAccountHealth` was called exactly once. A
  future test could tighten this with `vi.spyOn`.
- `dashboard/page.tsx` and the orchestrator now represent two separate,
  independently-correct assembly paths for overlapping data. That's a
  real (documented, intentional) duplication of *wiring*, not of
  *calculation* — every module underneath is still called exactly once
  per code path. It should not be left indefinitely; see "Extension
  points" in the integration doc.

## Future extension points

See `FINANCIAL_INTELLIGENCE_INTEGRATION.md`, "Extension points" — dashboard
migration onto the orchestrator, and Sprint 29 (Premium) consuming the
orchestrator's full output (all recommendations, full scenario set) rather
than just the "top pick" fields used on the portfolio page today.
