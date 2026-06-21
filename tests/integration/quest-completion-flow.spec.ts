/**
 * tests/integration/quest-completion-flow.spec.ts
 *
 * SETUP REQUIRED: see notification-delivery.spec.ts header.
 */

// ── Scenario 1: completing a quest for the first time today succeeds,
//    awards XP, and the response returns before deferred PostHog calls ──
//
// SEED: a test user profile with daily_quests_completed: 0, a seeded
//   daily quest for today.
//
// ACTION: POST /api/quest/daily/complete with a valid questId.
//
// ASSERT:
//   - HTTP 200, alreadyAwarded: false, xpGained > 0.
//   - daily_quest_logs has exactly one new row for (user, today).
//   - profiles.xp_total increased by exactly xpGained.
//   - Deferred PostHog events (daily_quest_completed, xp_awarded, and
//     first_quest_completed if this is the user's first-ever quest)
//     eventually fire, after the response — same ordering assertion
//     approach as transaction-flow.spec.ts Scenario 1.


// ── Scenario 2: completing the SAME quest twice in one day is idempotent —
//    pre-existing RPC behavior, re-verified because this sprint added the
//    withOutcomeTracking wrapper around the entire handler ──
//
// ACTION: POST /api/quest/daily/complete with the same questId twice.
//
// ASSERT:
//   - First response: alreadyAwarded: false, xpGained > 0.
//   - Second response: alreadyAwarded: true, xpGained: 0.
//   - Exactly one row in daily_quest_logs for (user, today) — the RPC's
//     UNIQUE(user_id, quest_date) constraint, untouched by this sprint,
//     still holds.
//   - profiles.xp_total only increased ONCE (after the first call).
//   - Both HTTP responses are 200 — the second is not an error, it's a
//     correctly-idempotent success.


// ── Scenario 3: the rate limiter (from a prior sprint) still functions
//    correctly with the new withOutcomeTracking wrapper around it ──
//
// ACTION: POST /api/quest/daily/complete 11 times in rapid succession
//   (the configured limit is 10 attempts per rolling 60 minutes, per a
//   prior sprint's rateLimit.ts).
//
// ASSERT:
//   - The 11th request returns HTTP 429.
//   - A request_outcomes row was written for the 429 with
//     outcome: 'failure', reason: '429' — confirms rate-limit rejections
//     are correctly counted in the new success-rate metric, not silently
//     excluded.


// ── Scenario 4: level-up detection fires correctly through the deferred
//    analytics path — regression check for this sprint's refactor of the
//    quest route's analytics block from inline awaits to a single
//    deferAnalytics() call ──
//
// SEED: a test user with xp_total set to exactly 1 XP below a known level
//   threshold (read the actual threshold from lib/xp.ts LEVELS at test
//   setup time, do not hardcode a specific number that could drift).
//
// ACTION: complete a quest that awards enough XP to cross the threshold.
//
// ASSERT:
//   - The deferred analytics block eventually fires a LEVEL_UP PostHog
//     event with the correct new_level/previous_level — confirms the
//     detectLevelUp() call (which reads profile.xp_total fetched BEFORE
//     the RPC, compared to rpcResult.new_total) still works correctly
//     now that it feeds into a deferred block rather than an inline await.


// ── Scenario 5: quest completion success rate is queryable after a mix
//    of successes and a deliberate failure ──
//
// ACTION: complete quests successfully for 9 different test users, and
//   trigger one deliberate failure (e.g. an invalid questId for a 10th
//   user) — 10 total attempts, 1 failure.
//
// ASSERT:
//   - checkQuestSuccessRate() from lib/businessMetrics.ts returns
//     attempts: 10, failures: 1, successRate: 0.9.
//   - Given the configured QUEST_SUCCESS_RATE_MIN threshold (0.90), this
//     exact boundary case should NOT alert (90% is not below 90%) —
//     mirrors the unit test's "exactly at threshold" boundary assertion,
//     now verified against real inserted rows rather than mocked ones.

export {};