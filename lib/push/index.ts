/**
 * lib/push/index.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27, Phase 10 — Push Provider Architecture.
 *
 * The one function business logic should call: sendPush(recipient,
 * message). This mirrors lib/email/index.ts's Phase 9 shape closely
 * ("Same philosophy," per the sprint brief), with ONE deliberate
 * difference worth calling out rather than glossing over:
 *
 * Email's selector defaults to a NULL provider, because nothing was
 * integrated before Phase 9 — the honest default was "send nothing."
 * Push already has a real, working, currently-in-production provider
 * (lib/webpush.ts's standards-based Web Push implementation). Defaulting
 * THIS selector to null would be a regression, not a safe default — it
 * would silently stop delivering the push notifications this app
 * already sends today. So selectPushProvider() below defaults to (and
 * falls back to, on any misconfiguration) the existing webpush provider,
 * not a no-op — "no vendor lock-in" means it's easy to swap away FROM
 * web push, not that web push stops working the moment this file exists.
 *
 * Selection is env-var driven:
 *   PUSH_PROVIDER              - "webpush" (default) | "firebase" | "onesignal" | "expo" | "apns"
 *   FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT_EMAIL, FIREBASE_PRIVATE_KEY
 *   ONESIGNAL_API_KEY, ONESIGNAL_APP_ID
 *   EXPO_ACCESS_TOKEN           - optional; Expo works without one
 *   APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY, APNS_TOPIC, APNS_PRODUCTION
 *
 * None of these (besides the existing VAPID_* vars webpush.ts already
 * used) are set anywhere in this project — confirmed the same way
 * Phase 9 confirmed it for email. PUSH_PROVIDER unset → webpush, same
 * as today, unconditionally.
 */
import type { PushProvider, PushRecipient, PushMessage, PushSendResult } from "./types";
import { webPushProvider } from "./providers/webpush";
import { createFirebaseProvider } from "./providers/firebase";
import { createOneSignalProvider } from "./providers/onesignal";
import { createExpoProvider } from "./providers/expo";
import { createApnsProvider } from "./providers/apns";

export type { PushMessage, PushRecipient, PushSendResult, PushProvider } from "./types";

export function selectPushProvider(env: Record<string, string | undefined>): PushProvider {
  const providerName = env.PUSH_PROVIDER;

  if (!providerName || providerName === "webpush") return webPushProvider;

  switch (providerName) {
    case "firebase": {
      const { FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT_EMAIL, FIREBASE_PRIVATE_KEY } = env;
      if (!FIREBASE_PROJECT_ID || !FIREBASE_SERVICE_ACCOUNT_EMAIL || !FIREBASE_PRIVATE_KEY) {
        return fallback("firebase", "FIREBASE_PROJECT_ID / FIREBASE_SERVICE_ACCOUNT_EMAIL / FIREBASE_PRIVATE_KEY");
      }
      return createFirebaseProvider({
        projectId: FIREBASE_PROJECT_ID,
        serviceAccountEmail: FIREBASE_SERVICE_ACCOUNT_EMAIL,
        privateKeyPem: FIREBASE_PRIVATE_KEY,
      });
    }
    case "onesignal": {
      if (!env.ONESIGNAL_API_KEY || !env.ONESIGNAL_APP_ID) {
        return fallback("onesignal", "ONESIGNAL_API_KEY / ONESIGNAL_APP_ID");
      }
      return createOneSignalProvider({ apiKey: env.ONESIGNAL_API_KEY, appId: env.ONESIGNAL_APP_ID });
    }
    case "expo":
      return createExpoProvider({ accessToken: env.EXPO_ACCESS_TOKEN });
    case "apns": {
      const { APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY, APNS_TOPIC } = env;
      if (!APNS_TEAM_ID || !APNS_KEY_ID || !APNS_PRIVATE_KEY || !APNS_TOPIC) {
        return fallback("apns", "APNS_TEAM_ID / APNS_KEY_ID / APNS_PRIVATE_KEY / APNS_TOPIC");
      }
      // Selecting this returns a provider whose send() always throws —
      // see providers/apns.ts's file header. Configuring credentials
      // doesn't change that; APNs needs an HTTP/2 transport first.
      return createApnsProvider({
        teamId: APNS_TEAM_ID,
        keyId: APNS_KEY_ID,
        privateKeyPem: APNS_PRIVATE_KEY,
        topic: APNS_TOPIC,
        production: env.APNS_PRODUCTION === "true",
      });
    }
    default:
      console.warn(`[push] Unknown PUSH_PROVIDER="${providerName}" — falling back to webpush.`);
      return webPushProvider;
  }
}

function fallback(provider: string, missingVars: string): PushProvider {
  console.warn(`[push] PUSH_PROVIDER=${provider} set but ${missingVars} is missing — falling back to webpush.`);
  return webPushProvider;
}

export function getPushProvider(): PushProvider {
  return selectPushProvider(process.env as Record<string, string | undefined>);
}

/** The one function business logic should call. */
export async function sendPush(recipient: PushRecipient, message: PushMessage): Promise<PushSendResult> {
  return getPushProvider().send(recipient, message);
}
