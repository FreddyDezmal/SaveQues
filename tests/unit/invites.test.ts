/**
 * tests/unit/invites.test.ts
 *
 * Sprint 22 — Phase 16. Tests lib/invites.ts.
 *
 * generateInviteToken() and buildInviteUrl() are pure. sendInviteEmail()
 * is a deliberate, documented stub (see lib/invites.ts's file header —
 * no email provider is configured anywhere in this codebase); these tests
 * pin down its documented contract (never throws, always reports
 * sent:false/no_provider_configured, logs a warning naming the recipient)
 * rather than pretending it sends anything.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateInviteToken, buildInviteUrl, sendInviteEmail } from "@/lib/invites";

describe("generateInviteToken", () => {
  it("returns a URL-safe, 22-character token", () => {
    const token = generateInviteToken();
    expect(token).toHaveLength(22);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never contains base64's +, /, or = padding characters", () => {
    // Regression guard: base64url must be used, not plain base64, or the
    // token isn't actually safe to drop into a URL path segment un-encoded.
    for (let i = 0; i < 50; i++) {
      const token = generateInviteToken();
      expect(token).not.toMatch(/[+/=]/);
    }
  });

  it("generates a different token on every call", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateInviteToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("buildInviteUrl", () => {
  it("joins a base URL and token under /invite/", () => {
    expect(buildInviteUrl("https://savequest.app", "abc123")).toBe(
      "https://savequest.app/invite/abc123"
    );
  });

  it("strips exactly one trailing slash from the base URL", () => {
    expect(buildInviteUrl("https://savequest.app/", "abc123")).toBe(
      "https://savequest.app/invite/abc123"
    );
  });

  it("does not mangle a base URL with a path prefix", () => {
    expect(buildInviteUrl("https://savequest.app/app", "abc123")).toBe(
      "https://savequest.app/app/invite/abc123"
    );
  });
});

describe("sendInviteEmail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves sent:false with reason 'no_provider_configured', and never throws", async () => {
    const result = await sendInviteEmail({
      toEmail: "friend@example.com",
      inviterDisplayName: "Alex",
      inviteUrl: "https://savequest.app/invite/abc123",
    });
    expect(result).toEqual({ sent: false, reason: "no_provider_configured" });
  });

  it("logs a warning naming the recipient and invite URL, without throwing on a missing groupName", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendInviteEmail({
      toEmail: "friend@example.com",
      inviterDisplayName: "Alex",
      inviteUrl: "https://savequest.app/invite/abc123",
      groupName: null,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("friend@example.com");
    expect(warnSpy.mock.calls[0][0]).toContain("https://savequest.app/invite/abc123");
  });
});
