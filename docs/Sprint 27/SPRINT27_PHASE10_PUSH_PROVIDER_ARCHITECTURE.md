# Sprint 27 — Phase 10: Push Provider Architecture

## 1. What this phase is

"Same philosophy [as Phase 9]. Prepare interfaces. No vendor lock-in.
Future: Firebase, OneSignal, Expo, Apple Push."

## 2. The one structural difference from Phase 9, stated up front

Email (Phase 9) had **nothing** integrated before that phase — the
honest default was a null provider that sends nothing. Push is
different: `lib/webpush.ts` is a real, already-working, **currently
live in production** standards-based Web Push implementation. Defaulting
this phase's selector to a null provider would be a regression — it
would silently stop delivering notifications this app already sends
today. So `selectPushProvider()` defaults to, and falls back to on any
misconfiguration, the existing webpush provider — never a no-op. "No
vendor lock-in" means it's easy to swap *away from* web push later, not
that web push stops working the moment this abstraction exists.

## 3. What this phase built

```
lib/push/
  types.ts                    — PushMessage (= existing PushPayload, reused
                                  not reinvented), PushRecipient, PushProvider
  index.ts                    — selectPushProvider() + sendPush(), defaults
                                  to webpush
  providers/
    webpush.ts                — wraps the existing lib/webpush.ts (ACTIVE)
    expo.ts                   — real adapter (plain fetch, verified shape)
    onesignal.ts               — real adapter (plain fetch, verified shape)
    firebase.ts                 — real adapter (OAuth2 JWT flow, verified shape)
    apns.ts                     — documented STUB send(), but a REAL, tested JWT builder
```

`lib/notifications.ts`'s `sendToUser()` now calls `sendPush()` instead of
`sendWebPushWithRetry()` directly. **Zero business logic changed** at
that call site beyond the import and building a `PushRecipient` instead
of a raw subscription object — same retries (Phase 8's bounded retry
lives inside the webpush provider, unchanged), same `gone`-detection,
same deactivation-on-permanent-failure behavior.

## 4. Four adapters, two different reasons one of them is "only partly real" — and why that's not the same reason as Phase 9's SES

**Expo and OneSignal** are straightforward: one static credential (or,
for Expo, none at all for basic sends), simple JSON POST, verified
against each provider's current docs via web search during this phase
(not written from memory).

**Firebase Cloud Messaging is fully implemented, including its OAuth2
flow** — and this is worth contrasting directly with Phase 9's decision
to stub SES, because on the surface both involve "more than a static API
key" and it would be easy to apply the same caution reflexively without
re-examining whether it actually applies:
- FCM's flow is JWT-sign (RS256) → POST to a standard OAuth2 token
  endpoint → use the returned Bearer token. The signing step is
  mechanically **identical** to what `lib/webpush.ts`'s `buildVapidJwt()`
  already does correctly in production for VAPID — same header/claims/
  sign/base64url shape, just RS256 instead of ES256, and Web Crypto
  supports both natively. This app already has proof this exact
  approach works.
- AWS SigV4 (why SES was stubbed in Phase 9) is a *single* algorithm
  with many interdependent exact-match steps — canonical request
  construction, header trimming/lowercasing, sorted query strings, a
  payload hash, a 4-round HMAC key derivation — where getting any one
  step subtly wrong silently breaks the whole signature.

FCM is two independently-simple, well-documented operations composed
together; SES is one fragile, many-detailed operation. That distinction
is why FCM got a real implementation this phase and SES didn't get one
last phase — not an inconsistency, a judgment call re-applied to
different facts.

