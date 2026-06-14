/**
 * lib/webpush.ts
 *
 * Lightweight Web Push sender using the Fetch API + VAPID signing.
 * We implement VAPID manually so we don't need the `web-push` npm package
 * (which isn't edge-safe). This file runs only in Node.js API routes.
 */

import type { PushPayload, WebPushSubscription } from "./types.notifications";

// ── VAPID helpers ────────────────────────────────────────────────────────────

function base64UrlToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const pad    = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw    = atob(base64);
  const bytes  = new Uint8Array(raw.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function getVapidKeys() {
  const publicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
  const privateKey = process.env.VAPID_PRIVATE_KEY!;
  const subject    = process.env.VAPID_SUBJECT ?? "mailto:admin@savequest.app";

  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.");
  }

  return { publicKey, privateKey, subject };
}

/**
 * Build a VAPID JWT for the given audience (push endpoint origin).
 */
async function buildVapidJwt(audience: string, privateKeyB64: string, subject: string): Promise<string> {
  const header  = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // 12 h
    sub: subject,
  };

  const enc    = new TextEncoder();
  const h64    = uint8ArrayToBase64Url(enc.encode(JSON.stringify(header)));
  const p64    = uint8ArrayToBase64Url(enc.encode(JSON.stringify(payload)));
  const sigInput = `${h64}.${p64}`;

  // Import private key (PKCS8 / base64url raw)
  let pkBytes: Uint8Array;
  try {
    pkBytes = base64UrlToUint8Array(privateKeyB64);
  } catch {
    throw new Error("VAPID_PRIVATE_KEY is not valid base64url");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pkBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const sigBuf  = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    enc.encode(sigInput)
  );

  const sig64 = uint8ArrayToBase64Url(new Uint8Array(sigBuf as ArrayBuffer));
  return `${sigInput}.${sig64}`;
}

// ── Encryption ───────────────────────────────────────────────────────────────

/**
 * Encrypt push message payload using Web Push message encryption (RFC 8291).
 * Returns the encrypted body buffer plus the Crypto-Key and Encryption headers.
 */
async function encryptPayload(
  payloadStr: string,
  p256dh: string,
  auth: string
): Promise<{ body: Uint8Array<ArrayBuffer>; salt: string; serverPublicKey: string }> {
  const enc     = new TextEncoder();
  const content = enc.encode(payloadStr);

  // Import receiver's public key
  const receiverPub = await crypto.subtle.importKey(
    "raw",
    base64UrlToUint8Array(p256dh),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );

  // Generate ephemeral key pair
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  // ECDH shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: receiverPub },
    serverKeyPair.privateKey,
    256
  );

  // Export server public key
  const serverPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeyPair.publicKey) as ArrayBuffer
  );

  // Auth secret
  const authSecret = base64UrlToUint8Array(auth);

  // Salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK (HKDF)
  const authInfo = enc.encode("Content-Encoding: auth\0");
  const ikm = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveBits"]);

  // HKDF-SHA256 for PRK
  const prk = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: authSecret, info: authInfo },
    ikm,
    256
  );

  const prkKey = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);

  // Context
  const receiverPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", receiverPub) as ArrayBuffer);
  function lengthPrefix(buf: Uint8Array) {
    const out = new Uint8Array(2 + buf.length);
    new DataView(out.buffer).setUint16(0, buf.length, false);
    out.set(buf, 2);
    return out;
  }
  const context = new Uint8Array([
    ...enc.encode("P-256"),
    0,
    ...lengthPrefix(receiverPubRaw),
    ...lengthPrefix(serverPubRaw),
  ]);

  // CEK + nonce
  const cekInfo   = new Uint8Array([...enc.encode("Content-Encoding: aesgcm\0"), ...context]);
  const nonceInfo = new Uint8Array([...enc.encode("Content-Encoding: nonce\0"),  ...context]);

  const saltKey = await crypto.subtle.importKey("raw", salt, "HKDF", false, ["deriveBits"]);

  const cekBits   = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: prk, info: cekInfo },   prkKey, 128);
  const nonceBits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: prk, info: nonceInfo }, prkKey, 96);

  // Pad + encrypt
  const padded = new Uint8Array(2 + content.length);
  padded.set(content, 2);

  const cek   = await crypto.subtle.importKey("raw", cekBits, "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonceBits },
    cek,
    padded
  );

  return {
    body: new Uint8Array(encrypted as ArrayBuffer),
    salt: uint8ArrayToBase64Url(salt),
    serverPublicKey: uint8ArrayToBase64Url(serverPubRaw),
  };
}

// ── Public send function ─────────────────────────────────────────────────────

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
  gone?: boolean; // subscription expired
}

export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: PushPayload
): Promise<SendResult> {
  try {
    const { publicKey, privateKey, subject } = await getVapidKeys();

    const payloadStr = JSON.stringify(payload);
    const url        = new URL(subscription.endpoint);
    const audience   = `${url.protocol}//${url.host}`;

    const jwt = await buildVapidJwt(audience, privateKey, subject);

    const { body, salt, serverPublicKey } = await encryptPayload(
      payloadStr,
      subscription.keys.p256dh,
      subscription.keys.auth
    );

    const headers: Record<string, string> = {
      "Content-Type":     "application/octet-stream",
      "Content-Encoding": "aesgcm",
      "Encryption":       `salt=${salt}`,
      "Crypto-Key":       `dh=${serverPublicKey};p256ecdsa=${publicKey}`,
      "Authorization":    `vapid t=${jwt},k=${publicKey}`,
      "TTL":              "86400",
    };

    const res = await fetch(subscription.endpoint, {
      method:  "POST",
      headers,
      body,
    });

    if (res.status === 410 || res.status === 404) {
      return { ok: false, status: res.status, gone: true };
    }

    return { ok: res.ok, status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Generate a new VAPID key pair — run once, store in env vars.
 * Call from a one-off script: `node -e "require('./lib/webpush').generateVapidKeys().then(console.log)"`
 */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const pub  = new Uint8Array(await crypto.subtle.exportKey("raw",   keyPair.publicKey)  as ArrayBuffer);
  const priv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey) as ArrayBuffer);
  return {
    publicKey:  uint8ArrayToBase64Url(pub),
    privateKey: uint8ArrayToBase64Url(priv),
  };
}
