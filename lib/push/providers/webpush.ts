/**
 * lib/push/providers/webpush.ts
 * Sprint 27, Phase 10.
 *
 * UNLIKE Phase 9's email adapters (all inactive by default because
 * nothing was integrated before that phase), this adapter wraps
 * lib/webpush.ts — a real, already-working, currently-in-production
 * push implementation. This is the ACTIVE DEFAULT provider (see
 * ../index.ts's selector), not an inert option waiting to be
 * configured. `target` is the Web Push subscription endpoint URL;
 * `webPushKeys` (p256dh/auth) is required — this is the one provider
 * in this directory where PushRecipient's optional encryption-keys
 * field is actually mandatory, because Web Push is the one delivery
 * mechanism here that encrypts the payload client-side per RFC 8291.
 */
import { sendWebPushWithRetry } from "../../webpush";
import type { PushProvider, PushRecipient, PushMessage, PushSendResult } from "../types";

export const webPushProvider: PushProvider = {
  name: "webpush",
  async send(recipient: PushRecipient, message: PushMessage): Promise<PushSendResult> {
    if (!recipient.webPushKeys) {
      return { ok: false, error: "webpush recipient is missing webPushKeys (p256dh/auth)" };
    }
    return sendWebPushWithRetry(
      { endpoint: recipient.target, keys: recipient.webPushKeys },
      message
    );
  },
};
