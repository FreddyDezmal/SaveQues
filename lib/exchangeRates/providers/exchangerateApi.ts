/**
 * lib/exchangeRates/providers/exchangerateApi.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 31 — Phase 6. Real adapter, plain fetch — same shape as
 * lib/email/providers/postmark.ts: a pure buildXRequest() (unit-testable
 * without network) plus a createXProvider(config) factory.
 *
 * Provider: exchangerate-api.com's v6 "latest" endpoint. Chosen for the
 * free tier (1,500 requests/month, no card required) — this app only
 * needs ~1 request/day via the Phase 6 cron, so free-tier limits are not
 * a practical constraint. GET
 * https://v6.exchangerate-api.com/v6/{API_KEY}/latest/USD returns every
 * supported currency priced against USD in one response — exactly the
 * "one call covers all 116 currencies" shape ExchangeRateProvider expects.
 *
 * INACTIVE BY DEFAULT — selectExchangeRateProvider() (index.ts) only
 * returns this when EXCHANGE_RATE_PROVIDER=exchangerate_api AND
 * EXCHANGE_RATE_API_KEY are both set; otherwise identity.ts is used.
 */
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import type { ExchangeRate, ExchangeRateProvider } from "../types";
import { createLogger } from "@/lib/logger";

const log = createLogger("exchange-rates.exchangerate-api");

export interface ExchangeRateApiRequest {
  url: string;
}

export function buildExchangeRateApiRequest(apiKey: string): ExchangeRateApiRequest {
  return { url: `https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD` };
}

interface ExchangeRateApiResponse {
  result: "success" | "error";
  "error-type"?: string;
  time_last_update_utc?: string;
  conversion_rates?: Record<string, number>;
}

export function createExchangeRateApiProvider(config: { apiKey: string }): ExchangeRateProvider {
  return {
    name: "exchangerate_api",

    async getRates(): Promise<ExchangeRate[]> {
      const req = buildExchangeRateApiRequest(config.apiKey);
      const res = await fetch(req.url);
      const data = (await res.json().catch(() => ({}))) as ExchangeRateApiResponse;

      if (!res.ok || data.result !== "success" || !data.conversion_rates) {
        throw new Error(`exchangerate_api request failed: ${data["error-type"] ?? res.status}`);
      }

      const fetchedAt = new Date().toISOString();
      const rates: ExchangeRate[] = [];
      const missing: string[] = [];

      // Only return rates for currencies this app actually supports
      // (lib/currency.ts's SUPPORTED_CURRENCIES is the single source of
      // truth — never let a provider silently introduce a currency the
      // rest of the app doesn't know about, or a stale/absent one pass
      // through unnoticed).
      for (const { code } of SUPPORTED_CURRENCIES) {
        const rate = data.conversion_rates[code];
        if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
          missing.push(code);
          continue;
        }
        rates.push({ currencyCode: code, usdRate: rate, fetchedAt, source: "exchangerate_api" });
      }

      if (missing.length > 0) {
        // Not fatal — most of these gaps are for currencies the free API
        // simply doesn't price (e.g. some CFA franc zone or Pacific island
        // currencies). The cache layer keeps whatever rate it already has
        // cached for a currency this fetch didn't return, rather than
        // wiping it out. Logged so a real, unexpected gap doesn't go
        // unnoticed for months.
        log.warn("exchangerate_api response is missing rates for some supported currencies", {
          missing_count: missing.length,
          missing_codes: missing.join(","),
        });
      }

      return rates;
    },
  };
}
