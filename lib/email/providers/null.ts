/**
 * lib/email/providers/null.ts
 * Sprint 27, Phase 9.
 *
 * The default provider when nothing is configured — same honest shape
 * lib/invites.ts's sendInviteEmail() stub already used before this
 * phase (see that file's own header, Sprint 22): log what would have
 * been sent, return { sent: false, reason: "no_provider_configured" }
 * rather than throwing or silently pretending to succeed.
 */
import type { EmailProvider, EmailMessage, EmailSendResult } from "../types";

export const nullEmailProvider: EmailProvider = {
  name: "null",
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const preview = message.text.length > 300 ? `${message.text.slice(0, 300)}…` : message.text;
    console.warn(
      `[email:null] No email provider configured. Would have sent to ${message.to}: "${message.subject}" — ${preview}`
    );
    return { sent: false, reason: "no_provider_configured" };
  },
};
