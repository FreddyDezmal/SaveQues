/**
 * tests/unit/dateFormat.test.ts
 * Sprint 31 — Phase 12 (Localization Readiness).
 */
import { describe, it, expect } from "vitest";
import { formatDateLong, formatDateShort, formatDateNumeric } from "@/lib/dateFormat";

const iso = "2026-03-15T00:00:00.000Z";

describe("formatDateLong", () => {
  it("includes day, short month, and year", () => {
    const result = formatDateLong(iso, "en-ZA");
    expect(result).toMatch(/15/);
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/2026/);
  });

  it("defaults to DEFAULT_LOCALE (en-ZA) when no locale is passed", () => {
    expect(formatDateLong(iso)).toBe(formatDateLong(iso, "en-ZA"));
  });

  it("accepts a Date object as well as an ISO string", () => {
    expect(formatDateLong(new Date(iso), "en-US")).toBe(formatDateLong(iso, "en-US"));
  });

  it("respects a different locale (formatting genuinely changes)", () => {
    const enUS = formatDateLong(iso, "en-US");
    const jaJP = formatDateLong(iso, "ja-JP");
    expect(enUS).not.toBe(jaJP);
  });
});

describe("formatDateShort", () => {
  it("includes short month and day, but not the year", () => {
    const result = formatDateShort(iso, "en-ZA");
    expect(result).toMatch(/15/);
    expect(result).toMatch(/Mar/);
    expect(result).not.toMatch(/2026/);
  });

  it("defaults to DEFAULT_LOCALE (en-ZA) when no locale is passed", () => {
    expect(formatDateShort(iso)).toBe(formatDateShort(iso, "en-ZA"));
  });

  it("accepts a Date object as well as an ISO string", () => {
    expect(formatDateShort(new Date(iso), "en-US")).toBe(formatDateShort(iso, "en-US"));
  });
});

describe("formatDateNumeric", () => {
  it("produces the locale's native numeric date format", () => {
    // en-ZA and en-US order day/month differently — proves no options
    // are forcing a fixed style, and that locale really is being used.
    const zaResult = formatDateNumeric(iso, "en-ZA");
    const usResult = formatDateNumeric(iso, "en-US");
    expect(zaResult).not.toBe(usResult);
  });

  it("defaults to DEFAULT_LOCALE (en-ZA) when no locale is passed", () => {
    expect(formatDateNumeric(iso)).toBe(formatDateNumeric(iso, "en-ZA"));
  });

  it("accepts a Date object as well as an ISO string", () => {
    expect(formatDateNumeric(new Date(iso), "en-US")).toBe(formatDateNumeric(iso, "en-US"));
  });
});
