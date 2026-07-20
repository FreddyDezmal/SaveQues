/**
 * tests/integration/invitations-flow.test.ts
 *
 * Sprint 22 — Phase 16. Same rationale as friend-system-flow.test.ts.
 * redeem_invite() (053) is the one place this sprint hands out XP for an
 * event the recipient didn't perform themselves (the inviter's reward),
 * via a direct xp_awards insert rather than award_xp() — exactly the
 * kind of trust-boundary logic that must be proven against a real
 * Postgres instance, not a mock. Require a real Supabase *test* project.
 */
import { describe, it } from "vitest";

describe("GET /api/invitations/preview", () => {
  it.todo(
    "works without authentication and reveals only inviter display name/avatar and group name — never email " +
      "or the raw invitations row — and returns the identical 'not found' shape for an unknown, expired, " +
      "or already-redeemed token so a token can't be used to probe state. " +
      "SEED: a valid pending invite from A; a second invite already status='redeemed'; a third invite " +
      "with expires_at in the past. " +
      "ACTION: GET /api/invitations/preview with no auth header, once per token (valid, redeemed, expired, " +
      "and one fabricated nonexistent token). " +
      "ASSERT: the valid token returns { inviter: { display_name, avatar_emoji }, context_type, group? } " +
      "and nothing else identifying A (no email); the redeemed, expired, and nonexistent tokens all " +
      "return the SAME null/not-found shape, indistinguishable from each other."
  );
});

describe("POST /api/invitations/redeem", () => {
  it.todo(
    "a successful redemption awards the inviter 100 XP and the invitee 50 XP exactly once, even if " +
      "redeem is somehow called twice (ON CONFLICT DO NOTHING on the xp_awards unique key). " +
      "SEED: a valid pending invite from A, targeting no one in particular (a general share link); " +
      "user B has never redeemed any invite. " +
      "ACTION: POST as B with the token, twice in a row. " +
      "ASSERT: first call returns { success:true, invitee_xp:50, ... }; A's xp_total increases by " +
      "exactly 100 and B's by exactly 50, both only once; the invitations row now status='redeemed', " +
      "redeemed_by=B; the second identical call does not increase either total again."
  );

  it.todo(
    "an invite to a group auto-joins the invitee as an active member — no separate accept step. " +
      "SEED: a valid pending invite from group owner A with context_type='group', group_id=<A's group>. " +
      "ACTION: POST as B with the token. " +
      "ASSERT: response.joined_group_id equals the group's id; a group_members row now exists for B " +
      "with status='active' (not 'pending_approval') and invited_by=A."
  );

  it.todo(
    "the inviter cannot redeem their own invite (self_referral), and a user who already redeemed a " +
      "DIFFERENT invite cannot redeem a second one, ever. " +
      "SEED: A's own pending invite; separately, user C who has already redeemed some other invite from " +
      "a different inviter D. " +
      "ACTION 1: POST as A with A's own token. " +
      "ASSERT 1: { success:false, error:'self_referral' }; no XP awarded to anyone; invite still pending. " +
      "ACTION 2: POST as C with a fresh, valid invite from a third inviter E. " +
      "ASSERT 2: { success:false, error:'already_redeemed_another_invite' }; E's XP is unchanged; the " +
      "fresh invite is still unredeemed."
  );

  it.todo(
    "referral achievements unlock at exactly 1, 5, and 10 lifetime successful redemptions for the " +
      "inviter, and never re-fire at other counts. " +
      "SEED: inviter A with 0 prior redeemed invites. " +
      "ACTION: have 10 different users redeem 10 separate invites created by A, one at a time, checking " +
      "A's user_achievements after each. " +
      "ASSERT: A gains 'referral_first' after the 1st redemption, 'referral_five' after the 5th, " +
      "'referral_ten' after the 10th, and no new achievement row is inserted after redemptions 2-4, " +
      "6-9 — response.inviter_referral_count matches the running count at every step."
  );
});

describe("POST /api/invitations/create", () => {
  it.todo(
    "a group-context invite is only permitted from that group's owner/admin (enforce_invite_permissions, 053). " +
      "SEED: a group with owner A and a regular (non-admin) member B. " +
      "ACTION: POST as B with { contextType:'group', groupId: the group }. " +
      "ASSERT: rejected with a clean 400 (not a raw trigger exception); no invitations row created. " +
      "The identical request as A succeeds and returns a shareable link built from generateInviteToken() " +
      "+ buildInviteUrl() (lib/invites.ts) that resolves via /api/invitations/preview."
  );
});
