/**
 * tests/integration/accountability-partner-flow.test.ts
 *
 * Sprint 22 — Phase 16. Same rationale as friend-system-flow.test.ts:
 * these depend on the enforce_single_accountability_partner and
 * enforce_accountability_transition triggers (045, 047), which only a
 * real Postgres instance can exercise. Require a real Supabase *test*
 * project with seeded test users.
 */
import { describe, it } from "vitest";

describe("POST /api/partner/request", () => {
  it.todo(
    "requesting a partner while the caller already has an active (pending or accepted) partnership " +
      "is rejected by the single-partner trigger, translated to a clean 409. " +
      "SEED: user A already has an accepted accountability_partners row with C. " +
      "ACTION: POST as A with targetUserId=B (a third user). " +
      "ASSERT: HTTP 409, not a raw Postgres constraint-violation message; no new " +
      "accountability_partners row was inserted; A's existing partnership with C is untouched."
  );

  it.todo(
    "a mutual request (B already requested A) auto-accepts, mirroring the friend system's behavior. " +
      "SEED: a pending accountability_partners row, requester_id=B, partner_id=A. " +
      "ACTION: POST as A with targetUserId=B. " +
      "ASSERT: response status='accepted'; the SAME row now status='accepted'; a partner_accepted " +
      "notification queued for B."
  );
});

describe("POST /api/partner/respond", () => {
  it.todo(
    "only the invited partner_id can accept — not the requester, and not an unrelated user. " +
      "SEED: a pending accountability_partners row, requester_id=A, partner_id=B. " +
      "ACTION: POST as A (the requester) with { accountabilityId, action:'accept' }. " +
      "ASSERT: HTTP 403; row status unchanged at 'pending' (proves both the route's explicit check AND " +
      "the 047 trigger refuse this, not just the route)."
  );
});

describe("GET /api/partner", () => {
  it.todo(
    "exposes only the fields this sprint's privacy rules allow — never a raw balance or goal amount. " +
      "SEED: an accepted partnership between A and B, where B has an active savings goal with a real " +
      "current_amount/target_amount. " +
      "ACTION: GET as A. " +
      "ASSERT: response includes B's streak/consistency/last-active-style fields per get_partner_status " +
      "(045/047); response JSON contains no numeric field traceable to B's current_amount or " +
      "target_amount on any goal."
  );
});

describe("POST /api/partner/nudge", () => {
  it.todo(
    "a nudge can only be sent to the caller's own active partner, and is capped at 3/day per sender. " +
      "SEED: an accepted partnership between A and B. " +
      "ACTION: POST as A four times within the same 24-hour window (windowMinutes:1440, maxRequests:3 " +
      "per rateLimit config for partner.nudge). " +
      "ASSERT: the first 3 POSTs succeed and each queues a partner_reminder-style notification for B; " +
      "the 4th POST in the same window is HTTP 429, and no 4th notification is queued."
  );
});
