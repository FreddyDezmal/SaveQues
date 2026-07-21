/**
 * tests/integration/username-flow.test.ts
 *
 * Same rationale as this codebase's other tests/integration/*.test.ts
 * files: the availability RPC, the format/uniqueness CHECK constraint,
 * and the backfill migration all depend on real Postgres behavior a
 * mocked client can't honestly exercise. Require a real Supabase *test*
 * project. See lib/username.ts's own unit tests for the pure format/
 * slugify logic, which IS covered with real assertions.
 */
import { describe, it } from "vitest";

describe("is_username_available RPC (058)", () => {
  it.todo(
    "returns true for an unused, well-formed username, false for one already taken (case-insensitively), " +
      "and false (not an error) for a malformed one. " +
      "SEED: a profile with username='alexsaver'. " +
      "ACTION: call is_username_available for 'brandnewname', 'AlexSaver' (different case), 'ab' (too short), " +
      "and 'has space' (invalid chars). " +
      "ASSERT: true, false, false, false respectively — malformed input returns false rather than raising, " +
      "so GET /api/profile/username-available never 500s on bad client input reaching the RPC."
  );

  it.todo(
    "is callable by a completely unauthenticated (anon) caller, matching GET /api/invitations/preview's " +
      "precedent for pre-auth-reachable RPCs. " +
      "ACTION: call the RPC with no Supabase session at all. " +
      "ASSERT: it returns a boolean, not an authorization error — required for the signup form's live " +
      "check, which runs before an account exists."
  );
});

describe("POST /api/profile/username", () => {
  it.todo(
    "requires authentication, rejects malformed input with a clean 400, and rejects a taken username with " +
      "a clean 409 rather than a raw Postgres unique-violation error surfacing to the client. " +
      "SEED: user A with username='alexsaver'; user B, signed in, with username=null. " +
      "ACTION 1: POST as B with username='a!' (invalid format). " +
      "ASSERT 1: HTTP 400, B's username still null. " +
      "ACTION 2: POST as B with username='AlexSaver' (same as A's, different case — the unique index is " +
      "case-insensitive). " +
      "ASSERT 2: HTTP 409 'That username is already taken.'; B's username still null; A's username " +
      "untouched. " +
      "ACTION 3: POST with no auth session at all, any body. " +
      "ASSERT 3: HTTP 401."
  );

  it.todo(
    "a user can change their own already-set username to a new, available one, freeing up the old one " +
      "for someone else. " +
      "SEED: user A with username='alexsaver'. " +
      "ACTION: POST as A with username='alexthesecond'; then, as a different user C, POST with " +
      "username='alexsaver' (A's OLD handle). " +
      "ASSERT: A's profile now has username='alexthesecond'; C's POST for 'alexsaver' succeeds (the old " +
      "value isn't reserved once changed away from)."
  );

  it.todo(
    "is rate limited (10/hour) against rapid-fire username cycling. " +
      "ACTION: POST 11 times as the same authenticated user, each with a different, available username. " +
      "ASSERT: the 11th response is HTTP 429; the first 10 each succeeded and the profile's username " +
      "reflects the 10th, not an earlier one."
  );
});

describe("Backfill migration (058) — existing users with username IS NULL", () => {
  it.todo(
    "gives every pre-existing NULL-username profile a slug of their display_name, and is idempotent. " +
      "SEED: profiles with display_name values 'Alex Saver', '🚀🚀🚀' (no ASCII-safe characters at all), " +
      "and 'Jo' (too short even after slugifying), all with username=null. " +
      "ACTION: run the migration's backfill block (or re-run the whole migration file against a DB where " +
      "it already ran once). " +
      "ASSERT: 'Alex Saver' → 'alexsaver'; the emoji-only one and 'Jo' both fall back to a " +
      "'user_<uuid-without-dashes>'-shaped value (never left null, never a value under 3 chars); every " +
      "resulting username satisfies profiles_username_format; re-running the migration changes nothing " +
      "further (no username IS NULL rows remain, so the loop has nothing left to touch)."
  );

  it.todo(
    "resolves collisions between two existing users who share a display_name with numeric suffixes, " +
      "rather than failing the migration on a unique-constraint violation. " +
      "SEED: THREE profiles all with display_name='Alex', username=null. " +
      "ACTION: run the backfill block. " +
      "ASSERT: all three end up with distinct usernames sharing the 'alex' base (e.g. 'alex', 'alex_2', " +
      "'alex_3', or equivalent) — the migration completes without error, and LOWER(username) is unique " +
      "across all three afterward."
  );
});

describe("Signup flow application (both auth-completion paths)", () => {
  it.todo(
    "email-confirmation-OFF signup applies the chosen username directly (client-side call), since this " +
      "path never reaches /auth/callback at all — the same gap Sprint 22.5 found for invite continuation. " +
      "SEED: Supabase project configured with email confirmation disabled; an available username chosen " +
      "in the signup form. " +
      "ACTION: complete signup. " +
      "ASSERT: the new profile's username matches what was chosen, without the user visiting Settings."
  );

  it.todo(
    "email-confirmation-ON signup applies the username via /auth/callback after the confirmation link is " +
      "clicked, mirroring the existing starter-goal pattern in that file exactly. " +
      "SEED: Supabase project requiring email confirmation; an available username chosen in the signup form. " +
      "ACTION: complete signup, then click the confirmation link. " +
      "ASSERT: the profile's username is set after landing on /dashboard (or the pending invite, if any) — " +
      "not left null."
  );

  it.todo(
    "a username lost to a race between the live check and actual submission does not block account " +
      "creation — the account still exists with username left null, fixable later from Settings. " +
      "SEED: user A picks 'racer' in the signup form (available at check time); before A submits, user B " +
      "independently claims 'racer' first. " +
      "ACTION: A completes signup. " +
      "ASSERT: A's account is created successfully regardless; A's profile.username is null (POST " +
      "/api/profile/username's 409 was swallowed, not surfaced as a signup failure); A can set a " +
      "different username afterward from Settings."
  );
});
