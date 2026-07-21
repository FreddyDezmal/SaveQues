/**
 * lib/pendingInvite.ts
 *
 * Sprint 22.5. Carries an invite token across the one gap in this
 * codebase's existing continuation infrastructure: `/auth/callback`
 * already supports a `next` redirect param (see its own file header),
 * but two of the three ways a user actually finishes authenticating
 * never touch that route at all —
 *   - app/auth/login/page.tsx: signInWithPassword() succeeds, then
 *     `router.push("/dashboard")` client-side. No server round trip.
 *   - app/auth/signup/page.tsx: signUp() with email confirmation OFF
 *     returns a live session immediately; same direct client-side push.
 * Neither has anywhere to read a `next` query param from. A `next=`
 * param DOES get threaded through the third path (signup requiring
 * email confirmation → `/auth/callback`, see signup/page.tsx), so this
 * cookie is only load-bearing for the other two — but is used
 * consistently across all three for one code path instead of three.
 *
 * ── Why a plain, unsigned cookie is fine here (Phase 7 reasoning) ──────
 * This cookie carries only an invite token — the exact same value
 * already sitting in the shareable /invite/{token} URL the visitor
 * opened. Reading or tampering with it grants nothing beyond what
 * already having that same URL would: POST /api/invitations/redeem
 * independently re-validates token status/expiry, requires real auth,
 * and enforces self-referral / one-redemption-per-account / one-time-use
 * itself (053_invitations.sql — unchanged by this feature). The cookie
 * is a hand-off mechanism, not a security boundary; signing it would
 * protect a value that was never secret in the first place.
 */

const COOKIE_NAME = "sq_pending_invite";
const MAX_AGE_SECONDS = 30 * 60; // 30 minutes — long enough for a signup form + email round trip, short enough that an abandoned flow doesn't linger indefinitely.

export function setPendingInviteCookie(token: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

export function getPendingInviteCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function clearPendingInviteCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
}

export const PENDING_INVITE_COOKIE_NAME = COOKIE_NAME;
