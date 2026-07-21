/**
 * tests/unit/username.test.ts
 *
 * lib/username.ts's isValidUsernameFormat/slugifyForUsername are the only
 * genuinely pure pieces of the username feature — everything else (the
 * availability RPC, the write route, the backfill migration) needs a real
 * Postgres instance and is covered by tests/integration/username-flow.test.ts
 * as honest todo stubs instead, per this codebase's established convention.
 */
import { describe, it, expect } from "vitest";
import { isValidUsernameFormat, slugifyForUsername, USERNAME_REGEX } from "@/lib/username";

describe("isValidUsernameFormat", () => {
  it("accepts a plain lowercase alphanumeric username", () => {
    expect(isValidUsernameFormat("alex123")).toBe(true);
  });

  it("accepts underscores", () => {
    expect(isValidUsernameFormat("alex_saver")).toBe(true);
  });

  it("accepts mixed case (case is preserved, not required lowercase)", () => {
    expect(isValidUsernameFormat("AlexSaver")).toBe(true);
  });

  it("rejects fewer than 3 characters", () => {
    expect(isValidUsernameFormat("ab")).toBe(false);
  });

  it("accepts exactly 3 characters", () => {
    expect(isValidUsernameFormat("abc")).toBe(true);
  });

  it("rejects more than 20 characters", () => {
    expect(isValidUsernameFormat("a".repeat(21))).toBe(false);
  });

  it("accepts exactly 20 characters", () => {
    expect(isValidUsernameFormat("a".repeat(20))).toBe(true);
  });

  it("rejects spaces", () => {
    expect(isValidUsernameFormat("alex saver")).toBe(false);
  });

  it("rejects punctuation and symbols", () => {
    for (const bad of ["alex-saver", "alex.saver", "alex@saver", "alex!", "alex/saver"]) {
      expect(isValidUsernameFormat(bad)).toBe(false);
    }
  });

  it("rejects emoji and non-ASCII characters", () => {
    expect(isValidUsernameFormat("alex🚀")).toBe(false);
    expect(isValidUsernameFormat("alexé")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidUsernameFormat("")).toBe(false);
  });
});

describe("slugifyForUsername", () => {
  it("lowercases and strips spaces", () => {
    expect(slugifyForUsername("Alex Saver")).toBe("alexsaver");
  });

  it("strips punctuation and symbols", () => {
    expect(slugifyForUsername("Alex-Saver_99!")).toBe("alexsaver_99");
  });

  it("strips emoji", () => {
    expect(slugifyForUsername("🚀 Rocket Alex")).toBe("rocketalex");
  });

  it("truncates to 16 characters (leaving room for a numeric suffix under the 20-char limit)", () => {
    const result = slugifyForUsername("a".repeat(30));
    expect(result.length).toBeLessThanOrEqual(16);
  });

  it("returns an empty string when nothing usable remains (caller must handle this as no-suggestion)", () => {
    expect(slugifyForUsername("🚀🚀🚀")).toBe("");
  });

  it("returns an empty string when the result would be shorter than the 3-char minimum", () => {
    expect(slugifyForUsername("a!")).toBe("");
  });

  it("every non-empty result it produces satisfies isValidUsernameFormat (the whole point of the suggestion)", () => {
    const inputs = ["Alex Saver", "🚀 Rocket", "J", "a".repeat(50), "Zoë Müller", "___"];
    for (const input of inputs) {
      const slug = slugifyForUsername(input);
      if (slug.length > 0) {
        expect(isValidUsernameFormat(slug)).toBe(true);
      }
    }
  });
});

describe("USERNAME_REGEX", () => {
  it("is anchored (does not match a valid substring inside an otherwise-invalid string)", () => {
    expect(USERNAME_REGEX.test("valid_name but with spaces")).toBe(false);
  });
});
