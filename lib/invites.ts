/**
 * lib/invites.ts
 *
 * Sprint 22, Phase 10.
 *
 * Token generation (no new dependency — Node's built-in crypto covers
 * this) and the email-sending integration point.
 *
 * ── Email is a stub, on purpose ───────────────────────────────────────
 * See 053_invitations.sql's file header: this codebase has no email
 * provider configured anywhere (checked package.json and grepped lib/
 * and app/ — nothing). Picking one (Resend vs SendGrid vs Postmark, API
 * keys, templates) is a real infrastructure decision for whoever runs
 * this project, not something to bake in silently. sendInviteEmail()
 * below is the integration point: it validates input and returns a clear
 * { sent: false, reason: "no_provider_configured" } result rather than
 * throwing or pretending to succeed. The invite itself is fully
 * functional either way — /api/invitations/create always returns the
 * shareable link, which works completely without email (copy/paste,
 * message it, or render it as a QR code client-side).
 */

import { randomBytes } from "crypto";

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
  reason?: "no_provider_configured";
}

export async function sendInviteEmail(params: {
  toEmail: string;
  inviterDisplayName: string;
  inviteUrl: string;
  groupName?: string | null;
}): Promise<SendInviteEmailResult> {
  // Intentionally not implemented — see file header. Left as a named,
  // clearly-flagged stub rather than a silent no-op so it's obvious in a
  // code search (grep "no_provider_configured") exactly what's missing
  // and why, rather than a dead function nobody remembers exists.
  console.warn(
    `[invites] sendInviteEmail stub — no email provider configured. ` +
    `Would have sent to ${params.toEmail}: "${params.inviterDisplayName} invited you to SaveQuest" -> ${params.inviteUrl}`
  );
  return { sent: false, reason: "no_provider_configured" };
}