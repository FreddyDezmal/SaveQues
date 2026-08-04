/**
 * tests/unit/exchangeRatesCache.test.ts
 * Sprint 31 — Phase 8 (createZarConverter) + Phase 13 (batched reads).
 *
 * Covers lib/exchangeRates/cache.ts's getCachedRates() — the single
 * function that now backs getCachedRate(), createZarConverter(),
 * convertCurrency(), and convertAmountsTo() — via the Supabase
 * service-client mock, same pattern as tests/unit/recordOutcome.test.ts.
 * (Previously this file only covered createZarConverter via a
 * single-row .eq().maybeSingle() mock; replaced with an .in()-based mock
 * matching the batched query Phase 13 introduced.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const cachedRows: Record<string, { currency_code: string; usd_rate: number; fetched_at: string; source: string }> = {};

function freshRow(code: string, usdRate: number) {
  return { currency_code: code, usd_rate: usdRate, fetched_at: new Date().toISOString(), source: "test" };
}

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

import { getCachedRate, getCachedRates } from "@/lib/exchangeRates/cache";
import { createZarConverter } from "@/lib/currencyConversion";

describe("getCachedRates", () => {
  beforeEach(() => {
    inCallCount = 0;
    cachedRows.ZAR = freshRow("ZAR", 18.5);
    cachedRows.EUR = freshRow("EUR", 0.92);
    cachedRows.USD = freshRow("USD", 1);
  });

  it("returns rates for every requested currency", async () => {
    const rates = await getCachedRates(["ZAR", "EUR"]);
    expect(rates.get("ZAR")?.usdRate).toBe(18.5);
    expect(rates.get("EUR")?.usdRate).toBe(0.92);
  });

  it("makes exactly ONE query regardless of how many currencies are requested (Phase 13)", async () => {
    await getCachedRates(["ZAR", "EUR", "USD"]);
    expect(inCallCount).toBe(1);
  });

  it("dedupes repeated currency codes into one query entry", async () => {
    const rates = await getCachedRates(["ZAR", "ZAR", "ZAR"]);
    expect(rates.size).toBe(1);
    expect(inCallCount).toBe(1);
  });

  it("returns an empty Map for an empty input without querying at all", async () => {
    const rates = await getCachedRates([]);
    expect(rates.size).toBe(0);
    expect(inCallCount).toBe(0);
  });
});

describe("getCachedRate (single-currency wrapper)", () => {
  beforeEach(() => {
    cachedRows.ZAR = freshRow("ZAR", 18.5);
  });

  it("returns the rate for one currency", async () => {
    const rate = await getCachedRate("ZAR");
    expect(rate.usdRate).toBe(18.5);
  });
});

describe("createZarConverter (via the batched cache)", () => {
  beforeEach(() => {
    inCallCount = 0;
    cachedRows.ZAR = freshRow("ZAR", 18.5);
    cachedRows.EUR = freshRow("EUR", 0.92);
  });

  it("returns a pure identity function for ZAR without touching the cache at all", async () => {
    const convert = await createZarConverter("ZAR");
    expect(convert(1234.56)).toBe(1234.56);
    expect(inCallCount).toBe(0);
  });

  it("converts a ZAR amount into the target currency using cached rates", async () => {
    const convert = await createZarConverter("EUR");
    // 100 ZAR = (100/18.5) USD = 4.973 EUR
    expect(convert(100)).toBeCloseTo(4.97, 2);
  });

  it("resolves both currencies' rates in ONE query, not two (Phase 13)", async () => {
    await createZarConverter("EUR");
    expect(inCallCount).toBe(1);
  });

  it("returns a synchronous, repeatedly-callable function (rate resolved once, not per call)", async () => {
    const convert = await createZarConverter("EUR");
    const a = convert(100);
    const b = convert(100);
    expect(a).toBe(b);
    expect(inCallCount).toBe(1);
  });
});
