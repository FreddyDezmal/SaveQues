/**
 * lib/email/providers/mailgun.ts
 * Sprint 27, Phase 9.
 *
 * Real adapter, plain fetch. Request shape verified against Mailgun's
 * current API reference — the one adapter in this set that ISN'T JSON:
 * POST https://api.mailgun.net/v3/{domain}/messages, HTTP Basic auth
 * (username literally "api", password = the API key), body as
 * application/x-www-form-urlencoded (Mailgun's REST API predates
 * widespread JSON-body convention and never changed this). Domain is
 * part of the URL path, not the request body, so it's a required config
 * field here alongside the API key.
 *
 * INACTIVE BY DEFAULT — see resend.ts's file header for the same note.
 */
import type { EmailProvider, EmailMessage, EmailSendResult } from "../types";

export interface MailgunRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string; // application/x-www-form-urlencoded
}

export function buildMailgunRequest(
  message: EmailMessage,
  config: { apiKey: string; domain: string; fromAddress: string }
): MailgunRequest {
  const params = new URLSearchParams({
    from: config.fromAddress,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
  if (message.html) params.set("html", message.html);
  if (message.replyTo) params.set("h:Reply-To", message.replyTo);

  return {
    url: `https://api.mailgun.net/v3/${config.domain}/messages`,
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  };
}

export function createMailgunProvider(config: { apiKey: string; domain: string; fromAddress: string }): EmailProvider {
  return {
    name: "mailgun",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const req = buildMailgunRequest(message, config);
      try {
        const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { sent: false, reason: `mailgun_http_${res.status}:${String(data?.message ?? "").slice(0, 200)}` };
        }
        return { sent: true, messageId: data?.id };
      } catch (err) {
        return { sent: false, reason: `mailgun_network_error:${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
