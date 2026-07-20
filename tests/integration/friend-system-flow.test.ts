/**
 * tests/integration/friend-system-flow.test.ts
 *
 * Sprint 22 — Phase 16. Following the pattern established in
 * transaction-flow.test.ts (Sprint 18 — Phase 2 fix): honest it.todo()
 * stubs, not fake passing tests. These assert on real inserted
 * friendships rows, real RLS enforcement, and real trigger behavior
 * (046) — none of that can be faked with mocked pure-function unit
 * tests. Require a real Supabase *test* project with two seeded test
 * users (see docs/DEVELOPMENT.md's "Integration tests" section).
 */
import { describe, it } from "vitest";

describe("POST /api/friends/request", () => {
  it.todo(
    "sending a first-ever request creates a pending friendships row and notifies the target. " +
      "SEED: two users, A and B, with no existing friendships row between them. " +
      "ACTION: POST as A with targetUserId=B. " +
      "ASSERT: response { success:true, status:'pending' }; exactly one friendships row with " +
      "requester_id=A, addressee_id=B, status='pending'; a friend_request notification queued for B."
  );

  it.todo(
    "a mutual request (B already requested A) auto-accepts instead of creating a second row. " +
      "SEED: an existing pending friendships row with requester_id=B, addressee_id=A. " +
      "ACTION: POST as A with targetUserId=B. " +
      "ASSERT: response { success:true, status:'accepted', autoAccepted:true }; the SAME row now has " +
      "status='accepted' and a non-null responded_at; still exactly one friendships row for the pair; " +
      "a friend_accepted notification queued for B (the original requester)."
  );

  it.todo(
    "requesting someone who has blocked the caller returns a generic 403 that doesn't reveal the block. " +
      "SEED: a friendships row with status='blocked', blocked_by=B, between A and B. " +
      "ACTION: POST as A with targetUserId=B. " +
      "ASSERT: HTTP 403 with a generic error message (not 'you are blocked' or 'B blocked you'); " +
      "the friendships row is unchanged."
  );

  it.todo(
    "re-requesting after the caller's own declined request resets it to pending, not a duplicate row. " +
      "SEED: a friendships row with status='declined', requester_id=A, addressee_id=B. " +
      "ACTION: POST as A with targetUserId=B. " +
      "ASSERT: response { success:true, status:'pending' }; the SAME row (same id) now has status='pending' " +
      "and responded_at=null; still exactly one friendships row for the pair."
  );

  it.todo(
    "requesting the pair's OTHER direction after a decline replaces the row rather than updating in place " +
      "(requester_id/addressee_id are immutable on UPDATE per 046). " +
      "SEED: a friendships row with status='declined', requester_id=B, addressee_id=A. " +
      "ACTION: POST as A with targetUserId=B. " +
      "ASSERT: response { success:true, status:'pending' }; exactly one friendships row for the pair, now with " +
      "requester_id=A, addressee_id=B (the OLD row's id no longer exists — it was deleted and re-inserted, " +
      "not updated)."
  );

  it.todo(
    "more than 20 friend requests from the same user within 60 minutes are rate-limited. " +
      "ACTION: POST 21 times as A, each with a different, never-before-requested targetUserId. " +
      "ASSERT: the 21st response is HTTP 429; requests 1-20 succeeded; no more than 20 new " +
      "friendships rows were created for A as requester in that window."
  );
});

describe("POST /api/friends/respond", () => {
  it.todo(
    "the addressee can accept a pending request; the requester cannot act on their own outgoing request. " +
      "SEED: a pending friendships row, requester_id=A, addressee_id=B. " +
      "ACTION: POST as A (the requester, not the addressee) with { friendshipId, action:'accept' }. " +
      "ASSERT: HTTP 403 'Only the recipient can respond to this request'; row status unchanged."
  );

  it.todo(
    "accepting a pending request updates status, stamps responded_at, and notifies the original requester. " +
      "SEED: a pending friendships row, requester_id=A, addressee_id=B. " +
      "ACTION: POST as B with { friendshipId, action:'accept' }. " +
      "ASSERT: response { success:true, status:'accepted' }; row now status='accepted' with non-null " +
      "responded_at; a friend_accepted notification queued for A."
  );

  it.todo(
    "responding to an already-resolved request returns 409, not a silent no-op. " +
      "SEED: a friendships row already status='accepted'. " +
      "ACTION: POST as the addressee with { friendshipId, action:'decline' }. " +
      "ASSERT: HTTP 409 'This request is already accepted'; row status unchanged."
  );
});

describe("GET /api/friends/list", () => {
  it.todo(
    "returns accepted friends plus separate pending_incoming/pending_outgoing buckets, " +
      "and never includes a row where the caller is blocked_by the other side. " +
      "SEED: for user A — one accepted friendship, one pending row where A is addressee, one pending row " +
      "where A is requester, one row blocked by the OTHER user against A. " +
      "ACTION: GET as A. " +
      "ASSERT: the accepted friend appears once; the pending_incoming bucket contains only the row where " +
      "A is addressee; the pending_outgoing bucket contains only the row where A is requester; the blocked " +
      "row does not appear in ANY bucket."
  );
});
