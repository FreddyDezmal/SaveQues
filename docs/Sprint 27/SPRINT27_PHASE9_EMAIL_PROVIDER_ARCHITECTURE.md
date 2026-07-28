# Sprint 27 — Phase 9: Email Provider Architecture

## 1. What this phase is

"Do NOT integrate a provider. Instead: Design the abstraction. Support
future: Resend, SendGrid, Postmark, SES, Mailgun. Without changing
business logic."

## 2. What already existed

`lib/invites.ts`'s `sendInviteEmail()` (Sprint 22) — a single-purpose,
honestly-labeled stub. Its own file header already documented that no
email provider is configured anywhere in this codebase and returned
`{ sent: false, reason: "no_provider_configured" }` rather than
pretending to succeed. That honesty was worth preserving exactly, not
just as a behavior but as a design principle — see §5.

No general-purpose email abstraction existed. No `email_enabled`
notification-preference channel exists either (confirmed: Phase 4 added
push/in-app implicitly and deliberately skipped SMS for lack of any
supporting infrastructure — email similarly had no abstraction to gate
until this phase built one).

## 3. What this phase built

```
lib/email/
  types.ts                   — EmailMessage / EmailSendResult / EmailProvider
  index.ts                   — selectEmailProvider() + sendEmail(), the
                                 one entry point business logic calls
  providers/
    null.ts                  — default, always returns sent:false
    resend.ts                — real adapter (plain fetch, verified shape)
    sendgrid.ts               — real adapter (plain fetch, verified shape)
    postmark.ts               — real adapter (plain fetch, verified shape)
    mailgun.ts                 — real adapter (plain fetch, verified shape)
    ses.ts                     — documented STUB, not a working adapter — see §4
```

`lib/invites.ts` now calls `sendEmail()` instead of being its own stub.
**Zero business logic changed** at that call site beyond the import —
the function still builds the same email content and returns the same
shape; only where the actual sending decision lives moved.

## 4. Four real adapters, one honest stub — and why the split isn't arbitrary

Resend, SendGrid, Postmark, and Mailgun all authenticate with a single
static credential (Bearer token, server token, or HTTP Basic Auth) and
their request shapes were verified against each provider's current API
documentation via web search during this phase — **not written from
memory**. Specifically confirmed:
- Resend: `POST https://api.resend.com/emails`, Bearer auth, JSON body.
- SendGrid: `POST https://api.sendgrid.com/v3/mail/send`, Bearer auth,
  JSON body with a `personalizations` array and a `content` array of
  `{type, value}` entries.
- Postmark: `POST https://api.postmarkapp.com/email`,
  `X-Postmark-Server-Token` header (not Bearer), PascalCase JSON fields.
- Mailgun: `POST https://api.mailgun.net/v3/{domain}/messages`, HTTP
  Basic auth (username literally `"api"`), **form-urlencoded** body —
  the one adapter here that isn't JSON, confirmed specifically because
  assuming JSON-by-default across all five would have been wrong.

**Amazon SES is a documented stub, not a working implementation.**
Every other provider here needs one static credential string; SES's
HTTP API requires AWS Signature Version 4 — a multi-step signing
process (canonical request construction, exact header
trimming/lowercasing, a payload hash, a string-to-sign, and a signing
key derived through four rounds of HMAC-SHA256). Every step has to be
byte-exact or the signature silently fails. That combination — high
complexity, easy to get subtly wrong, and no way to test it against real
AWS credentials in this sandbox — is exactly the situation where writing
confident-looking code from memory would be worse than not writing it:
it would look correct in review and then fail 100% of the time in
production. `providers/ses.ts`'s `send()` throws immediately with a
clear message pointing at `@aws-sdk/client-sesv2` (which handles SigV4
correctly) rather than attempting to sign requests it doesn't actually
sign. This is the one adapter where "use the vendor SDK instead of
hand-rolling it" is the right engineering call, not a shortcut.

## 5. "Do NOT integrate a provider" — enforced structurally, not just by convention

