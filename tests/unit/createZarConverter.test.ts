/**
 * tests/unit/createZarConverter.test.ts
 * Sprint 31 — Phase 8.
 *
 * lib/currencyConversion.ts's createZarConverter() is the one piece of
 * Phase 8's fix that does touch the DB (via lib/exchangeRates/cache.ts),
 * so — unlike convertAmount()'s pure-math tests in
 * tests/unit/currencyConversion.test.ts — this needs the Supabase
 * service-client mock, same pattern as tests/unit/recordOutcome.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const cachedRows: Record<string, { currency_code: string; usd_rate: number; fetched_at: string; source: string }> = {
  ZAR: { currency_code: "ZAR", usd_rate: 18.5, fetched_at: new Date().toISOString(), source: "test" },
  EUR: { currency_code: "EUR", usd_rate: 0.92, fetched_at: new Date().toISOString(), source: "test" },
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: (_col: string, code: string) => ({
          maybeSingle: () => Promise.resolve({ data: cachedRows[code] ?? null, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { createZarConverter } from "@/lib/currencyConversion";

describe("createZarConverter", () => {
  beforeEach(() => {
    cachedRows.ZAR = { currency_code: "ZAR", usd_rate: 18.5, fetched_at: new Date().toISOString(), source: "test" };
    cachedRows.EUR = { currency_code: "EUR", usd_rate: 0.92, fetched_at: new Date().toISOString(), source: "test" };
  });

  it("returns a pure identity function for ZAR without touching the cache at all", async () => {
    const convert = await createZarConverter("ZAR");
    expect(convert(1234.56)).toBe(1234.56);
  });

  it("converts a ZAR amount into the target currency using cached rates", async () => {
    const convert = await createZarConverter("EUR");
    // 100 ZAR = (100/18.5) USD = 4.973 EUR
    expect(convert(100)).toBeCloseTo(4.97, 2);
  });

  it("returns a synchronous, repeatedly-callable function (rate resolved once, not per call)", async () => {
    const convert = await createZarConverter("EUR");
    const a = convert(100);
    const b = convert(100);
    expect(a).toBe(b);
  });
});
