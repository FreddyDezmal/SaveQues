/**
 * tests/unit/currencyConversion.test.ts
 * Sprint 31 — Phase 7 (Currency Conversion Engine).
 *
 * Same testing boundary as tests/unit/financialHealthScore.test.ts (pure
 * function gets full unit coverage) vs. lib/financialHealthSnapshot.ts
 * (I/O wrapper, no dedicated unit test file — needs a live/mocked DB,
 * which is an integration-test concern). convertCurrency() and
 * convertAmountsTo() here are the equivalent I/O wrappers and are left
 * to integration tests for the same reason.
 */
import { describe, it, expect } from "vitest";
import { convertAmount, roundToDecimals } from "@/lib/currencyConversion";
import type { ExchangeRate } from "@/lib/exchangeRates/types";

const usd = (usdRate: number, fetchedAt = "2026-08-01T00:00:00.000Z"): ExchangeRate => ({
  currencyCode: "USD",
  usdRate,
  fetchedAt,
  source: "test",
});
const rate = (code: string, usdRate: number, fetchedAt = "2026-08-01T00:00:00.000Z"): ExchangeRate => ({
  currencyCode: code,
  usdRate,
  fetchedAt,
  source: "test",
});

describe("roundToDecimals", () => {
  it("rounds to the given number of decimal places", () => {
    expect(roundToDecimals(1.2345, 2)).toBe(1.23);
    expect(roundToDecimals(1.2355, 2)).toBe(1.24);
  });

  it("rounds to zero decimals cleanly (JPY-style)", () => {
    expect(roundToDecimals(1234.5, 0)).toBe(1235);
    expect(roundToDecimals(1234.4, 0)).toBe(1234);
  });

  it("rounds to three decimals cleanly (BHD-style)", () => {
    expect(roundToDecimals(1.2345, 3)).toBe(1.235);
    expect(roundToDecimals(1.2344, 3)).toBe(1.234);
  });

  it("handles zero", () => {
    expect(roundToDecimals(0, 2)).toBe(0);
    expect(roundToDecimals(-0, 2)).toBe(0);
  });

  it("handles negative values", () => {
    expect(roundToDecimals(-1.005, 2)).toBe(-1.01);
    expect(roundToDecimals(-99.999, 2)).toBe(-100);
  });

  it("handles the classic floating-point misround case (1.005 → 1.01, not 1.00)", () => {
    expect(roundToDecimals(1.005, 2)).toBe(1.01);
  });

  it("handles very large values without precision loss at the target scale", () => {
    expect(roundToDecimals(999999999.456, 2)).toBe(999999999.46);
  });

  it("handles very small decimals", () => {
    expect(roundToDecimals(0.001, 2)).toBe(0);
    expect(roundToDecimals(0.005, 2)).toBe(0.01);
  });
});

describe("convertAmount", () => {
  it("is a pure passthrough (only rounded) when fromCurrency === toCurrency", () => {
    const zar = rate("ZAR", 18.5);
    const result = convertAmount(1234.567, zar, zar);
    expect(result.rate).toBe(1);
    // Rounds to ZAR's real decimals (2, per Phase 5's SUPPORTED_CURRENCIES
    // config) — note this is deliberately DIFFERENT from formatAmount's
    // whole-unit display default; convertAmount always uses real decimals.
    expect(result.amount).toBe(1234.57);
  });

  it("converts correctly through the USD pivot (ZAR → EUR via two USD rates)", () => {
    // 1 USD = 18.50 ZAR, 1 USD = 0.92 EUR → 100 ZAR = (100/18.50) USD = 5.405... USD = 4.973 EUR
    const zar = rate("ZAR", 18.5);
    const eur = rate("EUR", 0.92);
    const result = convertAmount(100, zar, eur);
    expect(result.amount).toBeCloseTo(4.97, 2);
    expect(result.fromCurrency).toBe("ZAR");
    expect(result.toCurrency).toBe("EUR");
  });

  it("rounds the result to the TARGET currency's decimals, not the source's", () => {
    const usdRate = usd(1);
    const jpy = rate("JPY", 155.2);
    const result = convertAmount(10, usdRate, jpy); // $10 → ¥1552, JPY has 0 decimals
    expect(Number.isInteger(result.amount)).toBe(true);
    expect(result.amount).toBe(1552);
  });

  it("respects BHD's 3-decimal precision on the way in", () => {
    const usdRate = usd(1);
    const bhd = rate("BHD", 0.376);
    const result = convertAmount(100, usdRate, bhd); // $100 → 37.6 BHD
    expect(result.amount).toBe(37.6);
  });

  it("computes the correct effective rate (toRate / fromRate)", () => {
    const zar = rate("ZAR", 18.5);
    const usdRate = usd(1);
    const result = convertAmount(1, zar, usdRate);
    expect(result.rate).toBeCloseTo(1 / 18.5, 6);
  });

  it("handles zero", () => {
    const zar = rate("ZAR", 18.5);
    const eur = rate("EUR", 0.92);
    expect(convertAmount(0, zar, eur).amount).toBe(0);
  });

  it("handles negative amounts (e.g. a shortfall figure)", () => {
    const zar = rate("ZAR", 18.5);
    const eur = rate("EUR", 0.92);
    expect(convertAmount(-100, zar, eur).amount).toBeCloseTo(-4.97, 2);
  });

  it("handles very large amounts", () => {
    const zar = rate("ZAR", 18.5);
    const usdRate = usd(1);
    const result = convertAmount(10_000_000, zar, usdRate);
    expect(result.amount).toBeCloseTo(540540.54, 2);
  });

  it("uses the OLDER of the two rates' fetchedAt as asOf", () => {
    const older = rate("ZAR", 18.5, "2026-07-30T00:00:00.000Z");
    const newer = rate("EUR", 0.92, "2026-08-01T00:00:00.000Z");
    expect(convertAmount(100, older, newer).asOf).toBe("2026-07-30T00:00:00.000Z");
    // Order of arguments shouldn't change which timestamp is "older".
    expect(convertAmount(100, newer, older).asOf).toBe("2026-07-30T00:00:00.000Z");
  });

  it("is deterministic — identical inputs always produce identical output", () => {
    const zar = rate("ZAR", 18.53217);
    const eur = rate("EUR", 0.91876);
    const a = convertAmount(1234.56, zar, eur);
    const b = convertAmount(1234.56, zar, eur);
    expect(a).toEqual(b);
  });

  it("never mutates its input ExchangeRate objects", () => {
    const zar = rate("ZAR", 18.5);
    const eur = rate("EUR", 0.92);
    const zarBefore = { ...zar };
    const eurBefore = { ...eur };
    convertAmount(100, zar, eur);
    expect(zar).toEqual(zarBefore);
    expect(eur).toEqual(eurBefore);
  });

  it("round-trips A→B→A within the target currencies' rounding precision", () => {
    const zar = rate("ZAR", 18.5);
    const usdRate = usd(1);
    const toUsd = convertAmount(1850, zar, usdRate); // 1850 ZAR → $100
    const backToZar = convertAmount(toUsd.amount, usdRate, zar);
    expect(backToZar.amount).toBeCloseTo(1850, 0);
  });
});
