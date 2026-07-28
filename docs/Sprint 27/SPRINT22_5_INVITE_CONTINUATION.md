# Sprint 22.5 — Seamless Invitation Continuation

## Phase 1 — Audit (done before any code was written)

**How middleware protects routes.** Read in full (`middleware.ts`). Three
rules: unauthenticated users are bounced to `/auth/login` off any
non-public page; unconfirmed-email users are held at `/auth/verify-email`
or `/auth/setting-up`; confirmed users are bounced off `/auth/*` pages to
`/dashboard`. `/invite/{token}` was already added to the public allowlist
in Sprint 22 Phase 18 — none of the three rules apply to it. **Conclusion:
no middleware changes were needed**, and none were made.

**How the auth callback currently redirects.** `app/auth/callback/route.ts`
already reads a `next` search param (defaulting to `/dashboard`) and
redirects there after exchanging the OAuth/email-confirmation code for a
session. This is real, existing continuation infrastructure — reused
directly, not rebuilt.

**Whether a `next` parameter already exists.** Yes, but its reach is
narrower than it first appears. Auditing every place a session actually
becomes live found **three separate completion paths**, and only one of
them ever touches `/auth/callback` at all:

| Path | Where | Reaches `/auth/callback`? |
|---|---|---|
| Password login | `app/auth/login/page.tsx`, `signInWithPassword()` | No — direct client-side `router.push("/dashboard")` |
| Signup, email confirmation OFF | `app/auth/signup/page.tsx`, session live immediately | No — same direct client-side push |
| Signup, email confirmation ON | same file, `data.session` is null → `/auth/verify-email` → user clicks emailed link | **Yes** |

So the existing `next` param genuinely solves 1 of 3 paths. The other two
needed something that doesn't depend on a server route reading a query
string, since neither one visits a server route at all after auth
succeeds.

**Whether cookies/session storage are already used for continuation
flows.** No — grepped the whole app/components/lib tree for
`document.cookie` and any cookie-helper file; the only existing cookie
handling is Supabase's own session-cookie plumbing inside
`lib/supabase/*` and `middleware.ts`. Sprint 22 Phase 18's
`InviteRedeemClient.tsx` used `sessionStorage` as a stated, documented
placeholder for exactly this gap — but sessionStorage is per-tab, and the
email-confirmation path opens the confirmation link in a **new tab/
context**, where sessionStorage cannot survive. That path needed a real
mechanism; the other two could have used sessionStorage but, for
consistency (one mechanism, not two), also use the same cookie.

**Whether existing redirect helpers can be reused.** Yes, in one
important way: `/auth/callback` already has a pattern for forwarding
freshly-set session cookies into an internal `fetch()` call (used there
to call `/api/onboarding/starter-goal` as the newly-authenticated user).
This confirmed that reading/writing a small cookie on this exact route is
an established pattern in this codebase, not a new idea being introduced.

**Conclusion of the audit:** build one small, new, single-purpose module
(`lib/pendingInvite.ts`) rather than inventing a parallel system per
path — since no existing helper covered the two paths that never reach a
server route, "reuse existing continuation infrastructure" and "don't
invent a parallel implementation" pointed at *extending* the one thing
that already worked (`next`) for the one path that already used it, and
adding the smallest possible new primitive (a cookie) for the two that
didn't.

## Phases 2–4 — Mechanism

1. `/invite/{token}` (`InviteRedeemClient.tsx`), on "Sign up" / "I already
   have an account", sets a cookie (`sq_pending_invite`, 30 min, plain —
   see security reasoning below) *before* navigating.
2. **Signup, email-confirm-on path:** reads that cookie and threads it
   into `emailRedirectTo` as `?next=/invite/{token}` — the **existing**
   `next` param, unmodified in how `/auth/callback` reads it.
3. **Password login / signup-with-immediate-session paths:** read the
   same cookie directly and `router.push(pendingToken ? /invite/{token}
   : /dashboard)` instead of always `/dashboard`.
4. **`/auth/callback` fallback:** if no explicit `next` was given (e.g. a
   resent confirmation email that didn't go through the modified signup
   code), it now also checks the same cookie server-side before falling
   back to `/dashboard`. Purely additive — every existing caller that
   passes an explicit `next` (or none, with no pending invite) behaves
   exactly as before.
5. Landing back on `/invite/{token}` (any path), the already-existing
   Phase 18 logic takes over unmodified: check auth, call **the same**
   `POST /api/invitations/redeem` — no new redemption code was written
   anywhere.

**Profile-creation race, found during this audit, fixed without touching
the RPC.** A brand-new signup can land back on `/invite/{token}`
microseconds after `auth.users` gets a row but before the
`handle_new_user` trigger finishes creating the matching `profiles` row.
`redeem_invite()`'s XP-award `UPDATE ... WHERE id = auth.uid()` would
silently affect zero rows in that instant — Postgres doesn't error on a
no-match `UPDATE`, so the invitee's reward would just quietly vanish.
This exact race already had a mitigation elsewhere in the codebase:
`app/(app)/dashboard/page.tsx` redirects to `/auth/setting-up`, which
polls `GET /api/auth/profile-ready` until the row exists. This new flow
bypasses `/dashboard` by design, so it can't rely on that redirect —
instead, `InviteRedeemClient` now polls that **same existing endpoint**
itself before ever calling redeem. No new readiness check, no RPC
change.

