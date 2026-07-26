/**
 * tests/unit/pushProvider.test.ts
 * Sprint 27 — Phase 10 (Push Provider Architecture).
 *
 * Same testing boundary as tests/unit/emailProvider.test.ts (Phase 9):
 * pure request-building and selection logic get unit tests; the actual
 * fetch() calls inside each provider's send() don't. One exception here
 * worth the extra rigor: buildApnsProviderJwt() is tested with a real
 * generated EC keypair and a real signature-verification roundtrip, not
 * just shape-checked — it's exactly the kind of crypto code where
 * "looks plausible" and "is actually correct" can silently diverge, and
 * this is the one place in this PR where that's checkable without a
 * live network call.
 */
import { describe, it, expect } from "vitest";
import { buildExpoRequest } from "@/lib/push/providers/expo";
import { buildOneSignalRequest } from "@/lib/push/providers/onesignal";
import { buildApnsProviderJwt } from "@/lib/push/providers/apns";
import { webPushProvider } from "@/lib/push/providers/webpush";
import { selectPushProvider } from "@/lib/push";
import type { PushMessage, PushRecipient } from "@/lib/push/types";

const message: PushMessage = {
  title: "Hello",
  body: "World",
  url: "/dashboard",
  notificationId: "notif-123",
  type: "streak_at_risk",
};
const recipient: PushRecipient = { target: "some-token-or-endpoint" };

describe("buildExpoRequest", () => {
  it("builds a JSON POST to the Expo push endpoint with no auth header by default", () => {
    const req = buildExpoRequest(recipient, message);
    expect(req.url).toBe("https://exp.host/--/api/v2/push/send");
    expect(req.headers.Authorization).toBeUndefined();
    const body = JSON.parse(req.body);
    expect(body.to).toBe("some-token-or-endpoint");
    expect(body.title).toBe("Hello");
  });

  it("adds a Bearer header when an access token is configured", () => {
    const req = buildExpoRequest(recipient, message, { accessToken: "expo_tok" });
    expect(req.headers.Authorization).toBe("Bearer expo_tok");
  });
});

describe("buildOneSignalRequest", () => {
  it("targets exactly one recipient via include_player_ids and uses the Key auth scheme", () => {
    const req = buildOneSignalRequest(recipient, message, { apiKey: "os_key", appId: "app-1" });
    expect(req.url).toBe("https://onesignal.com/api/v1/notifications");
    expect(req.headers.Authorization).toBe("Key os_key");
    const body = JSON.parse(req.body);
    expect(body.include_player_ids).toEqual(["some-token-or-endpoint"]);
    expect(body.headings.en).toBe("Hello");
    expect(body.contents.en).toBe("World");
  });
});

describe("buildApnsProviderJwt", () => {
  it("produces a JWT whose signature actually verifies against the matching public key", async () => {
    // Generate a real EC P-256 keypair, same curve APNs requires.
    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString("base64")}\n-----END PRIVATE KEY-----`;

    const jwt = await buildApnsProviderJwt("TEAMID1234", "KEYID12345", pem);
    const [h64, c64, s64] = jwt.split(".");

    // Header/claims shape APNs requires.
    const header = JSON.parse(Buffer.from(h64, "base64url").toString());
    const claims = JSON.parse(Buffer.from(c64, "base64url").toString());
    expect(header).toEqual({ alg: "ES256", kid: "KEYID12345" });
    expect(claims.iss).toBe("TEAMID1234");
    expect(typeof claims.iat).toBe("number");

    // The actual correctness check: does the signature verify?
    const signature = Buffer.from(s64, "base64url");
    const signedInput = new TextEncoder().encode(`${h64}.${c64}`);
    const isValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.publicKey,
      signature,
      signedInput
    );
    expect(isValid).toBe(true);
  });
});

describe("webPushProvider", () => {
  it("reports a clear error when webPushKeys are missing, instead of throwing", async () => {
    const result = await webPushProvider.send({ target: "https://example.com/endpoint" }, message);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("webPushKeys");
  });
});

describe("selectPushProvider", () => {
  it("defaults to webpush when PUSH_PROVIDER is unset — NOT a null/no-op provider", () => {
    expect(selectPushProvider({}).name).toBe("webpush");
  });

  it("stays on webpush when PUSH_PROVIDER is explicitly 'webpush'", () => {
    expect(selectPushProvider({ PUSH_PROVIDER: "webpush" }).name).toBe("webpush");
  });

  it("falls back to webpush (not null) when a chosen provider's config is incomplete", () => {
    expect(selectPushProvider({ PUSH_PROVIDER: "firebase" }).name).toBe("webpush");
    expect(selectPushProvider({ PUSH_PROVIDER: "onesignal" }).name).toBe("webpush");
    expect(selectPushProvider({ PUSH_PROVIDER: "apns" }).name).toBe("webpush");
  });

  it("falls back to webpush for an unrecognized PUSH_PROVIDER value", () => {
    expect(selectPushProvider({ PUSH_PROVIDER: "carrier_pigeon" }).name).toBe("webpush");
  });

  it("expo needs no required config, so it's selectable with zero env vars beyond the flag itself", () => {
    expect(selectPushProvider({ PUSH_PROVIDER: "expo" }).name).toBe("expo");
  });

  it("constructs firebase and onesignal once fully configured", () => {
    expect(
      selectPushProvider({
        PUSH_PROVIDER: "firebase",
        FIREBASE_PROJECT_ID: "p", FIREBASE_SERVICE_ACCOUNT_EMAIL: "e@x.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: "k",
      }).name
    ).toBe("firebase");
    expect(
      selectPushProvider({ PUSH_PROVIDER: "onesignal", ONESIGNAL_API_KEY: "k", ONESIGNAL_APP_ID: "a" }).name
    ).toBe("onesignal");
  });

  it("constructs the apns provider when configured, but its send() always throws (documented stub)", async () => {
    const provider = selectPushProvider({
      PUSH_PROVIDER: "apns",
      APNS_TEAM_ID: "T", APNS_KEY_ID: "K", APNS_PRIVATE_KEY: "pem", APNS_TOPIC: "com.example.app",
    });
    expect(provider.name).toBe("apns");
    await expect(provider.send(recipient, message)).rejects.toThrow(/documented stub/);
  });
});
