/**
 * lib/email/types.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27, Phase 9 — Email Provider Architecture.
 *
 * The whole point of this phase: one interface, several adapters behind
 * it, and business logic (lib/invites.ts today; anything else in the
 * future) depends only on this interface — never on a specific
 * provider's SDK or request shape. Swapping Resend for Postmark later
 * means writing/enabling one more file in lib/email/providers/ and
 * flipping an env var. Nothing that calls sendEmail() changes.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always required — every provider adapter sends at
   *  least this, so a message never depends on HTML rendering to be
   *  readable (accessibility/plain-client parity, same principle Phase
   *  12 will audit for push). */
  text: string;
  /** Optional HTML body. When omitted, adapters that require some HTML
   *  value (few do) fall back to an auto-escaped version of `text`. */
  html?: string;
  replyTo?: string;
}

export interface EmailSendResult {
  sent: boolean;
  /** Provider-assigned message id, when the provider returns one and
   *  the send succeeded. Useful for support/debugging correlation. */
  messageId?: string;
  /** Present when sent === false. "no_provider_configured" is the
   *  built-in NullEmailProvider's reason (see providers/null.ts); real
   *  adapters report their own provider-specific failure reasons. */
  reason?: string;
}

export interface EmailProvider {
  /** Short identifier for logging — "resend", "sendgrid", "null", etc. */
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
