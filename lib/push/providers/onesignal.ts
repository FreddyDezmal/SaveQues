/**
 * lib/push/providers/onesignal.ts
 * Sprint 27, Phase 10.
 *
 * Real adapter, plain fetch. Request shape verified against OneSignal's
 * current API reference: POST https://onesignal.com/api/v1/notifications,
 * JSON body. `target` here is a OneSignal player/subscription id, sent
 * via `include_player_ids` to address exactly one recipient (as opposed
 * to `included_segments`, which targets a broad audience — not what a
 * single-recipient notification send needs).
 *
 * AUTH HEADER NOTE: OneSignal's auth scheme changed between API key
 * generations. Older (pre-2024) REST API keys use `Authorization: Basic
 * <key>`; current app-scoped keys (the "os_v2_app_..." format shown in
 * OneSignal's own current quick-start docs) use `Authorization: Key
 * <key>`. This adapter uses `Key`, matching OneSignal's own current
 * documentation — if a project is still on a legacy key, that's a
 * one-line change, not a design change.
 *
 * INACTIVE BY DEFAULT — see expo.ts's file header for the same note.
 */
import type { PushProvider, PushRecipient, PushMessage, PushSendResult } from "../types";

const ONESIGNAL_API_URL = "https://onesignal.com/api/v1/notifications";

export interface OneSignalRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export function buildOneSignalRequest(
  recipient: PushRecipient,
  message: PushMessage,
  config: { apiKey: string; appId: string }
): OneSignalRequest {
  return {
    url: ONESIGNAL_API_URL,
    method: "POST",
    headers: {
      Authorization: `Key ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_id: config.appId,
      include_player_ids: [recipient.target],
      headings: { en: message.title },
      contents: { en: message.body },
      data: { url: message.url, notificationId: message.notificationId, type: message.type },
    }),
  };
}

export function createOneSignalProvider(config: { apiKey: string; appId: string }): PushProvider {
  return {
    name: "onesignal",
    async send(recipient: PushRecipient, message: PushMessage): Promise<PushSendResult> {
      const req = buildOneSignalRequest(recipient, message, config);
      try {
        const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
        const data = await res.json().catch(() => ({}));
        // OneSignal returns 200 even for some rejected sends, with an
        // `errors` field describing why (e.g. an invalid/unsubscribed
        // player id) rather than always a non-2xx status.
        if (!res.ok || data?.errors) {
          const errorText = Array.isArray(data?.errors) ? data.errors.join("; ") : JSON.stringify(data?.errors ?? "");
          const gone = /not subscribed|invalid_player_ids/i.test(errorText);
          return { ok: false, status: res.status, gone, error: errorText || `onesignal_http_${res.status}` };
        }
        return { ok: true, messageId: data?.id };
      } catch (err) {
        return { ok: false, error: `onesignal_network_error:${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
