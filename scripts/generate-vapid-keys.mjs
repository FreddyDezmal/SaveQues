/**
 * scripts/generate-vapid-keys.mjs
 *
 * Run once to generate VAPID keys for Web Push:
 *   node scripts/generate-vapid-keys.mjs
 *
 * Then add the output to your .env.local:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<publicKey>
 *   VAPID_PRIVATE_KEY=<privateKey>
 *   VAPID_SUBJECT=mailto:your@email.com
 */

const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);

const pub  = new Uint8Array(await crypto.subtle.exportKey("raw",   keyPair.publicKey));
const priv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));

function toBase64Url(buf) {
  return Buffer.from(buf).toString("base64url");
}

console.log("\n✅ VAPID Keys generated. Add these to your .env.local:\n");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${toBase64Url(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${toBase64Url(priv)}`);
console.log(`VAPID_SUBJECT=mailto:admin@savequest.app`);
console.log(`CRON_SECRET=${crypto.randomUUID().replace(/-/g, "")}\n`);
