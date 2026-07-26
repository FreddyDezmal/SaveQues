/**
 * lib/push/providers/apns.ts
 * Sprint 27, Phase 10.
 *
 * PARTIALLY real, deliberately — worth explaining exactly which part
 * and why, the same honesty standard lib/email/providers/ses.ts (Phase
 * 9) set for "when NOT to hand-roll something."
 *
 * buildApnsProviderJwt() below IS a real, working implementation, not a
 * stub. APNs' token-based auth is a JWT with header {alg:"ES256",
 * kid: <10-char key id>} and claims {iss: <10-char team id>, iat}, signed
 * with an ECDSA P-256 private key — mechanically IDENTICAL to what
 * lib/webpush.ts's buildVapidJwt() already does correctly in production
 * for VAPID (same algorithm, same header/claims/sign/base64url shape,
 * just different claim names). Confidence here is high specifically
 * because this app already has proof this exact signing approach works.
 *
 * send() is a documented STUB, not implemented — because APNs' HTTP
 * API has a hard requirement plain fetch() cannot satisfy: it MUST be
 * sent over HTTP/2 (confirmed via search during this phase — "APNs
 * requires HTTP/2 for push requests. If your server uses HTTP/1.1 or
 * older protocols, the request will fail"). This isn't a complexity/
 * risk judgment call like SES's SigV4 — it's a hard transport-layer
 * blocker. Node's built-in `fetch` (undici) does not negotiate HTTP/2
 * for outgoing requests; Node's separate `http2` core module exists but
 * has a completely different, stream/callback-based API incompatible
 * with the fetch-based shape every other adapter in this project uses,
 * and reliably driving it correctly (session reuse, stream lifecycle,
 * frame-level headers like `apns-topic`/`apns-push-type`) is enough
 * additional surface area that getting it right blind, untested against
 * real Apple infrastructure, carries the same "looks correct, silently
 * never works" risk this sprint's engineering rules exist to avoid.
 *
 * TO IMPLEMENT FOR REAL: use Node's `http2` module directly (see
 * https://nodejs.org/api/http2.html#client-side-example) or a
 * battle-tested library built on it (e.g. `node-apn` / `@parse/node-apn`).
 * buildApnsProviderJwt() below can be reused as-is for the auth token
 * either way — that part of the work is already done.
 */
import type { PushProvider, PushRecipient, PushMessage, PushSendResult } from "../types";

function toB64Url(buf: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buf)).toString("base64url");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const stripped = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = Buffer.from(stripped, "base64");
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
}

/**
 * Real, working APNs provider-authentication JWT builder — see this
 * file's header for why this part (unlike send() below) is fully
 * implemented. `keyId` is the 10-character key identifier from the
 * .p8 file's name; `teamId` is the 10-character Apple Developer Team ID.
 */
export async function buildApnsProviderJwt(
  teamId: string,
  keyId: string,
  privateKeyPem: string
): Promise<string> {
  const enc = new TextEncoder();
  const header = { alg: "ES256", kid: keyId };
  const claims = { iss: teamId, iat: Math.floor(Date.now() / 1000) };

  const h64 = toB64Url(enc.encode(JSON.stringify(header)).buffer as ArrayBuffer);
  const c64 = toB64Url(enc.encode(JSON.stringify(claims)).buffer as ArrayBuffer);
  const signInput = `${h64}.${c64}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, enc.encode(signInput));
  return `${signInput}.${toB64Url(sigBuf)}`;
}

export function createApnsProvider(_config: {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  topic: string; // your app's bundle id
  production: boolean;
}): PushProvider {
  return {
    name: "apns",
    async send(_recipient: PushRecipient, _message: PushMessage): Promise<PushSendResult> {
      // Deliberately not implemented — see file header. Fails loudly
      // rather than attempting an HTTP/1.1 request APNs will simply
      // reject, or silently succeeding at nothing.
      throw new Error(
        "[push:apns] APNs adapter's send() is a documented stub — APNs requires HTTP/2, which plain fetch() cannot do. " +
        "See this file's header for what's needed (Node's http2 module or a library like node-apn). " +
        "buildApnsProviderJwt() is real and reusable once the HTTP/2 transport is added. " +
        "Do not select PUSH_PROVIDER=apns until this is implemented."
      );
    },
  };
}
