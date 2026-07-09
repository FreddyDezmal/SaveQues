/**
 * tests/integration/transaction-flow.test.ts
 *
 * Sprint 18 — Phase 2 fix. This file was previously
 * tests/integration/transaction-flow.spec.ts: pure prose (setup/action/
 * assert comments), zero executable code, AND excluded from
 * vitest.config.ts's old `include: ["tests/**\/*.test.ts"]` glob (`.spec.ts`
 * doesn't match `.test.ts`). It looked like a covered test suite and was
 * actually silent dead weight — nothing ran, nothing reported.
 *
 * Renamed to `.test.ts` (now included) and converted to `it.todo(...)`,
 * which Vitest reports explicitly as "todo" in every run — visible,
 * honest, not silently passing or silently absent. These require a real
 * Supabase *test* project with a seeded test user and an active goal to
 * actually implement (see docs/DEVELOPMENT.md's "Integration tests"
 * section) — not something that can be faked with the pure-function unit
 * tests elsewhere in this suite, since they assert on real HTTP responses,
 * real inserted rows, and real timing between a response and a deferred
 * background call.
 */
import { describe, it } from "vitest";

describe("POST /api/transactions — deposit flow", () => {
  it.todo(
    "returns the HTTP response BEFORE deferred PostHog analytics calls complete " +
      "(proves the deferred-analytics latency claim end-to-end, not just in " +
      "deferredAnalytics.test.ts's mocked waitUntil). " +
      "SEED: test user with one active savings_goals row. " +
      "ASSERT: response timestamp < first PostHog call timestamp; " +
      "all expected events (deposit_made, first_deposit, xp_awarded) eventually fire; " +
      "response.json().transactionId matches the actual inserted row."
  );

  it.todo(
    "an idempotent retry with the same idempotency_key returns the ORIGINAL transaction, no duplicate row. " +
      "ACTION: POST twice with idempotency_key='fixed-test-key-1'. " +
      "ASSERT: first response duplicate:false with a real transactionId; " +
      "second response duplicate:true with the SAME transactionId; " +
      "exactly one transactions row and one audit_logs DEPOSIT_CREATED row for this key."
  );

  it.todo(
    "two concurrent requests with the same idempotency_key (genuine race, not sequential retry) both resolve to the same transaction. " +
      "ACTION: Promise.all([post(), post()]) with the same idempotency_key, both in flight before either resolves. " +
      "ASSERT: both responses 200 with the SAME transactionId; exactly one transactions row exists " +
      "(verifies the 23505 unique-violation race-handling branch still works)."
  );

  it.todo(
    "a validation failure (amount exceeding the maximum) is recorded as a 'failure' outcome in request_outcomes, with no side effects. " +
      "ACTION: POST with amount: 50000000 (exceeds the 10,000,000 ceiling). " +
      "ASSERT: HTTP 400; a request_outcomes row with route='transactions.deposit', outcome='failure', reason='400'; " +
      "NO row written to transactions; NO row written to audit_logs."
  );

  it.todo(
    "a deferred PostHog failure does not affect the deposit's success — the app has no runtime dependency on PostHog's availability. " +
      "ACTION: configure the test environment's PostHog destination unreachable (or mock trackServerEvent to reject), then POST a valid deposit. " +
      "ASSERT: HTTP 200 with a valid transactionId; transactions and audit_logs rows both exist correctly; " +
      "a Sentry captureError fires for the failed deferred call (observable, not silently swallowed) but never surfaces in the response."
  );
});
