/**
 * lib/webpush.ts
 * Lightweight Web Push sender using VAPID signing + RFC 8291 encryption.
 * Uses `as ArrayBuffer` casts throughout to satisfy strict TS lib typings
 * that return ArrayBufferLike instead of ArrayBuffer from crypto.subtle.
 */

import type { PushPayload, WebPushSubscription } from "./types.notifications";

// ── Helpers ──────────────────────────────────────────────────────────────────

function toB64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Buffer.from(bytes).toString("base64url");
}

function fromB64Url(b64url: string): ArrayBuffer {
  const pad    = "=".repeat((4 - (b64url.length % 4)) % 4);
  const base64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw    = atob(base64);
  const bytes  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

async function getVapidKeys() {
  const publicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
  const privateKey = process.env.VAPID_PRIVATE_KEY!;
  const subject    = process.env.VAPID_SUBJECT ?? "mailto:admin@savequest.app";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys not configured.");
  }
  return { publicKey, privateKey, subject };
}

// ── VAPID JWT ─────────────────────────────────────────────────────────────────

async function buildVapidJwt(audience: string, privateKeyB64: string, subject: string): Promise<string> {
  const enc     = new TextEncoder();
  const header  = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject };

  const h64      = toB64Url(enc.encode(JSON.stringify(header)));
  const p64      = toB64Url(enc.encode(JSON.stringify(payload)));
  const sigInput = `${h64}.${p64}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    fromB64Url(privateKeyB64),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const sigBuf = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    enc.encode(sigInput)
  ) as ArrayBuffer;

  return `${sigInput}.${toB64Url(sigBuf)}`;
}

// ── RFC 8291 Encryption ───────────────────────────────────────────────────────

async function encryptPayload(
  payloadStr: string,
  p256dh: string,
  auth: string
): Promise<{ body: ArrayBuffer; salt: string; serverPublicKey: string }> {
  const enc     = new TextEncoder();
  const content = enc.encode(payloadStr);

  const receiverPub = await crypto.subtle.importKey(
    "raw",
    fromB64Url(p256dh),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );

  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const sharedSecretBuf = await crypto.subtle.deriveBits(
    { name: "ECDH", public: receiverPub },
    serverKeyPair.privateKey,
    256
  ) as ArrayBuffer;

  const serverPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeyPair.publicKey) as ArrayBuffer
  );

  const authSecretBuf = fromB64Url(auth);
  const saltBytes     = crypto.getRandomValues(new Uint8Array(16));
  const saltBuf       = saltBytes.buffer as ArrayBuffer;

  const authInfo = enc.encode("Content-Encoding: auth\0");

  const ikm = await crypto.subtle.importKey("raw", sharedSecretBuf, "HKDF", false, ["deriveBits"]);

  const prkBuf = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: authSecretBuf, info: authInfo.buffer as ArrayBuffer },
    ikm,
    256
  ) as ArrayBuffer;

  const prkKey = await crypto.subtle.importKey("raw", prkBuf, "HKDF", false, ["deriveBits"]);

  const receiverPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", receiverPub) as ArrayBuffer
  );

  function lengthPrefix(buf: Uint8Array): Uint8Array {
    const out = new Uint8Array(2 + buf.length);
    new DataView(out.buffer).setUint16(0, buf.length, false);
    out.set(buf, 2);
    return out;
  }

  function concat(...arrays: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const buf   = new ArrayBuffer(total);
    const out   = new Uint8Array(buf);
    let   pos   = 0;
    for (let i = 0; i < arrays.length; i++) { out.set(arrays[i], pos); pos += arrays[i].length; }
    return out as Uint8Array<ArrayBuffer>;
  }

  const p256Label = enc.encode("P-256");
  const zeroBytes = new Uint8Array([0]);
  const context   = concat(p256Label, zeroBytes, lengthPrefix(receiverPubRaw), lengthPrefix(serverPubRaw));

  const cekInfo   = concat(enc.encode("Content-Encoding: aesgcm\0"), context);
  const nonceInfo = concat(enc.encode("Content-Encoding: nonce\0"),  context);

  const cekBuf = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: prkBuf, info: cekInfo.buffer as ArrayBuffer },
    prkKey,
    128
  ) as ArrayBuffer;

  const nonceBuf = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: prkBuf, info: nonceInfo.buffer as ArrayBuffer },
    prkKey,
    96
  ) as ArrayBuffer;

  const padded = new Uint8Array(2 + content.length);
  padded.set(content, 2);

  const cek = await crypto.subtle.importKey("raw", cekBuf, "AES-GCM", false, ["encrypt"]);

  const encryptedBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonceBuf },
    cek,
    padded
  ) as ArrayBuffer;

  return {
    body:            encryptedBuf,
    salt:            toB64Url(saltBuf),
    serverPublicKey: toB64Url(serverPubRaw),
  };
}

// ── Public send function ──────────────────────────────────────────────────────

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
  gone?: boolean;
}

export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: PushPayload
): Promise<SendResult> {
  try {
    const { publicKey, privateKey, subject } = await getVapidKeys();
    const url      = new URL(subscription.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const jwt      = await buildVapidJwt(audience, privateKey, subject);

    const { body, salt, serverPublicKey } = await encryptPayload(
      JSON.stringify(payload),
      subscription.keys.p256dh,
      subscription.keys.auth
    );

    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "Content-Type":     "application/octet-stream",
        "Content-Encoding": "aesgcm",
        "Encryption":       `salt=${salt}`,
        "Crypto-Key":       `dh=${serverPublicKey};p256ecdsa=${publicKey}`,
        "Authorization":    `vapid t=${jwt},k=${publicKey}`,
        "TTL":              "86400",
      },
      body,
    });

    if (res.status === 410 || res.status === 404) return { ok: false, status: res.status, gone: true };
    return { ok: res.ok, status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const pub  = await crypto.subtle.exportKey("raw",   keyPair.publicKey)  as ArrayBuffer;
  const priv = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey) as ArrayBuffer;
  return { publicKey: toB64Url(pub), privateKey: toB64Url(priv) };
}
