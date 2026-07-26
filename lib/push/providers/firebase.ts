/**
 * lib/push/providers/firebase.ts
 * Sprint 27, Phase 10.
 *
 * Real adapter — the most involved of the four active ones in this
 * directory, because FCM's HTTP v1 API doesn't take a static API key.
 * It requires a full OAuth 2.0 service-account flow, verified against
 * Firebase's current documentation:
 *   1. Build a JWT (header {alg:"RS256"}, claims {iss, sub, aud:
 *      "https://oauth2.googleapis.com/token", iat, exp, scope:
 *      "https://www.googleapis.com/auth/firebase.messaging"}), signed
 *      with the service account's RSA private key.
 *   2. POST that JWT (as the `assertion` parameter, grant_type
 *      "urn:ietf:params:oauth:grant-type:jwt-bearer") to Google's token
 *      endpoint to exchange it for a short-lived OAuth access token.
 *   3. POST to https://fcm.googleapis.com/v1/projects/{project_id}/
 *      messages:send with `Authorization: Bearer <access_token>`.
 *
 * Why this was implemented for real, unlike SES (Phase 9) and APNs
 * (this file's sibling): the JWT step is mechanically identical to what
 * lib/webpush.ts's buildVapidJwt() already does correctly in production
 * for VAPID — same header/payload/sign/base64url-encode shape, just
 * RS256 (RSASSA-PKCS1-v1_5) instead of ES256 (ECDSA), and Web Crypto
 * supports both natively. The token-exchange step is a single,
 * well-documented, standard OAuth2 form-POST with no per-request
 * signing math to get subtly wrong — unlike AWS SigV4's many
 * exact-match canonicalization rules (see providers-not-in-this-set:
 * lib/email/providers/ses.ts's file header for that comparison in
 * detail) or APNs' hard HTTP/2 transport requirement (see apns.ts in
 * this directory). Two composed simple operations, not one fragile
 * complex one.
 *
 * INACTIVE BY DEFAULT — see expo.ts's file header for the same note.
 */
import type { PushProvider, PushRecipient, PushMessage, PushSendResult } from "../types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function toB64Url(buf: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buf)).toString("base64url");
}

/** Service accounts export the private key as PEM ("-----BEGIN PRIVATE
 *  KEY-----...-----END PRIVATE KEY-----"), but Web Crypto's `importKey`
 *  wants the raw PKCS8 DER bytes underneath — strip the markers/
 *  whitespace and base64-decode. */
function pemToPkcs8(pem: string): ArrayBuffer {
  const stripped = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = Buffer.from(stripped, "base64");
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
}

async function buildServiceAccountJwt(serviceAccountEmail: string, privateKeyPem: string): Promise<string> {
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccountEmail,
    sub: serviceAccountEmail,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600, // Google rejects tokens requesting longer than 1 hour
    scope: FCM_SCOPE,
  };

  const h64 = toB64Url(enc.encode(JSON.stringify(header)).buffer as ArrayBuffer);
  const c64 = toB64Url(enc.encode(JSON.stringify(claims)).buffer as ArrayBuffer);
  const signInput = `${h64}.${c64}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(signInput));
  return `${signInput}.${toB64Url(sigBuf)}`;
}

async function getAccessToken(serviceAccountEmail: string, privateKeyPem: string): Promise<string> {
  const jwt = await buildServiceAccountJwt(serviceAccountEmail, privateKeyPem);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`FCM OAuth token exchange failed: HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  return data.access_token;
}

export function createFirebaseProvider(config: {
  projectId: string;
  serviceAccountEmail: string;
  privateKeyPem: string;
}): PushProvider {
  return {
    name: "firebase",
    async send(recipient: PushRecipient, message: PushMessage): Promise<PushSendResult> {
      try {
        const accessToken = await getAccessToken(config.serviceAccountEmail, config.privateKeyPem);
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: recipient.target,
              notification: { title: message.title, body: message.body },
              data: {
                url: message.url ?? "",
                notificationId: message.notificationId ?? "",
                type: message.type,
              },
            },
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          // FCM reports an unregistered/invalid token as a 404 with
          // error.status === "UNREGISTERED" — the permanent-failure
          // signal equivalent to Web Push's 410/404.
          const gone = res.status === 404 || body?.error?.status === "UNREGISTERED";
          return { ok: false, status: res.status, gone, error: body?.error?.message ?? `fcm_http_${res.status}` };
        }
        const data = await res.json().catch(() => ({}));
        return { ok: true, messageId: data?.name };
      } catch (err) {
        return { ok: false, error: `fcm_error:${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
