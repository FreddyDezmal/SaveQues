# Sprint 27 — Phase 14: Security

## 1. What this phase is

"Audit: Notification spoofing, Unauthorized delivery, Preference bypass,
Replay attacks, Deep-link validation, Sensitive information leakage,
Rate limiting."

This audit reads as more "verified already correct" than most prior
phases — the notification-adjacent API layer (partner/friend/group
routes) was already heavily hardened in earlier sprints, with
consistent patterns: rate limiting, RLS as the real authorization
boundary, user_id-scoped writes, and generic error messages that don't
leak relationship state. Three real, distinct issues were found and
fixed; everything else below is a stated, checked verification, not an
assumption.

## 2. Fixed — deep-link open-redirect defense-in-depth gap

`lib/notificationActions.ts`'s `resolveNotificationHref()` returned
`deep_link` completely unvalidated, straight into `router.push()`.
`public/sw.js`'s `notificationclick` handler had the identical gap for
`client.navigate()`/`openWindow()`. Neither checked that the value was a
same-origin relative path before using it for navigation.

**Is this exploitable today? No** — `deep_link` is exclusively
server-constructed (`/goals/${goalId}`, `/groups/${groupId}`, etc.) from
internal IDs across every sender in `lib/notifications.ts`, and
`notification_logs` has no client-facing INSERT policy at all (RLS only
grants SELECT and a narrow own-row UPDATE for the four tracking
columns) — a user cannot write their own `deep_link` value into the
table. This was fixed as **defense-in-depth**, not a patch for a live
exploit: if any future sender, migration, or bug ever put an
attacker-influenced string into that column, both navigation surfaces
would have trusted it completely.

**Fixed**: `isSafeRelativePath()` in both files rejects anything not
starting with a single `/` — catching absolute URLs
(`https://evil.example.com`), protocol-relative URLs
(`//evil.example.com`, which browsers resolve against the current
protocol but an attacker-chosen host), and `javascript:` pseudo-URLs. A
rejected value falls back to the existing category page, exactly like a
missing `deep_link` already did. 5 new tests cover each rejected
pattern plus confirming ordinary relative paths (including ones with
query strings) still work unchanged.

## 3. Fixed — preference-bypass defense-in-depth inconsistency

Phase 4 put the vacation-mode check inside `sendToUser()` — the one
function every notification path funnels through — specifically reasoning:
*"single choke point ... guaranteed complete coverage, no risk of a
future sender forgetting to check it."* That same reasoning was never
applied to the master `notifications_enabled` switch, which was left
entirely up to each individual caller to check before ever reaching
`sendToUser()`.

**Is this exploitable today? No** — every current sender already checks
`notificationsGloballyEnabled()`/`canSendNotificationToUser()`/`getPref()`
before calling `sendToUser()`, confirmed by re-reading every call site
across `lib/notifications.ts`. Fixed as the same category of
defense-in-depth as §2: **if** a future sender had a bug and skipped
that check, the master switch would have been silently bypassed —
including still creating an in-app inbox log row for a user who
explicitly turned notifications off, not just an unwanted push.

**Fixed**: `sendToUser()` now checks `notificationsGloballyEnabled()`
immediately after the vacation-mode check, applying Phase 4's own stated
reasoning consistently to the switch that reasoning was originally
about, not just the one that happened to get built alongside it.

## 4. Fixed — inaccurate security comment

`app/api/notifications/track/route.ts`'s own security comment claimed
*"RLS on notification_logs only has a SELECT policy ... UPDATE/DELETE
are not permitted via RLS at all."* Reading the actual policy
(`notification_logs_update_own_read_state`, migration 038:
`FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() =
user_id)`) shows this was **factually wrong** — an UPDATE policy has
existed since Sprint 15.

**Is this itself a vulnerability? No** — the route's actual behavior
(explicit `.eq("user_id", user.id)` scoping) was correct either way; RLS
would have blocked a cross-user update even without that explicit
scope. But a comment asserting the wrong security boundary is worth
fixing in a security audit on its own terms: a future engineer reading
"RLS doesn't protect this at all" might make a different, worse decision
(e.g., assuming a service-role bypass is needed somewhere it isn't, or
not noticing that RLS actually is a second layer here). **Fixed** — the
comment now states the real boundary: RLS enforces ownership on writes
via the same client this route already uses, and the explicit scope is
correct defense-in-depth alongside it, not the sole enforcement the old
comment implied.

## 5. Verified, not assumed — audited and confirmed correct

**Notification spoofing.** Every sender that includes a person's display
name (`sendPartnerRequest`, `sendFriendRequest`, `sendGroupInvite`,
`sendPartnerNudge`, etc.) sources it from the authenticated caller's own
`profiles` row (`supabase.from("profiles").select("display_name").eq
("id", user.id)`), never from client-supplied request-body text. A
caller cannot make a notification appear to be from someone else.

