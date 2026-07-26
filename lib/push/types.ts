/**
 * lib/push/types.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27, Phase 10 — Push Provider Architecture. "Same philosophy"
 * as Phase 9's email abstraction: one interface, several adapters
 * behind it, business logic depends only on this interface.
 *
 * PushMessage is a type alias for the existing PushPayload
 * (lib/types.notifications.ts), not a stripped-down generic shape —
 * this abstraction exists to make SWAPPING WHICH SERVICE delivers this
 * app's notifications painless (the brief's own "no vendor lock-in"),
 * not to pretend to be a generic multi-tenant push SDK serving apps
 * this codebase doesn't have. Reusing the existing type is the honest
 * choice here, not a shortcut — see lib/reminderEngine.ts and
 * lib/digest.ts for the same "reuse an existing type across a module
 * boundary rather than inventing a parallel one" pattern elsewhere in
 * this sprint.
 */
import type { PushPayload } from "../types.notifications";

export type PushMessage = PushPayload;

export interface PushRecipient {
  /** Provider-agnostic delivery target. Shape varies by provider — see
   *  each adapter's own file header for exactly what it expects here:
   *  a Web Push endpoint URL, an FCM/APNs device token, a OneSignal
   *  player/subscription id, or an Expo push token. */
  target: string;
  /** Web Push specifically needs per-subscription encryption keys;
   *  no other provider in this directory does. Optional so
   *  PushRecipient stays one shared type instead of a discriminated
   *  union multiplying every call site. */
  webPushKeys?: { p256dh: string; auth: string };
}

export interface PushSendResult {
  ok: boolean;
  status?: number;
  error?: string;
  /** Recipient's token/subscription is permanently invalid — caller
   *  should deactivate it (same meaning as lib/webpush.ts's existing
   *  `gone` field, which this mirrors exactly for drop-in compatibility). */
  gone?: boolean;
  messageId?: string;
}

export interface PushProvider {
  /** Short identifier for logging — "webpush", "firebase", etc. */
  readonly name: string;
  send(recipient: PushRecipient, message: PushMessage): Promise<PushSendResult>;
}
