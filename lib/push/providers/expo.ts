/**
 * lib/push/providers/expo.ts
 * Sprint 27, Phase 10.
 *
 * Real adapter, plain fetch. Request shape verified against Expo's
 * current Push API docs: POST https://exp.host/--/api/v2/push/send,
 * JSON body {to, title, body, data?}, where `to` is an
 * "ExponentPushToken[...]" string. No auth header is strictly required
 * for basic sends; an optional Bearer accessToken (Expo's "enhanced
 * security" push tokens) is supported here when configured. Response is
 * a "push ticket," not a delivery confirmation — Expo relays to FCM/APNs
 * behind the scenes and a separate receipt-polling step (not built here)
 * is how you'd later confirm actual delivery.
 *
 * INACTIVE BY DEFAULT — selected only when PUSH_PROVIDER=expo AND every
 * currently-subscribed recipient has an Expo push token rather than a
 * Web Push endpoint (see ../index.ts's selector for the full reasoning
 * on why this can't simply replace webpush as the default).
 */
import type { PushProvider, PushRecipient, PushMessage, PushSendResult } from "../types";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface ExpoRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export function buildExpoRequest(
  recipient: PushRecipient,
  message: PushMessage,
  config?: { accessToken?: string }
): ExpoRequest {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (config?.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;

  return {
    url: EXPO_PUSH_URL,
    method: "POST",
    headers,
    body: JSON.stringify({
      to: recipient.target,
      title: message.title,
      body: message.body,
      data: { url: message.url, notificationId: message.notificationId, type: message.type },
    }),
  };
}

export function createExpoProvider(config?: { accessToken?: string }): PushProvider {
  return {
    name: "expo",
    async send(recipient: PushRecipient, message: PushMessage): Promise<PushSendResult> {
      const req = buildExpoRequest(recipient, message, config);
      try {
        const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
        const data = await res.json().catch(() => ({}));
        const ticket = Array.isArray(data?.data) ? data.data[0] : data?.data;
        if (!res.ok || ticket?.status === "error") {
          // DeviceNotRegistered is Expo's permanent-failure signal — same
          // meaning as Web Push's 410/404 "gone."
          const gone = ticket?.details?.error === "DeviceNotRegistered";
          return { ok: false, status: res.status, gone, error: ticket?.message ?? `expo_http_${res.status}` };
        }
        return { ok: true, messageId: ticket?.id };
      } catch (err) {
        return { ok: false, error: `expo_network_error:${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
