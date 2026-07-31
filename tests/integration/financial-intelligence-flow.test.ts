/**
 * tests/integration/financial-intelligence-flow.test.ts
 *
 * Sprint 28.5 — Phase 11. Same rationale as tests/integration/transaction-flow.test.ts
 * (see that file's own header comment): these require a real Supabase test
 * project with seeded users, real transactions, and real HTTP requests to
 * the actual page/cron routes — not something the pure-function unit tests
 * (getFinancialIntelligence.test.ts, portfolioIntelligence.test.ts, etc.)
 * or the component tests (DashboardClient.test.tsx etc.) can fake, since
 * those intentionally construct their own in-memory fixtures rather than
 * exercising a real database round trip, real RLS enforcement, or a real
 * cron invocation.
 *
 * `it.todo(...)` — visible as "todo" in every test run, not silently
 * skipped or silently passing. See docs/DEVELOPMENT.md's "Integration
 * tests" section for how to actually stand these up against a Supabase
 * test project.
 */
import { describe, it } from "vitest";

describe("Dashboard page — financial intelligence end-to-end", () => {
  it.todo(
    "a seeded user with 8 weeks of weekly deposits sees a Financial Health card whose score matches " +
      "computeFinancialHealthScore() run against that same seed data directly via the Supabase test project's " +
      "service-role client. SEED: test user, one active goal, 8 weekly $100 deposits. " +
      "ACTION: GET /dashboard as that user (authenticated session). " +
      "ASSERT: rendered score/tier text matches the independently-computed value; " +
      "RecommendedGoalCard is present (user only has one category); " +
      "PortfolioIntelligenceCard's quarter projection matches projectCashFlow() computed independently."
  );

  it.todo(
    "a brand-new user (zero transactions) sees no financial-intelligence cards at all, not empty/error states. " +
      "SEED: test user with zero transactions and zero goals. " +
      "ACTION: GET /dashboard. " +
      "ASSERT: FinancialHealthCard, RecommendedGoalCard, CategoryIntelligenceCard, BehaviorInsights all absent from " +
      "the rendered HTML — this is the real-database version of DashboardClient.test.tsx's " +
      "'hides every financialHealth-dependent card' test, which only proves the React gating logic works, not " +
      "that userStage/hasDeposit are computed correctly from real rows."
  );
});

describe("Goal detail page — per-goal intelligence", () => {
  it.todo(
    "another authenticated user cannot view goal A's detail page or its transactions, even with the correct URL. " +
      "SEED: user A with one goal + transactions; user B, a separate authenticated session. " +
      "ACTION: GET /goals/{goalA.id} as user B. " +
      "ASSERT: 404 (notFound()), and confirm via the service-role client that user B's session never received any " +
      "row from goal A's transactions — this is the real-database version of the Phase 9 audit's manual RLS check, " +
      "actually exercised end-to-end rather than read from the migration SQL."
  );

  it.todo(
    "the Scenario Simulator's lump-sum scenario never writes to the real transactions table. " +
      "SEED: test user, one active goal with some deposit history. " +
      "ACTION: interact with the lump-sum input in the rendered ScenarioSimulatorCard, submit a value. " +
      "ASSERT: goal.current_amount in the database is unchanged after the interaction — proves the 'never modifies " +
      "real data' claim in lib/scenarioSimulator.ts's own docstring against a real DB, not just in-memory JS state."
  );
});

describe("Financial health snapshot cron — daily persistence", () => {
  it.todo(
    "running the cron writes exactly one financial_health_score_snapshots row per user with deposit history, and " +
      "skips users with none. SEED: three users — one with deposits, one with none, one already having a snapshot " +
      "row for today. " +
      "ACTION: POST /api/cron/financial-health-snapshot with a valid CRON_SECRET bearer token. " +
      "ASSERT: user 1 gets exactly one new row; user 2 gets none; user 3's existing row is upserted (still exactly " +
      "one row for that user+date), not duplicated — the real-database version of the (user_id, date) UNIQUE " +
      "constraint's idempotency claim in migration 067's own comment."
  );

  it.todo(
    "the cron route rejects requests without a valid CRON_SECRET, and does not run the scheduler at all. " +
      "ACTION: POST /api/cron/financial-health-snapshot with no Authorization header, and again with an incorrect " +
      "bearer token. " +
      "ASSERT: both return 401; zero rows written to financial_health_score_snapshots as a result of either call."
  );
});
