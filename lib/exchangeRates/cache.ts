/**
 * lib/exchangeRates/cache.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 31 — Phase 6. I/O layer for exchange rates — same split as
 * lib/financialHealthSnapshot.ts (pure function vs. persistence): the
 * ExchangeRateProvider implementations are the pure "fetch from a vendor"
 * layer, this file is where those results actually get read from and
 * written to the database.
 *
 * CACHE LIFETIME: 24 hours. A savings app has no need for intraday FX
 * precision, and daily granularity keeps this app well inside every
 * provider's free-tier request limits (one cron run per day, not one
 * request per page view). Documented here as the single source of truth
 * for that number — refreshAllRates()'s cron and getCachedRate()'s
 * staleness check both read from CACHE_TTL_MS below rather than each
 * hardcoding "24 hours" separately.
 *
 * FALLBACK ORDER on a cache read (getCachedRate):
 *   1. A cached row younger than CACHE_TTL_MS  → use it, no network call.
 *   2. No fresh row (missing, or older than TTL) → call the live provider.
 *   3. Live provider call fails AND a stale row exists → serve the stale
 *      row anyway (with a logged warning noting its age), rather than
 *      failing the caller entirely. A day-old rate is still far more
 *      useful than refusing to convert at all.
 *   4. Live provider call fails AND there is no cached row at all (e.g.
 *      first deploy before the cron has ever run) → throw. There is
 *      nothing honest to return at that point; the (Phase 7) conversion
 *      engine must not guess.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { getExchangeRateProvider } from "./index";
import type { ExchangeRate } from "./types";
import { createLogger } from "@/lib/logger";

const log = createLogger("exchange-rates.cache");

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — see file header

interface ExchangeRateRow {
  currency_code: string;
  usd_rate: number;
  fetched_at: string;
  source: string;
}

function rowToRate(row: ExchangeRateRow): ExchangeRate {
  return { currencyCode: row.currency_code, usdRate: row.usd_rate, fetchedAt: row.fetched_at, source: row.source };
}

function isFresh(fetchedAt: string, now: Date): boolean {
  return now.getTime() - new Date(fetchedAt).getTime() < CACHE_TTL_MS;
}

/**
 * Reads MULTIPLE currencies' cached rates in ONE query (`.in(...)`)
 * instead of one query per currency. This is the function that actually
 * touches the database — getCachedRate() below is a thin single-currency
 * wrapper around this, not a separate code path, so there is exactly one
 * place the fallback order in this file's header is implemented.
 *
 * SPRINT 31 — PHASE 13 (Performance Audit): before this phase,
 * createZarConverter() and convertAmountsTo() each called getCachedRate()
 * once per distinct currency in a Promise.all — correct, but N separate
 * DB round-trips for N currencies. A shared goal with 5 contributor
 * currencies meant 5 queries where 1 suffices. Every multi-currency
 * caller in lib/currencyConversion.ts now goes through this instead.
 */
export async function getCachedRates(currencyCodes: string[], now: Date = new Date()): Promise<Map<string, ExchangeRate>> {
  const uniqueCodes = Array.from(new Set(currencyCodes));
  if (uniqueCodes.length === 0) return new Map();

  const supabase = createServiceClient();
  const { data: rows } = await supabase
    .from("exchange_rates")
    .select("currency_code, usd_rate, fetched_at, source")
    .in("currency_code", uniqueCodes);

  const byCode = new Map((rows ?? []).map((r) => [r.currency_code, r as ExchangeRateRow]));
  const result = new Map<string, ExchangeRate>();
  const staleCodes: string[] = [];

  for (const code of uniqueCodes) {
    const row = byCode.get(code);
    if (row && isFresh(row.fetched_at, now)) {
      result.set(code, rowToRate(row));
    } else {
      staleCodes.push(code);
    }
  }

  if (staleCodes.length === 0) return result;

  try {
    // One refresh call covers every stale/missing currency at once — the
    // provider always returns all currencies (see ExchangeRateProvider's
    // file header), so it doesn't matter whether 1 or all 116 codes were
    // stale, this is still a single call.
    const refreshed = await refreshAllRates(now);
    const refreshedByCode = new Map(refreshed.map((r) => [r.currencyCode, r]));

    for (const code of staleCodes) {
      const fresh = refreshedByCode.get(code);
      if (fresh) {
        result.set(code, fresh);
        continue;
      }
      const staleRow = byCode.get(code);
      if (staleRow) {
        log.warn("Provider refresh didn't include this currency — serving stale cached rate", {
          currency_code: code,
          age_ms: now.getTime() - new Date(staleRow.fetched_at).getTime(),
        });
        result.set(code, rowToRate(staleRow));
      } else {
        log.error("Provider refresh didn't include this currency and no cached rate exists", { currency_code: code });
        throw new Error(`No exchange rate available for ${code}`);
      }
    }
  } catch (err) {
    // Live refresh itself failed (network error, provider down, etc.) —
    // fall back to whatever stale rows we have, throw only for codes
    // with no cached row at all.
    for (const code of staleCodes) {
      if (result.has(code)) continue;
      const staleRow = byCode.get(code);
      if (staleRow) {
        log.warn("Live rate refresh failed — serving stale cached rate", {
          currency_code: code,
          age_ms: now.getTime() - new Date(staleRow.fetched_at).getTime(),
          error: err instanceof Error ? err.message : String(err),
        });
        result.set(code, rowToRate(staleRow));
      } else {
        log.error("Live rate refresh failed and no cached rate exists", {
          currency_code: code,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }
  }

  return result;
}

/**
 * Single-currency convenience wrapper around getCachedRates(). Kept as
 * its own function (rather than making every existing caller pass a
 * 1-element array) since "give me this one rate" is still the most
 * common call shape in this codebase.
 */
export async function getCachedRate(currencyCode: string, now: Date = new Date()): Promise<ExchangeRate> {
  const rates = await getCachedRates([currencyCode], now);
  const rate = rates.get(currencyCode);
  if (!rate) throw new Error(`No exchange rate available for ${currencyCode}`);
  return rate;
}

/**
 * Fetches fresh rates for every supported currency from the configured
 * provider and upserts them all. Called by both the daily cron (proactive
 * warm) and getCachedRate() on a miss (reactive warm) — same function
 * either way, so there is exactly one code path that writes this table.
 */
export async function refreshAllRates(now: Date = new Date()): Promise<ExchangeRate[]> {
  const provider = getExchangeRateProvider();
  const rates = await provider.getRates();

  const supabase = createServiceClient();
  const rows: ExchangeRateRow[] = rates.map((r) => ({
    currency_code: r.currencyCode,
    usd_rate: r.usdRate,
    fetched_at: r.fetchedAt,
    source: r.source,
  }));

  const { error } = await supabase.from("exchange_rates").upsert(rows, { onConflict: "currency_code" });
  if (error) {
    log.error("Failed to write refreshed rates", { action: "upsert_exchange_rates", error: error.message, provider: provider.name });
    throw new Error(`Failed to persist exchange rates: ${error.message}`);
  }

  log.info("Refreshed exchange rates", { provider: provider.name, count: rows.length, run_at: now.toISOString() });
  return rates;
}