**Unauthorized delivery.** Spot-checked the RLS policies gating the
table writes that trigger these sends: `group_members_insert_invite_or
_self_request` (045) requires the caller to actually be the group's
owner or an admin before an `invited`-status row (and therefore
`sendGroupInvite`) can even be created — read the policy directly
rather than trusting the API route's own comment. `group-quests/check-
completion`'s two-step authorization (RLS-scoped read proves membership,
then a REVOKEd-from-`authenticated` service function) was already
explicitly documented and independently verified as sound.

**Rate limiting.** Confirmed present via the shared `checkAttemptRateLimit`/
`recordAttempt` helpers, keyed by the authenticated `user.id` (not
anything client-suppliable), on every notification-triggering endpoint
checked: `partner/nudge` (3/day — the tightest, appropriately, since
it's "a push straight to another person's phone"), `partner/request`,
`friends/request`, `groups/invite`, `shared-goals/invite`, `group-
quests/check-completion`.

**Replay attacks.** `/api/notifications/track` writes are idempotent
(`.is(column, null)` — settable once) and ownership-scoped, so replaying
a captured request can at most let a user mark their own already-sent
notification as delivered/clicked/dismissed again — a no-op, not a new
write. The only theoretical effect is a user self-marking their own
analytics rows, which has no security or reward impact (Phase 11's
metrics are aggregate, admin-only reads; no permission or in-app reward
is ever granted based on these columns).

**Sensitive information leakage.**
- Confirmed no `dangerouslySetInnerHTML` anywhere in the notification UI
  (`NotificationCenter`, `NotificationSettings`, `NotificationPreferencesClient`,
  `DigestClient`, `AchievementsClient`) — title/body content always
  renders as plain React text nodes, so even a maliciously-crafted
  display name or partner-nudge message (`<script>...`) would render as
  inert text, never execute.
- Confirmed the template engine (Phase 7) can't be used for injection:
  `renderTemplate()`'s `String.replace()` call processes the template
  string in a single pass — a substituted value (e.g. a `display_name`
  containing literal `{{xp}}` text) is inserted as-is and never
  re-scanned for further `{{...}}` matches.
- Confirmed the admin analytics route (Phase 11/13) selects only
  aggregate columns (`notification_type, sent_at, delivered_at,
  clicked_at, read_at, dismissed_at, converted_at`) — never `title`,
  `body`, or `user_id` — so no cross-user PII reaches that dashboard.
- **One accepted, documented tradeoff, not "fixed" because fixing it
  would undo earlier work on purpose**: several notification types
  (Phase 3's smart reminders, Phase 5's digests) deliberately include
  real dollar amounts in push bodies — that specificity is the entire
  point of Phase 3's design ("You're only R120 away," not "Save
  today!"). This content can appear in an OS lock-screen preview on a
  phone that isn't unlocked. This app has no control over that at the
  Web Push API level — hiding notification content until unlock is a
  device/OS-level setting, not something a web push payload can
  request. Documented here as a known, accepted, and deliberate
  tradeoff between the product's own stated goals and a privacy
  consideration outside this codebase's technical control — not
  silently ignored, and not "fixed" in a way that would gut Phase 3's
  actual design intent.

**IDOR (insecure direct object reference).** `archive`, `delete`, and
`mark-read` all scope their `UPDATE` by `.eq("user_id", user.id)`, each
backed by the corresponding RLS policy as a second layer — a user
cannot act on another user's notification row by guessing/supplying its
ID.

## 6. Verified / recommended / future work / known limitations

**Verified** (actually run in this sandbox):
- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors from before Phase 3 remain.
- `npx vitest run` (full suite) — 483 passed, 0 failed (up from 478
  before this phase — the +5 are the deep-link validation tests in
  `tests/unit/notificationActions.test.ts`).
- Read the actual RLS policy definitions (not just route comments)
  for `notification_logs` and `group_members` to confirm or correct
  what the application code assumed about them — this is what surfaced
  §4's inaccurate comment.
- Read every sender in `lib/notifications.ts` that includes a person's
  name to confirm the source is always the authenticated caller's own
  profile row, backing §5's spoofing-prevention claim.

**Recommended, not yet built:**
- A rate limit on the notification-preferences `PATCH` endpoint (Phase
  4) — currently unlimited. Low priority: it's a self-service settings
  change with no cross-user effect, not an abuse vector in the way
  nudges/invites are, but a blanket rate limit would be cheap,
  consistent defense-in-depth alongside every other mutating endpoint
  in this system already having one.
- Extending the deep-link validation pattern (§2) to any future
  free-text URL field this app might introduce elsewhere, if any.

**Future work (explicitly out of scope for Phase 14):**
- OS/device-level notification-content privacy (§5's accepted
  tradeoff) — genuinely outside this codebase's control via the Web
  Push API.
- A CSP (Content-Security-Policy) audit for the app as a whole — this
  phase's scope was the notification system specifically, not a
  full-application security review.

**Known limitations:**
- The deep-link fix (§2) is defense-in-depth for a currently-unreachable
  path, not a fix for a demonstrated live exploit — stated plainly so
  it isn't mistaken for evidence of an actual breach.
- This audit did not attempt live penetration testing (no requests were
  actually sent against a running instance) — findings are based on
  careful code and RLS-policy reading, consistent with this sandbox
  having no live Supabase/network infrastructure to test against
  (the same constraint every prior phase's audit has operated under).