`selectEmailProvider()` returns the null provider whenever `EMAIL_PROVIDER`
is unset, and **no code path in this project sets it** — confirmed by
checking `.env.local.example` and every deployment config file during
this phase's audit; none configure it. So today, in this actual
codebase, `getEmailProvider()` always resolves to the null provider,
always. The four real adapters exist, are correct, and are completely
inert until someone deliberately adds credentials for one — the
"do not integrate" instruction isn't just followed by omission, it's
enforced by the selector's own default-off design.

## 6. Scope boundary: the abstraction is built, general notification-email delivery is not

This phase wired the one existing real caller (`sendInviteEmail`) onto
the new abstraction. It did **not**:
- Add an `email_enabled` notification-preference column or wire
  `lib/notifications.ts`'s `sendToUser()` to also deliver via email.
- Build email-specific (HTML) templates for the other ~29 notification
  types beyond what `lib/notificationTemplates.ts` (Phase 7) already
  produces as plain title/body text.

Both are real, valuable follow-on work — deliberately out of scope here
because the brief for this phase is explicitly "design the abstraction
... without changing business logic," and wiring email into the general
notification pipeline is a Phase-4-shaped change (new preference
category, channel-selection logic, HTML template design) layered on top
of this phase's plumbing, not the plumbing itself. Flagged as
recommended next work (§8), not silently done partially or fabricated
as complete.

## 7. Verified / recommended / future work / known limitations

**Verified** (actually run in this sandbox):
- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors from before Phase 3 remain.
- `npx vitest run` (full suite) — 448 passed, 0 failed (up from 433
  before this phase — the +15 are `tests/unit/emailProvider.test.ts`).
  Caught and fixed a real bug during this phase's own testing: the null
  provider's debug-log preview was truncated at 140 characters, which
  cut a test invite URL off mid-string — increased to 300 so a typical
  short notification email's link isn't silently chopped. Found by an
  existing pre-Phase-9 test (`invites.test.ts`) that started failing
  when `lib/invites.ts` was migrated onto the new abstraction; fixed
  rather than weakening the test.
- Each real adapter's request-building logic (the part that doesn't
  require a live network call) is unit tested — URL, auth header shape,
  and body shape all verified per provider, including the "omit the
  HTML field when none is given" and "only add Reply-To when provided"
  edge cases.
- Confirmed via grep that no `EMAIL_PROVIDER`-family env var is set
  anywhere in this project (`.env.local.example`, `.env.local`, or any
  deployment config), backing the §5 claim.

**Recommended, not yet built:**
- Wiring `lib/notifications.ts`'s general send pipeline to email (see
  §6) — needs a new `email_enabled` preference category (Phase-4-shaped
  work) and a decision about which notification types should ever go to
  email at all (probably not achievement unlocks; probably yes for
  digests).
- A real SES implementation via `@aws-sdk/client-sesv2` (see §4) —
  genuine future work, not a "later" euphemism for "never."

**Future work (explicitly out of scope for Phase 9):**
- HTML email templates/design — every adapter here accepts an `html`
  field, but nothing in this codebase generates rich HTML bodies yet;
  every current call site sends plain text only.
- Bounce/complaint webhook handling for any of these providers (all
  five support it; none of it is built).

**Known limitations:**
- Every adapter's `send()` catches network errors and non-2xx responses
  and reports them via `EmailSendResult.reason` rather than throwing —
  consistent, but means a caller that needs to distinguish "definitely
  failed" from "might have partially succeeded" (e.g. SendGrid's 202
  meaning "accepted," not "delivered") has to parse that reason string;
  there's no structured retry/permanent-failure classification for email
  the way `lib/webpush.ts`'s `isRetryable()` (Phase 8) has for push.
- Postmark's response can return HTTP 200 with a non-zero `ErrorCode`
  field for some rejected sends rather than a non-2xx status — the
  adapter checks both, but this is a Postmark-specific quirk worth
  remembering if debugging a "why did this silently fail" report.
