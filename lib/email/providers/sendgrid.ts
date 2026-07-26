/**
 * lib/email/providers/sendgrid.ts
 * Sprint 27, Phase 9.
 *
 * Real adapter, plain fetch. Request shape verified against SendGrid's
 * v3 Mail Send API reference: POST https://api.sendgrid.com/v3/mail/send,
 * Bearer auth, JSON body built from a `personalizations` array (each
 * personalization is effectively one recipient "envelope") plus a
 * top-level `from` and a `content` array of {type, value} objects — one
 * entry per body format (text/plain, text/html). A 202 response means
 * accepted, not delivered; SendGrid's Mail Send endpoint doesn't return
 * a message id in the response body (it's in the X-Message-Id response
 * header instead), which is why messageId below is read from headers.
 *
 * INACTIVE BY DEFAULT — see resend.ts's file header for the same note.
 */
import type { EmailProvider, EmailMessage, EmailSendResult } from "../types";

const SENDGRID_API_URL = "https://api.sendgrid.com/v3/mail/send";

export interface SendGridRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export function buildSendGridRequest(
  message: EmailMessage,
  config: { apiKey: string; fromAddress: string }
): SendGridRequest {
  const content = [{ type: "text/plain", value: message.text }];
  if (message.html) content.push({ type: "text/html", value: message.html });

  return {
    url: SENDGRID_API_URL,
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: message.to }] }],
      from: { email: config.fromAddress },
      subject: message.subject,
      content,
      ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
    }),
  };
}

export function createSendGridProvider(config: { apiKey: string; fromAddress: string }): EmailProvider {
  return {
    name: "sendgrid",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const req = buildSendGridRequest(message, config);
      try {
        const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return { sent: false, reason: `sendgrid_http_${res.status}:${body.slice(0, 200)}` };
        }
        return { sent: true, messageId: res.headers.get("x-message-id") ?? undefined };
      } catch (err) {
        return { sent: false, reason: `sendgrid_network_error:${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