**Apple Push Notification service (APNs) is a documented stub for a
genuinely different reason than SES, too — a hard transport blocker, not
a complexity judgment call.** APNs' HTTP API requires HTTP/2
specifically (confirmed via search: *"APNs requires HTTP/2 for push
requests. If your server uses HTTP/1.1 or older protocols, the request
will fail"*). Node's built-in `fetch` (undici) does not negotiate HTTP/2
for outgoing requests. Node has a separate `http2` core module, but it's
a fundamentally different, stream/callback-based API incompatible with
the fetch-based shape every other adapter in this project uses — reliably
driving it correctly (session reuse, stream lifecycle, frame-level
headers) is real additional work this phase didn't take on.

**What IS real in `apns.ts`:** `buildApnsProviderJwt()`, APNs' token-auth
JWT builder, using the exact same ES256 pattern already proven correct
in `webpush.ts`. This phase went further than just asserting that by
analogy — `tests/unit/pushProvider.test.ts` generates a real EC P-256
keypair, builds a JWT with it, and cryptographically verifies the
resulting signature against the matching public key. That's checkable
without a live network call, unlike the actual APNs `send()`, which
remains a stub — calling it throws immediately with a clear message
rather than attempting an HTTP/1.1 request APNs will simply reject.

## 5. "No vendor lock-in" — enforced structurally, same as Phase 9

`selectPushProvider()` reads `PUSH_PROVIDER` from the environment; unset
(or `"webpush"`) always resolves to the existing webpush provider.
Confirmed via grep that no `PUSH_PROVIDER`/`FIREBASE_*`/`ONESIGNAL_*`/
`EXPO_*`/`APNS_*` env var is set anywhere in this project (only the
pre-existing `VAPID_*` vars webpush.ts already used). The four
alternative adapters exist, three are genuinely correct, and all four
are completely inert until someone deliberately configures one.

## 6. Verified / recommended / future work / known limitations

**Verified** (actually run in this sandbox):
- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors from before Phase 3 remain.
- `npx vitest run` (full suite) — 460 passed, 0 failed (up from 448
  before this phase — the +12 are `tests/unit/pushProvider.test.ts`).
- Every real adapter's request-building logic is unit tested (URL, auth
  header shape, body shape), same boundary as Phase 9's email tests.
- `buildApnsProviderJwt()` specifically verified with a real generated
  keypair and a real `crypto.subtle.verify()` signature check — not
  just a shape assertion — because it's the one piece of genuinely
  security-sensitive code in this phase that's actually checkable
  offline.
- Confirmed via grep that no push-provider env var beyond the
  pre-existing VAPID ones is set anywhere in this project, backing the
  §5 claim.
- Manually confirmed `sendToUser()`'s migration preserves identical
  observable behavior: same retry logic (still inside the webpush
  provider), same permanent-failure (`gone`) detection and subscription
  deactivation, same result shape.

**Recommended, not yet built:**
- A real APNs `send()` via Node's `http2` module or `node-apn` — the
  JWT half of this work is already done and tested (§4).
- Multi-recipient support. Every adapter here sends to one recipient at
  a time, matching how `sendToUser()` already loops per-subscription —
  Expo and FCM both support batching many recipients into one request,
  which would reduce request count at scale but wasn't needed to match
  existing behavior.

**Future work (explicitly out of scope for Phase 10):**
- Per-platform payload customization (Android-specific channels/icons,
  iOS-specific sound/badge fields) — every adapter here sends the same
  title/body/data shape regardless of target platform; providers like
  FCM support richer per-platform overrides (`android`/`apns`/`webpush`
  blocks in the same message) that aren't used here.
- Delivery-receipt polling for Expo (tickets vs. confirmed delivery) or
  bounce/feedback handling for FCM's token-invalidation signals beyond
  the single-send 404/UNREGISTERED case already handled.

**Known limitations:**
- FCM's access token is re-minted on every single send (a fresh JWT +
  token exchange per notification) rather than cached for its ~1-hour
  validity window — correct, but wasteful at scale. Caching would need
  a small in-memory (or Redis-backed, given this runs across serverless
  invocations) token store with expiry tracking — reasonable follow-up,
  not built here to keep this phase's scope to "the abstraction," not
  "the abstraction, optimized."
- OneSignal's and FCM's "permanent failure" (`gone`) detection is
  pattern-matched from error text/status rather than exhaustively
  enumerated against each provider's full error taxonomy — sufficient
  for the common case (invalid/unregistered token) but not guaranteed
  to catch every permanent-failure variant either provider can return.