## Phase 5 — Success Experience (one deliberate deviation from the brief)

The brief's mock text included `"🎉 You're now friends with Alex!"`. Audited
`redeem_invite()` (053) again to check: it updates invitation status,
optionally auto-joins a group, awards XP to both sides, and checks the
inviter's referral achievements. **It does not create a `friendships`
row.** Displaying "you're now friends" would tell the user something
false — no friendship exists in the data. That line was not implemented
as written. In its place, the success screen shows real returned data:
XP earned, which group was joined (if any), and — reusing
`inviter_referral_count`, which the RPC already returns — a progress bar
toward *the inviter's* next referral badge (`Plus One` / `Squad Builder`
/ `Community Pillar`, matching `lib/achievements.ts`'s actual thresholds),
correctly framed as the inviter's progress, not the invitee's.

## Phase 6 — Error States

| State | Handling |
|---|---|
| Expired / invalid / already-redeemed token | `not_found` — one generic message for all three, matching `GET /api/invitations/preview`'s own deliberate non-distinguishing design (Sprint 22 Phase 16 audit already established why: distinguishing them would let a token be used to probe state) |
| Self-referral / already-redeemed-another-invite / rate-limited | `redeem_failed`, surfacing the RPC's own error reason |
| Network failure | New `network_error` stage wrapping both the preview and redeem calls in `try/catch`, with a "Try again" retry action that re-runs `attemptRedemption()` rather than reloading the page |
| Authentication cancelled | Not a distinct state — this codebase has no OAuth-popup provider to cancel out of; the closest equivalent (abandoning signup mid-flow) is handled by the cookie's 30-minute expiry, after which the flow behaves as an ordinary, non-invited signup |

## Phase 7 — Security Verification

- **Anonymous users cannot redeem** — unchanged. `POST
  /api/invitations/redeem` still requires `auth.getUser()` to return a
  user (401 otherwise). Nothing in this phase touches that check.
- **Tokens remain one-time** — unchanged. `redeem_invite()`'s `WHERE
  status IN ('pending','sent','opened')` guard is untouched, and this
  phase still only ever calls redeem from the one place Phase 18 already
  called it from — no second call site was added anywhere (the callback
  route redirects to `/invite/{token}`; it does **not** call redeem
  itself, specifically to avoid a duplicate-call path).
- **Reward duplication is impossible** — same reasoning; still exactly
  one redeem call site in the whole codebase.
- **Cookies cannot be tampered with (in any way that matters)** — the
  cookie carries only the invite token, which is already public (it's
  the same value sitting in the shareable URL). Tampering it to a
  *different* token grants nothing beyond what visiting that other
  token's URL directly already would — `redeem_invite()` independently
  re-validates status, expiry, self-referral, and one-redemption-per-
  account regardless of how the client arrived at the call. Signing/
  encrypting it would protect a value that was never secret.
- **Continuation cannot be replayed** — cookie has a 30-minute `max-age`;
  cleared unconditionally the moment `/invite/{token}` mounts (client
  side) and again defensively on `/auth/callback`'s own response
  (server side), so it can't affect a later, unrelated signup even if
  the client-side clear somehow didn't run.
- **Middleware still protects private pages** — verified in Phase 1: zero
  middleware changes were made this phase. The cookie's presence grants
  no route access by itself; only `supabase.auth.getUser()` succeeding
  does, exactly as before.

No RLS policy, RPC, or existing API contract was modified anywhere in
this phase.

## Phase 8 — UX Polish / Reuse

- `Skeleton`, `UserAvatar`, `ShareButton` (existing, one additive prop
  from Phase 18) — all reused as-is.
- `usePrefersReducedMotion` (existing hook, built for
  `CelebrationOverlay` in Sprint 20) — reused directly for the success
  card's entrance animation.
- **Deliberately did not reuse `CelebrationOverlay`** for the success
  state — it's a full-screen dark-backdrop modal built to overlay
  existing app content. `/invite/{token}` is a standalone landing page
  with no app content underneath it; wrapping it in that modal would
  produce a modal-over-nothing mismatch. Kept the same plain-card visual
  language the rest of this page already established in Phase 18
  instead — "maintain visual consistency" was read as consistency with
  *this page*, not forcing in a component built for a different context.

## Verification run

```
tsc --noEmit:      0 errors
next lint (all touched/new files): 0 warnings, 0 errors
vitest (unit + component):  286 passing, 61 todo, 0 failing
```

New files this phase: `lib/pendingInvite.ts`,
`tests/unit/pendingInvite.test.ts` (7 real tests),
`tests/integration/invite-continuation-flow.test.ts` (6 honest `todo`
stubs — this flow spans real cross-tab browser navigation and cookie
survival, which needs a real browser context, not a mock).

Files modified: `app/invite/[token]/InviteRedeemClient.tsx`,
`app/auth/signup/page.tsx`, `app/auth/login/page.tsx`,
`app/auth/callback/route.ts`. `middleware.ts` was audited and
deliberately left unchanged.
