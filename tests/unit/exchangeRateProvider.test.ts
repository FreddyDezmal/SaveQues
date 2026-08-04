/**
 * tests/unit/exchangeRateProvider.test.ts
 * Sprint 31 — Phase 6 (Exchange Rate Infrastructure).
 *
 * Same testing boundary as tests/unit/pushProvider.test.ts /
 * emailProvider.test.ts: pure request-building and selection logic get
 * unit tests; the actual fetch() call inside exchangerateApi.ts's
 * getRates() doesn't (no network access in this test environment, and no
 * point re-testing that fetch() works). lib/exchangeRates/cache.ts's DB
 * read/write paths aren't covered here either — they need a Supabase
 * client, which is exactly what Phase 7's conversion-engine test suite
 * should set up properly rather than half-mocking here.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { buildExchangeRateApiRequest } from "@/lib/exchangeRates/providers/exchangerateApi";
import { identityProvider } from "@/lib/exchangeRates/providers/identity";
import { selectExchangeRateProvider } from "@/lib/exchangeRates";

describe("buildExchangeRateApiRequest", () => {
  it("builds a GET-by-URL request against USD as the base currency", () => {
    const req = buildExchangeRateApiRequest("test_key_123");
    expect(req.url).toBe("https://v6.exchangerate-api.com/v6/test_key_123/latest/USD");
  });
});

describe("identityProvider", () => {
  it("returns a rate of exactly 1 for every supported currency", async () => {
    const rates = await identityProvider.getRates();
    expect(rates).toHaveLength(SUPPORTED_CURRENCIES.length);
    for (const r of rates) {
      expect(r.usdRate).toBe(1);
      expect(r.source).toBe("identity");
    }
  });

  it("covers every currency code in SUPPORTED_CURRENCIES, with none missing or extra", async () => {
    const rates = await identityProvider.getRates();
    const returnedCodes = new Set(rates.map((r) => r.currencyCode));
    const expectedCodes = new Set(SUPPORTED_CURRENCIES.map((c) => c.code));
    expect(returnedCodes).toEqual(expectedCodes);
  });
});

describe("selectExchangeRateProvider", () => {
  it("defaults to identity when EXCHANGE_RATE_PROVIDER is unset — the honest default, not silent failure", () => {
    expect(selectExchangeRateProvider({}).name).toBe("identity");
  });

  it("stays on identity when EXCHANGE_RATE_PROVIDER is explicitly 'identity'", () => {
    expect(selectExchangeRateProvider({ EXCHANGE_RATE_PROVIDER: "identity" }).name).toBe("identity");
  });

  it("falls back to identity when exchangerate_api is chosen but EXCHANGE_RATE_API_KEY is missing", () => {
    expect(selectExchangeRateProvider({ EXCHANGE_RATE_PROVIDER: "exchangerate_api" }).name).toBe("identity");
  });

  it("selects exchangerate_api once an API key is configured", () => {
    expect(
      selectExchangeRateProvider({ EXCHANGE_RATE_PROVIDER: "exchangerate_api", EXCHANGE_RATE_API_KEY: "k" }).name
    ).toBe("exchangerate_api");
  });

  it("falls back to identity for an unrecognized EXCHANGE_RATE_PROVIDER value", () => {
    expect(selectExchangeRateProvider({ EXCHANGE_RATE_PROVIDER: "carrier_pigeon" }).name).toBe("identity");
  });
});
