/**
 * tests/integration/leaderboards-flow.test.ts
 *
 * Sprint 22 — Phase 16. Same rationale as friend-system-flow.test.ts.
 * Every leaderboard route (app/api/leaderboards/*) is a thin pass-
 * through to a leaderboard_* RPC (052) that does all scoping and
 * authorization via leaderboard_member_set() — proving that scoping is
 * actually enforced needs a real Postgres instance with real friendships
 * and group_members rows, not a mocked client. Require a real Supabase
 * *test* project.
 */
import { describe, it } from "vitest";

describe("GET /api/leaderboards/xp", () => {
  it.todo(
    "scope=friends only ranks the caller's accepted friends (plus the caller) — never a stranger. " +
      "SEED: user A has 2 accepted friends (B, C) and is aware of a 4th user D who is not a friend. " +
      "ACTION: GET as A with ?scope=friends&period=week. " +
      "ASSERT: the returned rows are exactly {A, B, C} (some subset/all, ranked by weekly XP) — D never " +
      "appears regardless of D's XP total."
  );

  it.todo(
    "scope=group requires membership — a non-member of the given groupId is rejected, not shown an empty list. " +
      "SEED: a group that user E is NOT a member of. " +
      "ACTION: GET as E with ?scope=group&groupId=<that group>. " +
      "ASSERT: rejected (leaderboard_member_set, 052, returns no rows / an authorization error for a " +
      "non-member) rather than a 200 with an empty or partial ranking."
  );

  it.todo(
    "period=week and period=month produce genuinely different windows, not the same all-time total twice. " +
      "SEED: a user with XP awarded 40 days ago and XP awarded 2 days ago. " +
      "ACTION: GET as that user with period=week, then again with period=month. " +
      "ASSERT: the week value reflects only the last-2-days award; the month value reflects both awards " +
      "(assuming a 30-day month window) — the two responses differ."
  );
});

describe("GET /api/leaderboards/streak, /consistency, /goals-completed, /group-contributions, /groups", () => {
  it.todo(
    "no leaderboard response, across all five metrics, ever contains a raw balance or goal amount field — " +
      "notably /group-contributions ranks by contribution_count only, never a summed dollar amount, a " +
      "deliberately conservative reading of 'never expose financial balances' (see 052's file header) " +
      "even though shared-goals/detail already shows real amounts to fellow contributors on that goal. " +
      "SEED: a friend group where members have varying real savings_goals.current_amount values and " +
      "varying group_contributions row counts. " +
      "ACTION: GET each of /api/leaderboards/streak, /consistency, /goals-completed, " +
      "/group-contributions (with a valid groupId), and /groups as a member. " +
      "ASSERT: none of the five responses contains a field traceable to current_amount, target_amount, " +
      "or transactions.amount for any ranked member; /group-contributions specifically returns " +
      "contribution_count (an integer count), never a summed amount."
  );
});
