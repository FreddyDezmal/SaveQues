# SECURITY_AUDIT.md — Sprint 27 (Notification & Communication System)

Final-phase audit. Consolidates Phase 14's dedicated security pass. A
fresh re-check of every notification-triggering route and every RLS
policy referenced by application-code comments was performed for this
final pass; no additional vulnerabilities were found beyond Phase 14's
three, which is reported honestly rather than padded with restated
findings to look more thorough.

## Findings — fixed this sprint

### 1. Deep-link open-redirect defense-in-depth

`lib/notificationActions.ts`'s `resolveNotificationHref()` and
`public/sw.js`'s `notificationclick` handler both used `deep_link`
completely unvalidated for client-side navigation. **Not exploitable
today** — `deep_link` is exclusively server-constructed from internal
IDs, and `notification_logs` has no client-facing INSERT policy at all
(confirmed by reading the actual RLS policies, not the route's own
comments — see finding #3). Fixed as defense-in-depth: `isSafeRelativePath()`
rejects absolute URLs, protocol-relative URLs (`//host/...`), and
`javascript:` pseudo-URLs on both navigation surfaces. 5 tests cover
each rejected pattern.

### 2. Preference-bypass defense-in-depth inconsistency

Phase 4 put vacation mode inside `sendToUser()` (the single choke point
every notification path funnels through) specifically reasoning "no
risk of a future sender forgetting to check it" — but never applied
that same reasoning to the master `notifications_enabled` switch, which
was left entirely to each caller. **Not exploitable today** — every
current sender already checks preferences before calling `sendToUser()`.
Fixed by adding the master-switch check immediately alongside vacation
mode, applying Phase 4's own stated principle consistently.

### 3. A factually incorrect security comment

`app/api/notifications/track/route.ts` claimed *"RLS on
notification_logs only has a SELECT policy... UPDATE/DELETE are not
permitted via RLS at all."* Reading the actual policy
(`notification_logs_update_own_read_state`, migration 038) shows this
was wrong — an UPDATE policy enforcing `auth.uid() = user_id` has
existed since Sprint 15. The route's actual behavior was never
incorrect (its explicit `.eq("user_id", ...)` scope is correct
defense-in-depth either way), but a comment asserting the wrong
security boundary risks a future engineer making a worse decision based
on it. Fixed — the comment now states the real boundary.

## Verified correct — checked directly, not assumed

- **Notification spoofing**: every sender including a person's display
  name sources it from the authenticated caller's own `profiles` row,
  never client-supplied text. Re-confirmed this final pass by grepping
  every `display_name`/`inviterDisplayName`/`senderDisplayName`
  parameter's origin across `lib/notifications.ts` and its callers —
  all trace back to `.eq("id", user.id)` reads.
- **Unauthorized delivery**: the RLS policy gating group-invite writes
  (`group_members_insert_invite_or_self_request`, migration 045) was
  read directly, not assumed from the API route's own comment — it
  genuinely requires the caller to be the group's owner or an admin
  before an invite-triggering row can be created.
- **Rate limiting**: present on every notification-triggering endpoint
  checked — `partner/nudge` (3/day), `partner/request`,
  `friends/request`, `groups/invite`, `shared-goals/invite`,
  `group-quests/check-completion` — all keyed by the authenticated
  `user.id`, never a client-suppliable value.
- **Replay attacks**: `/api/notifications/track` writes are idempotent
  (`.is(column, null)`) and ownership-scoped; replaying a captured
  request can at most re-mark a user's own already-sent notification, a
  no-op with no security or reward impact.
- **Sensitive information leakage / injection**: no
  `dangerouslySetInnerHTML` anywhere in the notification UI (all
  content renders as auto-escaped React text); the template engine's
  single-pass, non-recursive substitution can't be used for injection;
  the admin analytics route selects only aggregate columns, never
  `title`/`body`/`user_id`.
- **IDOR**: `archive`/`delete`/`mark-read` all scope by
  `.eq("user_id", user.id)`, each independently backed by the
  corresponding RLS policy.

## Accepted, documented tradeoff — not "fixed," because fixing it would undo intentional design

Several notification types (Phase 3's smart reminders, Phase 5's
digests) deliberately include real dollar amounts in push bodies — the
entire point of Phase 3's design philosophy ("You're only R120 away,"
not "Save today!"). This content can appear in an OS lock-screen preview
on a locked phone. This app has no control over that at the Web Push
API level — hiding notification content until unlock is a device/OS
setting, not something a push payload can request. Documented as a
known, deliberate tradeoff between the product's own stated goals and a
privacy consideration genuinely outside this codebase's technical
control.

## Recommended (not yet built)

- A rate limit on the notification-preferences `PATCH` endpoint —
  currently unlimited. Low priority (self-service settings change, no
  cross-user effect, not an abuse vector the way nudges/invites are),
  but cheap, consistent defense-in-depth alongside every other mutating
  endpoint in this system already having one.

## Future work (out of scope)

- OS/device-level notification-content privacy (the accepted tradeoff
  above) — genuinely outside this codebase's control.
- A full-application CSP audit — this sprint's scope was the
  notification system specifically.

## Known limitations

- The deep-link fix is defense-in-depth for a currently-unreachable
  path, not a fix for a demonstrated live exploit — stated plainly so
  it isn't mistaken for evidence of an actual breach.
- This audit did not attempt live penetration testing — no requests
  were sent against a running instance. Findings are based on careful
  code and RLS-policy reading, the only method available given this
  sandbox has no live Supabase or network infrastructure to test
  against (the same constraint every phase's audit has operated under
  all sprint).
