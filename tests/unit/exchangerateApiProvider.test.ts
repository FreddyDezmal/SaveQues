/**
 * tests/unit/exchangerateApiProvider.test.ts
 * Sprint 31 — Phase 15 (Testing): closes the coverage gap on
 * lib/exchangeRates/providers/exchangerateApi.ts's getRates() — the
 * actual fetch/parse/filter logic was untested (only
 * buildExchangeRateApiRequest's URL-building was covered, in
 * tests/unit/exchangeRateProvider.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { createExchangeRateApiProvider } from "@/lib/exchangeRates/providers/exchangerateApi";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
    })
  );
}

describe("createExchangeRateApiProvider().getRates()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a rate for every currency present with a valid positive number", async () => {
    mockFetchOnce({
      result: "success",
      conversion_rates: { ZAR: 18.5, EUR: 0.92, USD: 1, JPY: 155.2, BHD: 0.376 },
    });
    const provider = createExchangeRateApiProvider({ apiKey: "test_key" });
    const rates = await provider.getRates();

    const zar = rates.find((r) => r.currencyCode === "ZAR");
    expect(zar?.usdRate).toBe(18.5);
    expect(zar?.source).toBe("exchangerate_api");
    // Every returned rate is a currency this app actually supports.
    expect(rates.every((r) => typeof r.currencyCode === "string" && r.currencyCode.length === 3)).toBe(true);
  });

  it("excludes currencies missing from the response, without throwing", async () => {
    // Only 3 of the 116 supported currencies present — realistic for a
    // free-tier response that doesn't price everything.
    mockFetchOnce({ result: "success", conversion_rates: { ZAR: 18.5, USD: 1, EUR: 0.92 } });
    const provider = createExchangeRateApiProvider({ apiKey: "test_key" });
    const rates = await provider.getRates();

    expect(rates).toHaveLength(3);
    expect(rates.map((r) => r.currencyCode).sort()).toEqual(["EUR", "USD", "ZAR"]);
  });

  it("excludes a currency with a zero or negative rate as if it were missing", async () => {
    mockFetchOnce({ result: "success", conversion_rates: { ZAR: 18.5, USD: 0, EUR: -0.92 } });
    const provider = createExchangeRateApiProvider({ apiKey: "test_key" });
    const rates = await provider.getRates();

    expect(rates.map((r) => r.currencyCode)).toEqual(["ZAR"]);
  });

  it("excludes a currency with a non-numeric rate as if it were missing", async () => {
    mockFetchOnce({ result: "success", conversion_rates: { ZAR: 18.5, USD: "not-a-number" as any } });
    const provider = createExchangeRateApiProvider({ apiKey: "test_key" });
    const rates = await provider.getRates();

    expect(rates.map((r) => r.currencyCode)).toEqual(["ZAR"]);
  });

  it("throws when the HTTP response is not ok", async () => {
    mockFetchOnce({ result: "error", "error-type": "invalid-key" }, false, 401);
    const provider = createExchangeRateApiProvider({ apiKey: "bad_key" });
    await expect(provider.getRates()).rejects.toThrow(/invalid-key/);
  });

  it("throws when the API reports result: 'error' even with HTTP 200", async () => {
    mockFetchOnce({ result: "error", "error-type": "quota-reached" });
    const provider = createExchangeRateApiProvider({ apiKey: "test_key" });
    await expect(provider.getRates()).rejects.toThrow(/quota-reached/);
  });

  it("throws when the response has no conversion_rates at all", async () => {
    mockFetchOnce({ result: "success" });
    const provider = createExchangeRateApiProvider({ apiKey: "test_key" });
    await expect(provider.getRates()).rejects.toThrow();
  });

  it("throws (rather than crashing) when the response body isn't valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("Unexpected token")),
      })
    );
    const provider = createExchangeRateApiProvider({ apiKey: "test_key" });
    await expect(provider.getRates()).rejects.toThrow();
  });

  it("stamps every rate with the same fetchedAt timestamp from one call", async () => {
    mockFetchOnce({ result: "success", conversion_rates: { ZAR: 18.5, EUR: 0.92 } });
    const provider = createExchangeRateApiProvider({ apiKey: "test_key" });
    const rates = await provider.getRates();
    expect(rates[0].fetchedAt).toBe(rates[1].fetchedAt);
  });
});
