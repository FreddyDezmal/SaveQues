/**
 * lib/exchangeRates/types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 31 — Phase 6: Exchange Rate Infrastructure.
 *
 * Pure types only — zero I/O, same convention as lib/billing/types.ts and
 * lib/push/types.ts. Rates are stored relative to a single pivot currency
 * (USD) rather than as one row per currency PAIR: with 116 supported
 * currencies, a pivot design needs 116 rows total, while a pairwise design
 * would need up to 116 × 115 rows for full coverage. Converting any A → B
 * is then just going through the pivot: amountInUsd = amount / rate(A);
 * result = amountInUsd * rate(B). See lib/exchangeRates/cache.ts and the
 * (Phase 7) conversion engine for where that math actually happens — this
 * file only describes the data shape.
 */

export interface ExchangeRate {
  /** ISO 4217 code, e.g. "ZAR". Always one of lib/currency.ts's
   *  SUPPORTED_CURRENCIES — enforced by the exchange_rates table's CHECK
   *  constraint (migration 071), same pattern as profiles.currency_code. */
  currencyCode: string;
  /** Units of this currency per 1 USD. USD itself always has usdRate = 1. */
  usdRate: number;
  /** When this rate was fetched from the provider (not when it was read
   *  from cache — see lib/exchangeRates/cache.ts for that distinction). */
  fetchedAt: string;
  /** Provider name this rate came from, e.g. "exchangerate_api" — kept per
   *  row (not just logged) so a stale/wrong rate can be traced back to its
   *  source during an incident, without needing to correlate against logs
   *  that may have already rotated out. */
  source: string;
}

export interface ExchangeRateProvider {
  /** Short identifier for logging and for the `source` field above —
   *  "exchangerate_api", "identity", etc. */
  readonly name: string;

  /**
   * Fetches fresh rates for every supported currency, priced against USD,
   * in one call. Most providers (including the one this sprint integrates)
   * price a "get all rates for this base currency" call identically to a
   * single-pair call, so this avoids 116 separate requests.
   *
   * Throws on failure — callers (lib/exchangeRates/cache.ts) decide
   * fallback behavior (serve a stale cached value, etc.). A provider must
   * never return a partial or fabricated rate set silently.
   */
  getRates(): Promise<ExchangeRate[]>;
}
