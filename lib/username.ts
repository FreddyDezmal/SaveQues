/**
 * lib/username.ts
 *
 * Single source of truth for the username format on the TypeScript side.
 * The database enforces the same rule independently via
 * profiles_username_format (058_username_onboarding.sql) — that's
 * deliberate defense in depth, not duplication to keep in sync by hand:
 * if this regex and the DB's ever drifted, the DB constraint is always
 * the real backstop, and a mismatch would just mean a value this code
 * accepted gets rejected with a clean 500→handled error rather than
 * silently landing malformed.
 */

export const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;

export function isValidUsernameFormat(value: string): boolean {
  return USERNAME_REGEX.test(value);
}

/**
 * Turns a free-text display name into a signup-form suggestion that will
 * always pass isValidUsernameFormat — mirrors (not calls; this runs in the
 * browser, the migration runs in Postgres) the same slugify logic as
 * 058_username_onboarding.sql's backfill: lowercase, strip everything
 * outside [a-z0-9_], fall back to a random-ish suffix if too short.
 * This is only ever a *suggestion* the person can edit — the real
 * uniqueness check happens live against the server either way.
 */
export function slugifyForUsername(input: string): string {
  const base = input.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16);
  if (base.length < 3) {
    return "";
  }
  return base;
}
