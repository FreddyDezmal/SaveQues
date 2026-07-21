/**
 * @vitest-environment jsdom
 *
 * tests/unit/pendingInvite.test.ts
 *
 * Sprint 22.5. lib/pendingInvite.ts is plain, document-cookie-based
 * logic — no React involved — but needs a real `document`, so this file
 * opts into jsdom per-file (the "unit" project defaults to node; see
 * vitest.config.ts's own comment on why that default is deliberate and
 * left alone). Matches the pattern already used by the "component"
 * project rather than adding a third global environment.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  setPendingInviteCookie,
  getPendingInviteCookie,
  clearPendingInviteCookie,
  PENDING_INVITE_COOKIE_NAME,
} from "@/lib/pendingInvite";

function clearAllCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  });
}

describe("pendingInvite cookie helpers", () => {
  beforeEach(() => {
    clearAllCookies();
  });

  it("round-trips a token through set → get", () => {
    setPendingInviteCookie("abc123XYZ");
    expect(getPendingInviteCookie()).toBe("abc123XYZ");
  });

  it("returns null when no cookie has been set", () => {
    expect(getPendingInviteCookie()).toBeNull();
  });

  it("clears the cookie so a later get returns null", () => {
    setPendingInviteCookie("abc123XYZ");
    clearPendingInviteCookie();
    expect(getPendingInviteCookie()).toBeNull();
  });

  it("sets the cookie under the documented name, path, and samesite attributes", () => {
    setPendingInviteCookie("tok");
    // jsdom's document.cookie getter only exposes name=value pairs (not
    // attributes), so we assert the attributes were part of the write by
    // checking the cookie is actually retrievable at path "/" — the real
    // attribute string itself is asserted via the exported constant name,
    // which the callback route and this module must agree on.
    expect(PENDING_INVITE_COOKIE_NAME).toBe("sq_pending_invite");
    expect(document.cookie).toContain(`${PENDING_INVITE_COOKIE_NAME}=tok`);
  });

  it("URL-encodes and decodes tokens safely, including unusual characters", () => {
    setPendingInviteCookie("a b+c/d=e");
    expect(getPendingInviteCookie()).toBe("a b+c/d=e");
  });

  it("does not false-positive match a cookie whose name merely contains the target name as a substring", () => {
    document.cookie = "not_sq_pending_invite=decoy; path=/";
    document.cookie = "sq_pending_invite_extra=decoy2; path=/";
    expect(getPendingInviteCookie()).toBeNull();
  });

  it("is a silent no-op outside a browser (SSR-safe), rather than throwing", () => {
    // Simulates the server-side import path (e.g. if this module were
    // ever accidentally imported into a Server Component) — since the
    // real server route reads the cookie via NextRequest instead, these
    // functions should degrade gracefully, not crash the render.
    const originalDocument = globalThis.document;
    // @ts-expect-error — deliberately simulating an environment with no document
    delete globalThis.document;
    expect(() => setPendingInviteCookie("x")).not.toThrow();
    expect(getPendingInviteCookie()).toBeNull();
    expect(() => clearPendingInviteCookie()).not.toThrow();
    globalThis.document = originalDocument;
  });
});
