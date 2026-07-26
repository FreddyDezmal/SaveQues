/**
 * lib/email/providers/postmark.ts
 * Sprint 27, Phase 9.
 *
 * Real adapter, plain fetch. Request shape verified against Postmark's
 * current API reference: POST https://api.postmarkapp.com/email, auth
 * via the X-Postmark-Server-Token header (not Bearer/Basic — Postmark's
 * own scheme), JSON body with PascalCase fields (From/To/Subject/
 * TextBody/HtmlBody/MessageStream). MessageStream: "outbound" is
 * required for transactional sends on a standard server setup.
 *
 * INACTIVE BY DEFAULT — see resend.ts's file header for the same note.
 */
import type { EmailProvider, EmailMessage, EmailSendResult } from "../types";

const POSTMARK_API_URL = "https://api.postmarkapp.com/email";

export interface PostmarkRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export function buildPostmarkRequest(
  message: EmailMessage,
  config: { serverToken: string; fromAddress: string }
): PostmarkRequest {
  return {
    url: POSTMARK_API_URL,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": config.serverToken,
    },
    body: JSON.stringify({
      From: config.fromAddress,
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      ...(message.html ? { HtmlBody: message.html } : {}),
      ...(message.replyTo ? { ReplyTo: message.replyTo } : {}),
      MessageStream: "outbound",
    }),
  };
}

export function createPostmarkProvider(config: { serverToken: string; fromAddress: string }): EmailProvider {
  return {
    name: "postmark",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const req = buildPostmarkRequest(message, config);
      try {
        const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
        const data = await res.json().catch(() => ({}));
        // Postmark returns 200 with an ErrorCode field even for some
        // rejected sends, not always a non-2xx status — check both.
        if (!res.ok || (typeof data?.ErrorCode === "number" && data.ErrorCode !== 0)) {
          return { sent: false, reason: `postmark_error_${data?.ErrorCode ?? res.status}:${String(data?.Message ?? "").slice(0, 200)}` };
        }
        return { sent: true, messageId: data?.MessageID };
      } catch (err) {
        return { sent: false, reason: `postmark_network_error:${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
