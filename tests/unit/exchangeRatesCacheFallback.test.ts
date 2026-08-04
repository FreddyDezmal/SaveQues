/**
 * tests/unit/exchangeRatesCacheFallback.test.ts
 * Sprint 31 — Phase 15 (Testing): closes the coverage gap on
 * lib/exchangeRates/cache.ts's documented fallback order, which is the
 * core design contract of Phase 6 but wasn't actually exercised by
 * tests until now — tests/unit/exchangeRatesCache.test.ts only covered
 * the fresh-cache-hit path.
 *
 * Fallback order under test (see cache.ts's file header):
 *   1. Fresh cached row → use it, no network call.
 *   2. Stale/missing → call the live provider (refreshAllRates).
 *   3. Live call fails AND a stale row exists → serve the stale row.
 *   4. Live call fails AND there is no cached row at all → throw.
 *   5. Live call SUCCEEDS but the provider's response is missing this
 *      particular currency → same stale-or-throw logic applies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const cachedRows: Record<string, { currency_code: string; usd_rate: number; fetched_at: string; source: string }> = {};
let upsertShouldFail = false;
let upsertCalls: any[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        in: (_col: string, codes: string[]) => {
          const rows = codes.map((c) => cachedRows[c]).filter(Boolean);
          return Promise.resolve({ data: rows, error: null });
        },
      }),
      upsert: (rows: any[], _opts: any) => {
        upsertCalls.push(rows);
        if (upsertShouldFail) return Promise.resolve({ error: { message: "db unavailable" } });
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Mock the provider layer so tests can control exactly what "the live
// provider" returns, independent of env vars.
let mockProviderImpl: () => Promise<{ currencyCode: string; usdRate: number; fetchedAt: string; source: string }[]>;
vi.mock("@/lib/exchangeRates/index", () => ({
  getExchangeRateProvider: () => ({
    name: "mock-provider",
    getRates: () => mockProviderImpl(),
  }),
}));

import { getCachedRates, refreshAllRates } from "@/lib/exchangeRates/cache";

const FAR_PAST = "2020-01-01T00:00:00.000Z"; // always stale
const NOW = new Date("2026-08-04T00:00:00.000Z");

function freshRow(code: string, usdRate: number, fetchedAt = NOW.toISOString()) {
  return { currency_code: code, usd_rate: usdRate, fetched_at: fetchedAt, source: "test" };
}

describe("getCachedRates — fallback order", () => {
  beforeEach(() => {
    for (const key of Object.keys(cachedRows)) delete cachedRows[key];
    upsertShouldFail = false;
    upsertCalls = [];
    mockProviderImpl = async () => [
      { currencyCode: "ZAR", usdRate: 18.5, fetchedAt: NOW.toISOString(), source: "mock-provider" },
      { currencyCode: "EUR", usdRate: 0.92, fetchedAt: NOW.toISOString(), source: "mock-provider" },
    ];
  });

  it("1. uses a fresh cached row without calling the provider", async () => {
    cachedRows.ZAR = freshRow("ZAR", 99); // deliberately different from provider's 18.5
    const rates = await getCachedRates(["ZAR"], NOW);
    expect(rates.get("ZAR")?.usdRate).toBe(99); // proves it used the cache, not the provider
  });

  it("2. refreshes from the provider when the cached row is stale", async () => {
    cachedRows.ZAR = freshRow("ZAR", 99, FAR_PAST);
    const rates = await getCachedRates(["ZAR"], NOW);
    expect(rates.get("ZAR")?.usdRate).toBe(18.5); // provider's value, proving a refresh happened
  });

  it("2b. refreshes from the provider when there's no cached row at all", async () => {
    const rates = await getCachedRates(["EUR"], NOW);
    expect(rates.get("EUR")?.usdRate).toBe(0.92);
  });

  it("3. serves the stale row when the live refresh throws", async () => {
    cachedRows.ZAR = freshRow("ZAR", 99, FAR_PAST);
    mockProviderImpl = async () => { throw new Error("network down"); };
    const rates = await getCachedRates(["ZAR"], NOW);
    expect(rates.get("ZAR")?.usdRate).toBe(99); // stale value, not a throw
  });

  it("4. throws when the live refresh fails AND there is no cached row", async () => {
    mockProviderImpl = async () => { throw new Error("network down"); };
    await expect(getCachedRates(["ZAR"], NOW)).rejects.toThrow();
  });

  it("5. serves the stale row when the provider succeeds but omits this currency", async () => {
    cachedRows.BHD = freshRow("BHD", 0.376, FAR_PAST); // BHD not in mockProviderImpl's response
    const rates = await getCachedRates(["BHD"], NOW);
    expect(rates.get("BHD")?.usdRate).toBe(0.376);
  });

  it("5b. throws when the provider succeeds but omits a currency with no cached row", async () => {
    await expect(getCachedRates(["BHD"], NOW)).rejects.toThrow();
  });

  it("mixes fresh, stale, and missing currencies correctly in one batched call", async () => {
    cachedRows.ZAR = freshRow("ZAR", 99); // fresh — should NOT be refreshed
    cachedRows.BHD = freshRow("BHD", 0.376, FAR_PAST); // stale, provider omits it — falls back to stale
    // EUR: no cached row at all — provider has it
    const rates = await getCachedRates(["ZAR", "BHD", "EUR"], NOW);
    expect(rates.get("ZAR")?.usdRate).toBe(99);
    expect(rates.get("BHD")?.usdRate).toBe(0.376);
    expect(rates.get("EUR")?.usdRate).toBe(0.92);
  });
});

describe("refreshAllRates", () => {
  beforeEach(() => {
    for (const key of Object.keys(cachedRows)) delete cachedRows[key];
    upsertShouldFail = false;
    upsertCalls = [];
    mockProviderImpl = async () => [
      { currencyCode: "ZAR", usdRate: 18.5, fetchedAt: NOW.toISOString(), source: "mock-provider" },
    ];
  });

  it("upserts every rate the provider returns", async () => {
    const rates = await refreshAllRates(NOW);
    expect(rates).toHaveLength(1);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0][0]).toMatchObject({ currency_code: "ZAR", usd_rate: 18.5 });
  });

  it("throws a clear error when the DB write fails", async () => {
    upsertShouldFail = true;
    await expect(refreshAllRates(NOW)).rejects.toThrow(/Failed to persist exchange rates/);
  });
});
