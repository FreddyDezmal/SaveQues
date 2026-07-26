/**
 * tests/unit/emailProvider.test.ts
 * Sprint 27 — Phase 9 (Email Provider Architecture).
 *
 * Tests the pure parts only: request-building for each real adapter
 * (verifiable without a network call — same "extract the pure decision,
 * test that" pattern as lib/webpush.ts's isRetryable) and the provider
 * selection logic (env-shaped object in, EmailProvider out). The actual
 * fetch() calls inside each provider's send() are not mocked/tested
 * here, consistent with this codebase's existing boundary between unit
 * tests (pure logic) and integration-level manual-test docs (anything
 * that really talks to a network).
 */
import { describe, it, expect } from "vitest";
import { buildResendRequest } from "@/lib/email/providers/resend";
import { buildSendGridRequest } from "@/lib/email/providers/sendgrid";
import { buildPostmarkRequest } from "@/lib/email/providers/postmark";
import { buildMailgunRequest } from "@/lib/email/providers/mailgun";
import { nullEmailProvider } from "@/lib/email/providers/null";
import { selectEmailProvider } from "@/lib/email";
import type { EmailMessage } from "@/lib/email/types";

const message: EmailMessage = {
  to: "user@example.com",
  subject: "Hello",
  text: "Plain text body",
  html: "<p>HTML body</p>",
};

describe("nullEmailProvider", () => {
  it("never sends and reports the configured reason", async () => {
    const result = await nullEmailProvider.send(message);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe("no_provider_configured");
  });
});

describe("buildResendRequest", () => {
  it("builds a Bearer-authed JSON POST to the Resend emails endpoint", () => {
    const req = buildResendRequest(message, { apiKey: "re_test", fromAddress: "from@x.com" });
    expect(req.url).toBe("https://api.resend.com/emails");
    expect(req.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(req.body);
    expect(body.to).toBe("user@example.com");
    expect(body.subject).toBe("Hello");
    expect(body.html).toBe("<p>HTML body</p>");
  });

  it("omits the html field entirely when no HTML body is given", () => {
    const req = buildResendRequest({ ...message, html: undefined }, { apiKey: "k", fromAddress: "f@x.com" });
    expect(JSON.parse(req.body)).not.toHaveProperty("html");
  });
});

describe("buildSendGridRequest", () => {
  it("builds the personalizations/content array shape SendGrid v3 expects", () => {
    const req = buildSendGridRequest(message, { apiKey: "sg_test", fromAddress: "from@x.com" });
    expect(req.url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(req.headers.Authorization).toBe("Bearer sg_test");
    const body = JSON.parse(req.body);
    expect(body.personalizations[0].to[0].email).toBe("user@example.com");
    expect(body.from.email).toBe("from@x.com");
    expect(body.content).toEqual([
      { type: "text/plain", value: "Plain text body" },
      { type: "text/html", value: "<p>HTML body</p>" },
    ]);
  });

  it("includes only the text/plain content entry when no HTML is given", () => {
    const req = buildSendGridRequest({ ...message, html: undefined }, { apiKey: "k", fromAddress: "f@x.com" });
    expect(JSON.parse(req.body).content).toHaveLength(1);
  });
});

describe("buildPostmarkRequest", () => {
  it("uses the X-Postmark-Server-Token header and PascalCase body fields", () => {
    const req = buildPostmarkRequest(message, { serverToken: "pm_test", fromAddress: "from@x.com" });
    expect(req.url).toBe("https://api.postmarkapp.com/email");
    expect(req.headers["X-Postmark-Server-Token"]).toBe("pm_test");
    const body = JSON.parse(req.body);
    expect(body.To).toBe("user@example.com");
    expect(body.TextBody).toBe("Plain text body");
    expect(body.MessageStream).toBe("outbound");
  });
});

describe("buildMailgunRequest", () => {
  it("uses HTTP Basic auth with 'api' as the username and form-encodes the body", () => {
    const req = buildMailgunRequest(message, { apiKey: "mg_test", domain: "mg.example.com", fromAddress: "from@x.com" });
    expect(req.url).toBe("https://api.mailgun.net/v3/mg.example.com/messages");
    expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const expectedAuth = `Basic ${Buffer.from("api:mg_test").toString("base64")}`;
    expect(req.headers.Authorization).toBe(expectedAuth);
    const params = new URLSearchParams(req.body);
    expect(params.get("to")).toBe("user@example.com");
    expect(params.get("html")).toBe("<p>HTML body</p>");
  });

  it("sets the Reply-To form field only when a replyTo is given", () => {
    const withReply = buildMailgunRequest(
      { ...message, replyTo: "support@x.com" },
      { apiKey: "k", domain: "d.com", fromAddress: "f@x.com" }
    );
    expect(new URLSearchParams(withReply.body).get("h:Reply-To")).toBe("support@x.com");

    const withoutReply = buildMailgunRequest(message, { apiKey: "k", domain: "d.com", fromAddress: "f@x.com" });
    expect(new URLSearchParams(withoutReply.body).has("h:Reply-To")).toBe(false);
  });
});

describe("selectEmailProvider", () => {
  it("returns the null provider when EMAIL_PROVIDER is unset", () => {
    expect(selectEmailProvider({}).name).toBe("null");
  });

  it("returns the null provider when EMAIL_PROVIDER is set but EMAIL_FROM_ADDRESS is missing", () => {
    expect(selectEmailProvider({ EMAIL_PROVIDER: "resend" }).name).toBe("null");
  });

  it("returns the null provider when the chosen provider's required key is missing", () => {
    expect(
      selectEmailProvider({ EMAIL_PROVIDER: "resend", EMAIL_FROM_ADDRESS: "f@x.com" }).name
    ).toBe("null");
  });

  it("returns the null provider for an unrecognized EMAIL_PROVIDER value", () => {
    expect(
      selectEmailProvider({ EMAIL_PROVIDER: "carrier_pigeon", EMAIL_FROM_ADDRESS: "f@x.com" }).name
    ).toBe("null");
  });

  it("constructs the real provider once fully configured", () => {
    const provider = selectEmailProvider({
      EMAIL_PROVIDER: "resend",
      EMAIL_FROM_ADDRESS: "f@x.com",
      RESEND_API_KEY: "re_test",
    });
    expect(provider.name).toBe("resend");
  });

  it("constructs each provider type when fully configured", () => {
    expect(
      selectEmailProvider({ EMAIL_PROVIDER: "sendgrid", EMAIL_FROM_ADDRESS: "f@x.com", SENDGRID_API_KEY: "k" }).name
    ).toBe("sendgrid");
    expect(
      selectEmailProvider({ EMAIL_PROVIDER: "postmark", EMAIL_FROM_ADDRESS: "f@x.com", POSTMARK_SERVER_TOKEN: "k" }).name
    ).toBe("postmark");
    expect(
      selectEmailProvider({
        EMAIL_PROVIDER: "mailgun", EMAIL_FROM_ADDRESS: "f@x.com", MAILGUN_API_KEY: "k", MAILGUN_DOMAIN: "d.com",
      }).name
    ).toBe("mailgun");
  });

  it("constructs the SES provider when configured, but its send() always throws (documented stub)", async () => {
    const provider = selectEmailProvider({
      EMAIL_PROVIDER: "ses",
      EMAIL_FROM_ADDRESS: "f@x.com",
      SES_ACCESS_KEY_ID: "a",
      SES_SECRET_ACCESS_KEY: "b",
      SES_REGION: "us-east-1",
    });
    expect(provider.name).toBe("ses");
    await expect(provider.send(message)).rejects.toThrow(/documented stub/);
  });
});
