/**
 * lib/invites.ts
 *
 * Sprint 22, Phase 10.
 *
 * Token generation (no new dependency — Node's built-in crypto covers
 * this) and the email-sending integration point.
 *
 * ── Email delivery ───────────────────────────────────────────────────
 * Sprint 27, Phase 9 built a real email provider abstraction
 * (lib/email/) — this function now routes through it instead of being
 * its own bespoke stub. Nothing observable changes today: no provider
 * is configured anywhere in this project, so sendEmail() still resolves
 * through the null provider and this still returns exactly
 * { sent: false, reason: "no_provider_configured" }. The difference is
 * what happens the moment someone DOES configure EMAIL_PROVIDER (see
 * lib/email/index.ts) — this function starts actually sending, with no
 * further changes needed here. The invite itself is fully functional
 * either way — /api/invitations/create always returns the shareable
 * link, which works completely without email (copy/paste, message it,
 * or render it as a QR code client-side).
 */

import { randomBytes } from "crypto";
import { sendEmail } from "./email";

/** URL-safe, 22 characters, ~131 bits of entropy — short enough to sit
 *  comfortably in a QR code, long enough that guessing a token isn't a
 *  realistic attack (same order of magnitude as a UUID). */
export function generateInviteToken(): string {
  return randomBytes(16).toString("base64url");
}

export function buildInviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/invite/${token}`;
}

export interface SendInviteEmailResult {
  sent: boolean;
  reason?: string;
}

export async function sendInviteEmail(params: {
  toEmail: string;
  inviterDisplayName: string;
  inviteUrl: string;
  groupName?: string | null;
}): Promise<SendInviteEmailResult> {
  const subject = params.groupName
    ? `${params.inviterDisplayName} invited you to join ${params.groupName} on SaveQuest`
    : `${params.inviterDisplayName} invited you to SaveQuest`;
  const text = params.groupName
    ? `${params.inviterDisplayName} invited you to join their group "${params.groupName}" on SaveQuest, a savings app that makes building better money habits feel like a game.\n\nJoin here: ${params.inviteUrl}`
    : `${params.inviterDisplayName} invited you to SaveQuest, a savings app that makes building better money habits feel like a game.\n\nJoin here: ${params.inviteUrl}`;

  const result = await sendEmail({ to: params.toEmail, subject, text });
  return { sent: result.sent, reason: result.reason };
}