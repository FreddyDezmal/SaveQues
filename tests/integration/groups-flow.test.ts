/**
 * tests/integration/groups-flow.test.ts
 *
 * Sprint 22 — Phase 16. Same rationale as friend-system-flow.test.ts.
 * Depends on 045/048's triggers (handle_new_group, user_group_role,
 * enforce_group_member_transition) and RLS — needs a real Supabase
 * *test* project with seeded test users.
 */
import { describe, it } from "vitest";

describe("POST /api/groups/create", () => {
  it.todo(
    "creating a group makes the creator its owner via the handle_new_group trigger, with no separate step. " +
      "SEED: an authenticated user A, no existing groups. " +
      "ACTION: POST as A with { name:'Roommates', description:'...' }. " +
      "ASSERT: response includes the new group id; a groups row exists with owner_id=A; a group_members " +
      "row exists for A with role='owner' and status='active' — created by the trigger, not a second " +
      "application-level insert."
  );
});

describe("POST /api/groups/join and /api/groups/join/respond", () => {
  it.todo(
    "a join request lands as pending_approval and only the owner/an admin can approve it. " +
      "SEED: an existing group owned by A, with B not a member. " +
      "ACTION: POST /api/groups/join as B with { groupId }; then POST /api/groups/join/respond as a " +
      "third user C who is only a regular 'member' (not owner/admin) with { memberId, action:'approve' }. " +
      "ASSERT: after the join request, a group_members row exists for B with status='pending_approval'; " +
      "C's approve attempt is HTTP 403 (048's trigger refuses non-owner/admin approval) and B's row is " +
      "unchanged; a subsequent approve by A succeeds and flips B's row to status='active'."
  );

  it.todo(
    "re-requesting to join after a past decline replaces the stale row rather than erroring. " +
      "SEED: a group_members row for B with status='declined' (rejected join request). " +
      "ACTION: POST /api/groups/join as B with the same groupId again. " +
      "ASSERT: response succeeds; exactly one group_members row exists for the (group, B) pair, now " +
      "status='pending_approval'."
  );
});

describe("POST /api/groups/members/role", () => {
  it.todo(
    "only the owner can promote a member to admin or demote an admin — an admin cannot promote another. " +
      "SEED: a group with owner A, admin B, and regular member C (all status='active'). " +
      "ACTION: POST as B (admin, not owner) to change C's role to 'admin'. " +
      "ASSERT: HTTP 403 (enforce_group_member_transition, 048); C's role is unchanged. " +
      "A subsequent identical request as A (the owner) succeeds and C's role becomes 'admin'."
  );
});

describe("POST /api/groups/members/remove and POST /api/groups/delete", () => {
  it.todo(
    "a member can remove themselves (leave, 'active'→'removed'); the same transition is refused entirely " +
      "for the owner's own row, by the owner/admin or by themselves. " +
      "SEED: a group with owner A and member B, both status='active'. " +
      "ACTION: POST /api/groups/members/remove as A targeting A's OWN membership row. " +
      "ASSERT: HTTP 403 (048's trigger refuses the owner's own active→removed transition); A's row is " +
      "still status='active'. B removing themselves via the same endpoint succeeds and B's row becomes " +
      "status='removed' (the row itself is not deleted)."
  );

  it.todo(
    "deleting a group cascades group_members/group_quests/activity_feed rows, but only severs (nulls) " +
      "the group_id on any shared_goals row — it never touches the underlying savings_goals row or its " +
      "owner's real money. " +
      "SEED: a group owned by A with 3 members, one group_quests row, an activity_feed row tagged to " +
      "the group, and one shared_goals row (group_id = this group) whose underlying savings_goals row " +
      "has a nonzero current_amount. " +
      "ACTION: POST /api/groups/delete as A (the owner). " +
      "ASSERT: HTTP 403 if attempted by a non-owner, unchanged; as the owner: the groups row is gone; " +
      "all group_members and group_quests rows for that group_id are gone; the activity_feed row for " +
      "that group_id is gone; the shared_goals row still exists but with group_id=NULL; the underlying " +
      "savings_goals row and its current_amount are completely unchanged."
  );
});
