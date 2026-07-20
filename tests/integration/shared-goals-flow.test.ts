/**
 * tests/integration/shared-goals-flow.test.ts
 *
 * Sprint 22 — Phase 16. Same rationale as friend-system-flow.test.ts.
 * The central financial-integrity claim across every test here — real
 * money (savings_goals.current_amount / transactions) is never touched
 * by a contributor's tracked contribution — is exactly the kind of
 * cross-table invariant that only a real Postgres instance with the
 * actual triggers loaded can verify. Require a real Supabase *test*
 * project.
 */
import { describe, it } from "vitest";

describe("POST /api/shared-goals/create", () => {
  it.todo(
    "only the goal's actual owner can share it, and (if groupId is given) only into a group they belong to. " +
      "SEED: user A owns a savings_goals row; user B does not; a group exists that A is NOT a member of. " +
      "ACTION 1: POST as B with { goalId: A's goal }. " +
      "ASSERT 1: rejected (enforce_shared_goal_ownership, 045/049); no shared_goals row created. " +
      "ACTION 2: POST as A with { goalId: A's goal, groupId: the group A isn't in }. " +
      "ASSERT 2: also rejected; no shared_goals row created."
  );
});

describe("POST /api/shared-goals/contribute", () => {
  it.todo(
    "a tracked contribution is written ONLY to group_contributions and never touches the real balance. " +
      "SEED: a shared_goals row wrapping A's savings_goals row (current_amount=500), with B as an " +
      "accepted shared_goal_members row. " +
      "ACTION: POST as B with { sharedGoalId, amount: 100 }. " +
      "ASSERT: response { tracked: true, ... } (never implying a real deposit); a new group_contributions " +
      "row exists for B with amount=100; A's underlying savings_goals.current_amount is STILL 500 — " +
      "completely unchanged; no new row was written to transactions for either A or B."
  );

  it.todo(
    "only an accepted member of the shared goal can contribute — a non-member is rejected. " +
      "SEED: a shared_goals row with no shared_goal_members row for user C. " +
      "ACTION: POST as C with { sharedGoalId, amount: 50 }. " +
      "ASSERT: rejected (enforce_contribution_membership, 045); no group_contributions row created for C."
  );
});

describe("POST /api/shared-goals/unshare", () => {
  it.todo(
    "unsharing deletes only the shared_goals wrapper and its dependents, never the underlying goal or its balance. " +
      "SEED: a shared_goals row (owner A) with 2 shared_goal_members rows and 3 group_contributions rows; " +
      "the underlying savings_goals row has current_amount=750. " +
      "ACTION: POST as A (the owner). " +
      "ASSERT: the shared_goals row is gone; all its shared_goal_members and group_contributions rows are " +
      "gone (ON DELETE CASCADE, 045); the savings_goals row still exists with current_amount STILL 750; " +
      "a non-owner attempting the same call first gets rejected instead."
  );
});

describe("GET /api/shared-goals/detail", () => {
  it.todo(
    "returns real target/current amounts and per-member contribution totals — a deliberate, scoped " +
      "exception to the feed's no-amounts rule (see 049's file header) — and 404s identically for a " +
      "nonexistent id and an id the caller can't see, never distinguishing the two. " +
      "SEED: a shared goal with 2 contributing members and a non-member user C. " +
      "ACTION 1: GET as an actual member. " +
      "ASSERT 1: response includes the real target_amount/current_amount and each member's contribution " +
      "total (via get_shared_goal_detail, 049). " +
      "ACTION 2: GET as C (non-member) with the real sharedGoalId, and separately GET with a " +
      "random nonexistent sharedGoalId. " +
      "ASSERT 2: both return the identical HTTP 404 shape — no information leak distinguishing " +
      "'exists but you can't see it' from 'doesn't exist'."
  );
});
