/**
 * tests/unit/currency.test.ts
 *
 * Sprint 18 — Phase 3. Tests lib/currency.ts.
 *
 * Deliberate choice: these tests do NOT assert exact Intl.NumberFormat
 * output strings (e.g. "R 5 000" vs "R\u00a05\u00a0000") for the happy
 * path — that exact spacing/separator behavior depends on the ICU data
 * bundled with the Node.js runtime executing the test, which can differ
 * between a developer's machine and CI even on the "same" Node version.
 * A test asserting an exact string there would be flaky for reasons that
 * have nothing to do with a real bug. Instead, these assert the properties
 * that actually matter: the right digits appear, the fallback path works
 * and never throws, and the documented rounding/ceiling behavior in
 * weeklyTarget is exact (that one IS safe to pin — it's plain arithmetic,
 * not locale-dependent formatting).
 */
import { describe, it, expect } from "vitest";
import {
  formatAmount,
  formatAmountCompact,
  getCurrencyConfig,
  weeklyTarget,
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY,
} from "@/lib/currency";

describe("formatAmount", () => {
  it("includes the correctly rounded digits for a whole-number amount", () => {
    const result = formatAmount(5000, "USD", "en-US");
    expect(result).toContain("5,000");
  });

  it("never throws for any currency in SUPPORTED_CURRENCIES", () => {
    for (const { code, locale } of SUPPORTED_CURRENCIES) {
      expect(() => formatAmount(1234, code, locale)).not.toThrow();
    }
  });

  it("falls back to a plain 'CODE amount' string for an unsupported currency code, without throwing", () => {
    const result = formatAmount(5000, "NOTACURRENCY", "en-US");
    expect(result).toBe("NOTACURRENCY 5,000");
  });

  it("defaults to ZAR when no currency code is passed", () => {
    // Doesn't assert the exact symbol/spacing (ICU-dependent — see file
    // header) — just that the default arg is actually DEFAULT_CURRENCY,
    // by confirming it behaves identically to passing "ZAR" explicitly.
    expect(formatAmount(1000)).toBe(formatAmount(1000, DEFAULT_CURRENCY));
  });

  it("rounds to zero decimal places (minimumFractionDigits/maximumFractionDigits: 0)", () => {
    const result = formatAmount(99.6, "USD", "en-US");
    expect(result).toContain("100"); // 99.6 rounds up to 100, not 99 or 99.6
  });

  // ── Sprint 31, Phase 5: opt-in `precise` mode ──────────────────────────
  // formatAmount's DEFAULT output (asserted above) must stay whole-unit for
  // every currency — that's the existing, load-bearing app-wide behavior.
  // `precise: true` is purely additive and must never change the default.
  it("precise mode is opt-in only — default output is unchanged for JPY/BHD", () => {
    expect(formatAmount(1234.5, "JPY", "ja-JP")).toBe(formatAmount(1234.5, "JPY", "ja-JP", { precise: false }));
    expect(formatAmount(1234.5, "BHD", "ar-BH")).toBe(formatAmount(1234.5, "BHD", "ar-BH", { precise: false }));
  });

  it("precise mode shows 0 decimals for JPY (a zero-decimal ISO currency)", () => {
    const result = formatAmount(1234.5, "JPY", "ja-JP", { precise: true });
    expect(result).not.toMatch(/\.\d/); // no decimal point followed by digits
  });

  it("precise mode shows 3 decimals for BHD (a three-decimal ISO currency)", () => {
    const result = formatAmount(1234.5, "BHD", "en-US", { precise: true });
    expect(result).toContain("1,234.500");
  });

  it("precise mode shows 2 decimals for USD", () => {
    const result = formatAmount(1234.5, "USD", "en-US", { precise: true });
    expect(result).toContain("1,234.50");
  });

  it("never throws in precise mode for any currency in SUPPORTED_CURRENCIES", () => {
    for (const { code, locale } of SUPPORTED_CURRENCIES) {
      expect(() => formatAmount(1234.56, code, locale, { precise: true })).not.toThrow();
    }
  });
});

describe("SUPPORTED_CURRENCIES decimals field", () => {
  it("every currency has a non-negative integer decimals value", () => {
    for (const c of SUPPORTED_CURRENCIES) {
      expect(Number.isInteger(c.decimals)).toBe(true);
      expect(c.decimals).toBeGreaterThanOrEqual(0);
    }
  });

  it("JPY is a zero-decimal currency", () => {
    expect(getCurrencyConfig("JPY").decimals).toBe(0);
  });

  it("BHD is a three-decimal currency", () => {
    expect(getCurrencyConfig("BHD").decimals).toBe(3);
  });

  it("ZAR and USD are two-decimal currencies", () => {
    expect(getCurrencyConfig("ZAR").decimals).toBe(2);
    expect(getCurrencyConfig("USD").decimals).toBe(2);
  });
});

describe("formatAmountCompact", () => {
  it("produces a shorter string than formatAmount for a large number", () => {
    const full = formatAmount(5_000_000, "USD", "en-US");
    const compact = formatAmountCompact(5_000_000, "USD", "en-US");
    expect(compact.length).toBeLessThan(full.length);
  });

  it("never throws for any currency in SUPPORTED_CURRENCIES", () => {
    for (const { code, locale } of SUPPORTED_CURRENCIES) {
      expect(() => formatAmountCompact(1_000_000, code, locale)).not.toThrow();
    }
  });
});

describe("getCurrencyConfig", () => {
  it("returns the matching config for a known code", () => {
    expect(getCurrencyConfig("USD").label).toBe("US Dollar ($)");
  });

  it("falls back to the first entry (ZAR) for an unknown code", () => {
    expect(getCurrencyConfig("FAKE").code).toBe("ZAR");
  });
});

describe("weeklyTarget", () => {
  it("divides the remaining amount evenly across whole weeks", () => {
    expect(weeklyTarget(1000, 10)).toBe(100);
  });

  it("rounds UP (ceiling), never leaving the user short of their goal on the final week", () => {
    // 1000 / 3 = 333.33... — ceiling to 334, not 333 (which would leave
    // the goal $1 short after 3 weeks of the "suggested" amount).
    expect(weeklyTarget(1000, 3)).toBe(334);
  });

  it("returns the full remaining amount when zero or negative weeks remain (target date has passed)", () => {
    expect(weeklyTarget(500, 0)).toBe(500);
    expect(weeklyTarget(500, -2)).toBe(500);
  });
});
