/**
 * tests/integration/notification-delivery.spec.ts
 *
 * SETUP REQUIRED before this spec can run:
 *   - A dedicated Supabase TEST project (never production), with all
 *     migrations through 030_request_outcomes.sql applied.
 *   - Env vars: SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY.
 *   - Seed data: 4 test user profiles (see scenarios below), each with an
 *     active push_subscriptions row in a distinct timezone.
 *   - CRON_SECRET set to a known test value, used to call the route
 *     handler directly (not over HTTP — import and invoke the handler
 *     function in-process against the test Supabase project).
 *
 * This file documents the exact scenarios to implement once that setup
 * exists. Each scenario specifies: seed state, the action taken, and the
 * exact assertions — precise enough to convert directly into vitest
 * `it()` blocks.
 */

// ── Scenario 1: a user whose local time matches their preferred hour gets notified ──
//
// SEED:
//   profiles: { id: 'test-user-1', last_notification_hour: <current UTC hour>,
//               last_notification_sent_date: null, streak_days: 5 }
//   push_subscriptions: { user_id: 'test-user-1', timezone: 'UTC', is_active: true }
//
// ACTION: invoke the notifications cron route handler directly (bypassing
//   HTTP, importing GET from app/api/cron/notifications/route.ts) with a
//   valid CRON_SECRET Authorization header.
//
// ASSERT:
//   - notification_logs has exactly one new row for test-user-1 with
//     notification_type = 'streak_at_risk' (or whichever type the seeded
//     streak_days/last_active_date combination triggers) and error IS NULL.
//   - profiles.last_notification_sent_date for test-user-1 is now today's
//     UTC date.
//   - A second invocation of the SAME cron run (simulating a duplicate
//     trigger) produces NO new notification_logs row for this user —
//     verifies the markNotifiedToday() idempotency guard from migration 017.


// ── Scenario 2: a user in a timezone where the cron's UTC time is the middle
//    of their night, who has NEVER been notified, still gets notified
//    (the "overdue fallback" mechanism — the exact thing Phase 1 verified
//    by reading code; this scenario proves it behaviorally) ──
//
// SEED:
//   profiles: { id: 'test-user-2', last_notification_hour: 20,
//               last_notification_sent_date: null, streak_days: 3 }
//   push_subscriptions: { user_id: 'test-user-2', timezone: 'Pacific/Auckland',
//                          is_active: true }
//   (Pacific/Auckland is chosen so that whatever UTC hour this test runs
//   at, it is unlikely to coincide with 20:00 local time there — the
//   point of the scenario is that it should NOT need to.)
//
// ACTION: invoke the cron route handler once.
//
// ASSERT:
//   - test-user-2 IS notified on this run (notification_logs has a new
//     row), specifically BECAUSE lastNotificationSentDate was null
//     (never notified = overdue), regardless of current local hour vs.
//     their preferred hour of 20.


// ── Scenario 3: record_app_open() uses the subscription's real timezone,
//    not a hardcoded one — direct regression test for the Phase 1/
//    migration 029 fix ──
//
// SEED:
//   profiles: { id: 'test-user-3', last_notification_hour: 12 }
//   push_subscriptions: { user_id: 'test-user-3', timezone: 'America/Los_Angeles',
//                          is_active: true, updated_at: now() }
//
// ACTION: call the record_app_open RPC directly:
//   supabase.rpc('record_app_open', { p_user_id: 'test-user-3' })
//   (must be called with a Supabase client authenticated AS test-user-3,
//   since the function's SECURITY DEFINER body checks auth.uid() = p_user_id)
//
// ASSERT:
//   - profiles.last_notification_hour for test-user-3 has moved via the
//     documented EMA formula (ROUND(12 * 0.8 + current_hour_in_LA * 0.2))
//     toward the CURRENT HOUR IN America/Los_Angeles — compute the
//     expected value in the test using the same Intl.DateTimeFormat
//     logic, compare for an exact match.
//   - Explicitly assert the result is NOT equal to what the OLD buggy
//     version would have produced (ROUND(12 * 0.8 + current_hour_in_JHB * 0.2))
//     unless LA and Johannesburg happen to share the same hour at test
//     run time (acceptable rare false-negative; document this caveat in
//     the actual test file once written, or pin the test's current-time
//     dependency via a fixed-clock test utility for determinism).


// ── Scenario 4: a user with NO active push subscription — record_app_open
//    is a safe no-op, does not crash, does not write garbage ──
//
// SEED:
//   profiles: { id: 'test-user-4', last_notification_hour: null }
//   push_subscriptions: (none for this user)
//
// ACTION: call record_app_open RPC as test-user-4.
//
// ASSERT:
//   - No error thrown.
//   - profiles.last_notification_hour for test-user-4 remains null
//     (unchanged) — confirms the migration 029 fix's explicit "skip
//     entirely if no subscription exists" branch, rather than guessing
//     with a default timezone.


// ── Scenario 5: business-outcome monitoring catches a synthetic delivery
//    failure ──
//
// SEED: 10 active push_subscriptions, but seed notification_logs directly
//   (bypassing the scheduler) with only 2 rows for "today" — simulating a
//   scheduler that ran but skipped almost everyone, the exact shape of
//   the record_app_open() bug class.
//
// ACTION: call checkNotificationDeliveryRate() from lib/businessMetrics.ts
//   directly against the test project.
//
// ASSERT:
//   - result.alerted === true (2/10 = 20%, below the 50% threshold)
//   - A Sentry captureWarning was triggered (mock or spy on captureWarning
//     for this specific assertion, since the integration test should not
//     depend on a real Sentry project).

export {};