/**
 * lib/email/providers/resend.ts
 * Sprint 27, Phase 9.
 *
 * Real, working adapter — not a stub — using plain fetch (no SDK
 * dependency added, same "no new npm package for one HTTP call" choice
 * lib/webpush.ts already made for push). Request shape verified against
 * Resend's current API reference (POST https://api.resend.com/emails,
 * Bearer auth, JSON body) rather than written from memory.
 *
 * INACTIVE BY DEFAULT. This file being correct does not mean Resend is
 * "integrated" in the sense of being wired up and sending real email —
 * lib/email/index.ts only constructs this provider when RESEND_API_KEY
 * is actually set, and falls back to the null provider otherwise. See
 * that file and docs/SPRINT27_PHASE9_EMAIL_PROVIDER_ARCHITECTURE.md for
 * the full "designed, not integrated" reasoning.
 */
import type { EmailProvider, EmailMessage, EmailSendResult } from "../types";

const RESEND_API_URL = "https://api.resend.com/emails";

export interface ResendRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/**
 * Pure request-builder, separated from the actual fetch() call so it's
 * unit-testable without a network mock — same pattern
 * lib/webpush.ts uses for isRetryable().
 */
export function buildResendRequest(
  message: EmailMessage,
  config: { apiKey: string; fromAddress: string }
): ResendRequest {
  return {
    url: RESEND_API_URL,
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    }),
  };
}

export function createResendProvider(config: { apiKey: string; fromAddress: string }): EmailProvider {
  return {
    name: "resend",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const req = buildResendRequest(message, config);
      try {
        const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return { sent: false, reason: `resend_http_${res.status}:${body.slice(0, 200)}` };
        }
        const data = await res.json().catch(() => ({}));
        return { sent: true, messageId: data?.id };
      } catch (err) {
        return { sent: false, reason: `resend_network_error:${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
