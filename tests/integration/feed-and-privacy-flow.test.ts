/**
 * tests/integration/feed-and-privacy-flow.test.ts
 *
 * Sprint 22 — Phase 16 (Phase 12's privacy audit made executable).
 * The core claim under test — no financial amount is ever reachable
 * through a social endpoint outside shared-goals/detail's documented
 * exception — is a negative property across many rows and RLS policies,
 * which only a real Postgres instance can actually prove or disprove.
 * Require a real Supabase *test* project.
 */
import { describe, it } from "vitest";

describe("GET /api/feed", () => {
  it.todo(
    "every activity_feed row type contains no amount/balance field, confirmed at the schema level, " +
      "not just by convention. " +
      "SEED: trigger at least one of each documented feed event type — goal_completed, " +
      "achievement_unlocked, streak_milestone, group_joined, group_quest_completed, and level_up (via " +
      "postLevelUpToFeed) — for a user with a real, nonzero goal balance. " +
      "ACTION: GET /api/feed as a friend who can see these events. " +
      "ASSERT: none of the returned rows, for any event type, contains a numeric field traceable to " +
      "current_amount, target_amount, or any transactions.amount — grep the full JSON response for the " +
      "actor's real balance figures and find zero matches."
  );

  it.todo(
    "respects per-row visibility (can_view_activity_row, 051) — a stranger sees nothing, a friend sees " +
      "friends-visible rows, only a shared group sees group-only rows. " +
      "SEED: user A has a goal_completed event with visibility='friends' and a group_joined event with " +
      "visibility='group'. User B is A's friend but shares no group with A. User C shares a group with A " +
      "but isn't a friend. User D is neither. " +
      "ACTION: GET /api/feed as B, C, and D respectively. " +
      "ASSERT: B sees the friends-visible event but not the group-only one; C sees the group-only event " +
      "but not the friends-visible one; D sees neither."
  );

  it.todo(
    "cursor pagination via `before` never repeats or skips a row across pages. " +
      "SEED: 40 visible feed events for the caller, each with a distinct created_at. " +
      "ACTION: GET with limit=30, then GET again with before=<last row's created_at from page 1>. " +
      "ASSERT: page 1 returns 30 rows; page 2 returns the remaining 10; concatenating both pages " +
      "reproduces the full 40, in order, with no duplicate id and no gap."
  );
});

describe("POST /api/feed/hide", () => {
  it.todo(
    "a user can only delete their OWN feed entries — RLS refuses another user's, even one they can see. " +
      "SEED: a visible goal_completed feed row where actor_id=A, and A's friend B who can see it. " +
      "ACTION: POST /api/feed/hide as B, targeting A's row. " +
      "ASSERT: the row still exists afterward (RLS activity_feed_delete_own, 045, refuses it); A hiding " +
      "the same row as themselves succeeds and it disappears from A's own feed and everyone else's."
  );
});

describe("POST /api/achievements/visibility", () => {
  it.todo(
    "a per-achievement override takes precedence over the profile-level default, and clearing it " +
      "(visibility: null) falls back to that default again. " +
      "SEED: user A's profiles.activity_visibility='friends' (the account-level default); A has one " +
      "earned achievement with no override yet. " +
      "ACTION 1: as A, POST { achievementId, visibility: 'private' } for that achievement, then GET " +
      "A's achievements as A's friend B. " +
      "ASSERT 1: B does NOT see that achievement (the private override beats the friends-level default), " +
      "even though B would see A's other, non-overridden achievements. " +
      "ACTION 2: as A, POST { achievementId, visibility: null } to clear the override, then GET again as B. " +
      "ASSERT 2: B now sees it again, governed by the profile-level 'friends' default."
  );
});
