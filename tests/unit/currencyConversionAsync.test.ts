/**
 * tests/unit/currencyConversionAsync.test.ts
 * Sprint 31 — Phase 15 (Testing): tests/unit/currencyConversion.test.ts
 * only covers convertAmount()'s pure math (by design — see that file's
 * header). This file covers the async I/O wrappers convertCurrency(),
 * convertAmountsTo(), and resolveRates() via the same Supabase
 * service-client mock pattern as tests/unit/exchangeRatesCache.test.ts,
 * closing a real coverage gap Phase 15's audit found (55% line coverage
 * on lib/currencyConversion.ts before this file existed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const cachedRows: Record<string, { currency_code: string; usd_rate: number; fetched_at: string; source: string }> = {};
let inCallCount = 0;

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        in: (_col: string, codes: string[]) => {
          inCallCount++;
          const rows = codes.map((c) => cachedRows[c]).filter(Boolean);
          return Promise.resolve({ data: rows, error: null });
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { convertCurrency, convertAmountsTo, resolveRates } from "@/lib/currencyConversion";

function freshRow(code: string, usdRate: number) {
  return { currency_code: code, usd_rate: usdRate, fetched_at: new Date().toISOString(), source: "test" };
}

describe("convertCurrency", () => {
  beforeEach(() => {
    inCallCount = 0;
    cachedRows.ZAR = freshRow("ZAR", 18.5);
    cachedRows.EUR = freshRow("EUR", 0.92);
  });

  it("short-circuits to identity (no cache read at all) when fromCode === toCode", async () => {
    const result = await convertCurrency(1234.567, "ZAR", "ZAR");
    expect(result.rate).toBe(1);
    expect(result.amount).toBe(1234.57); // rounded to ZAR's 2 decimals
    expect(inCallCount).toBe(0);
  });

  it("converts between two different currencies via one batched cache read", async () => {
    const result = await convertCurrency(100, "ZAR", "EUR");
    expect(result.amount).toBeCloseTo(4.97, 2);
    expect(inCallCount).toBe(1);
  });

  it("zero amount converts to zero", async () => {
    const result = await convertCurrency(0, "ZAR", "EUR");
    expect(result.amount).toBe(0);
  });

  it("negative amounts convert correctly (e.g. a shortfall figure)", async () => {
    const result = await convertCurrency(-100, "ZAR", "EUR");
    expect(result.amount).toBeCloseTo(-4.97, 2);
  });

  it("large amounts convert without precision loss", async () => {
    const result = await convertCurrency(10_000_000, "ZAR", "EUR");
    expect(result.amount).toBeCloseTo(497297.30, 1);
  });
});

describe("convertAmountsTo", () => {
  beforeEach(() => {
    inCallCount = 0;
    cachedRows.ZAR = freshRow("ZAR", 18.5);
    cachedRows.EUR = freshRow("EUR", 0.92);
    cachedRows.USD = freshRow("USD", 1);
  });

  it("converts a mixed-currency list to one target currency", async () => {
    const results = await convertAmountsTo(
      [
        { amount: 100, currencyCode: "ZAR" },
        { amount: 50, currencyCode: "USD" },
      ],
      "EUR"
    );
    expect(results).toHaveLength(2);
    expect(results[0].toCurrency).toBe("EUR");
    expect(results[0].originalAmount).toBe(100);
    expect(results[1].originalAmount).toBe(50);
  });

  it("resolves every distinct currency in exactly ONE batched query, regardless of item count", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      amount: i + 1,
      currencyCode: i % 2 === 0 ? "ZAR" : "USD",
    }));
    await convertAmountsTo(items, "EUR");
    expect(inCallCount).toBe(1);
  });

  it("returns an empty array for an empty input", async () => {
    const results = await convertAmountsTo([], "EUR");
    expect(results).toEqual([]);
  });

  it("handles an item already in the target currency (rate of 1, no distortion)", async () => {
    const results = await convertAmountsTo([{ amount: 100, currencyCode: "EUR" }], "EUR");
    expect(results[0].amount).toBe(100);
    expect(results[0].rate).toBe(1);
  });
});

describe("resolveRates", () => {
  beforeEach(() => {
    inCallCount = 0;
    cachedRows.ZAR = freshRow("ZAR", 18.5);
    cachedRows.EUR = freshRow("EUR", 0.92);
  });

  it("returns a Map keyed by currency code", async () => {
    const rates = await resolveRates(["ZAR", "EUR"]);
    expect(rates.get("ZAR")?.usdRate).toBe(18.5);
    expect(rates.get("EUR")?.usdRate).toBe(0.92);
  });

  it("does the conversion-free lookup in one query", async () => {
    await resolveRates(["ZAR", "EUR"]);
    expect(inCallCount).toBe(1);
  });
});
