/**
 * tests/integration/group-quests-flow.test.ts
 *
 * Sprint 22 — Phase 16. Same rationale as friend-system-flow.test.ts.
 * The two-step, two-client authorization in check-completion (normal
 * RLS-respecting client for membership proof, then a service-role RPC
 * that's REVOKEd from `authenticated` entirely, 050) can only be proven
 * end-to-end against a real Supabase *test* project — a mocked client
 * would just assert "we called the RPC," not that the trust boundary
 * actually holds.
 */
import { describe, it } from "vitest";

describe("POST /api/group-quests/check-completion", () => {
  it.todo(
    "a non-member of the quest's group gets 404, not 403 — RLS makes the row simply not exist for them. " +
      "SEED: an active group_quests row belonging to a group user C is NOT a member of. " +
      "ACTION: POST as C with { groupQuestId }. " +
      "ASSERT: HTTP 404 (the group_quests SELECT policy, 045, returns zero rows to a non-member — this " +
      "route can't distinguish 'doesn't exist' from 'not your group', by design)."
  );

  it.todo(
    "is idempotent: calling it again after completion is a safe no-op, not a double-award. " +
      "SEED: a group_quests row whose condition is already met and which has already been marked " +
      "completed, with members_awarded XP already applied. " +
      "ACTION: POST as an active member of the group, twice in a row. " +
      "ASSERT: both calls return 200; data.completed reflects the already-completed state; no member's " +
      "XP total increases a second time; no duplicate group_quest_completed notification is sent."
  );

  it.todo(
    "settling the quest increments group XP once and awards xp_reward to every currently-active member, " +
      "excluding any member who left before completion. " +
      "SEED: a group_quests row whose condition is now met (not yet completed), for a group with 3 " +
      "active members and 1 'removed' former member who contributed earlier. " +
      "ACTION: POST as one of the 3 active members. " +
      "ASSERT: data.completed=true; data.members_awarded contains exactly the 3 currently-active member " +
      "ids (not the removed member); each awarded member's XP increases by exactly xp_reward; the " +
      "group's XP total increases by the quest's group XP amount exactly once; each awarded member " +
      "receives a group_quest_completed notification."
  );

  it.todo(
    "more than 20 completion checks for the same user within 10 minutes are rate-limited. " +
      "ACTION: POST 21 times as the same active member, against 21 different (or the same, not-yet-" +
      "completable) group_quest ids within a 10-minute window. " +
      "ASSERT: the 21st response is HTTP 429."
  );
});

describe("POST /api/group-quests/create", () => {
  it.todo(
    "only an owner/admin can create a group quest (group_quests_insert_owner_or_admin, 045), and the " +
      "questType must be one of the four types this schema actually understands. " +
      "SEED: an active group with owner A, admin B, and regular member C. " +
      "ACTION 1: POST as C (regular member) with a valid body (questType:'everyone_saves_this_week', " +
      "title, startDate, endDate). " +
      "ASSERT 1: rejected by RLS; no group_quests row created. " +
      "ACTION 2: POST as B (admin) with questType:'target_amount_together' but no targetValue. " +
      "ASSERT 2: HTTP 400 (\"target_amount_together requires a positive targetValue\"); no row created. " +
      "ACTION 3: POST as B with questType:'target_amount_together' and a valid targetValue. " +
      "ASSERT 3: a group_quests row is created with status reflecting the given startDate/endDate window."
  );
});
