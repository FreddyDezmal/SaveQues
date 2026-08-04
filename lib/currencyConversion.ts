/**
 * lib/currencyConversion.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 31 — Phase 7: Currency Conversion Engine.
 *
 * Same pure-function-vs-I/O split as lib/financialHealthScore.ts (pure) vs
 * lib/financialHealthSnapshot.ts (I/O), and lib/digest.ts vs
 * lib/notifications.ts:
 *
 *   convertAmount()   — pure, deterministic, decimal-safe. No I/O, no
 *                        Date.now(), no randomness. Same inputs always
 *                        produce the exact same output. Fully unit-testable
 *                        with hand-constructed ExchangeRate objects, no DB
 *                        or network required.
 *
 *   convertCurrency()  /
 *   convertAmountsTo() — thin async wrappers that fetch rates via
 *                        lib/exchangeRates/cache.ts's getCachedRates()
 *                        (batched — see Phase 13's perf audit note below)
 *                        and hand them to convertAmount(). This is the
 *                        ONLY place in the app allowed to call
 *                        getCachedRates for conversion purposes — per
 *                        the Phase 7 brief, "No UI should perform
 *                        conversions. No business logic should perform
 *                        conversions." Every caller that needs a
 *                        converted amount goes through this file, not
 *                        lib/exchangeRates directly.
 *
 * SPRINT 31 — PHASE 13 (Performance Audit): convertCurrency(),
 * createZarConverter(), and convertAmountsTo() each used to fetch their
 * (2 or N) needed currencies via separate parallel getCachedRate() calls
 * — correct, but N separate DB round-trips. All three now call
 * lib/exchangeRates/cache.ts's getCachedRates() once with every currency
 * they need, so N currencies means 1 query, not N.

 *
 * DECIMAL SAFETY
 *   This app stores and displays money as plain JS numbers throughout (no
 *   fixed-point/decimal library in package.json, no cents-as-integer
 *   convention anywhere in the schema) — matching that existing
 *   convention rather than introducing a new one for this module alone.
 *   "Decimal-safe" here means: every result is rounded exactly once, at
 *   the end of the conversion, to the TARGET currency's real ISO-4217
 *   minor-unit count (lib/currency.ts's `decimals` field, added Phase 5 —
 *   0 for JPY, 3 for BHD, 2 for most others), using an epsilon-corrected
 *   rounding helper that avoids the classic `Math.round(1.005 * 100)`
 *   floating-point misround. It does NOT mean arbitrary-precision
 *   arithmetic — if this engine is ever used for a context where
 *   sub-cent precision is legally significant (e.g. billing), that would
 *   need a real fixed-point library, which is intentionally called out
 *   here as future work rather than silently assumed to already be safe
 *   enough for that.
 *
 * NOT IN SCOPE FOR PHASE 7
 *   No UI component or business-logic module is wired up to call this
 *   engine yet — that happens per-consumer (Phase 9's social/leaderboard
 *   comparisons is the first real one). This phase is the engine itself,
 *   thoroughly tested in isolation, same as Phase 6 shipped inert until
 *   this phase existed to consume it.
 */

import { getCurrencyConfig } from "@/lib/currency";
import { getCachedRates } from "@/lib/exchangeRates/cache";
import type { ExchangeRate } from "@/lib/exchangeRates/types";

export interface ConvertedAmount {
  /** The converted amount, rounded to toCurrency's real decimal precision. */
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  /** Effective fromCurrency → toCurrency rate used for this conversion
   *  (1 unit of fromCurrency = this many units of toCurrency). */
  rate: number;
  /** When the rate(s) behind this conversion were fetched. When the two
   *  currencies' rates were fetched at different times, this is the OLDER
   *  of the two — the more conservative (more likely to already be
   *  flagged stale by a caller checking it) of the two timestamps. */
  asOf: string;
}

/**
 * Epsilon-corrected rounding to a fixed number of decimal places. Plain
 * `Math.round(value * factor) / factor` misrounds some values (e.g.
 * 1.005 * 100 is actually 100.49999999999999 in IEEE 754 double
 * precision, so Math.round alone gives 100, not 101) — adding
 * Number.EPSILON before rounding corrects for that without needing a
 * decimal library.
 */
export function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON * Math.sign(value || 1)) * factor) / factor;
}

/**
 * Pure conversion math. Rates are priced against USD (see
 * lib/exchangeRates/types.ts) — converting A → B goes through USD as a
 * pivot: amountInUsd = amount / rate(A); result = amountInUsd * rate(B).
 * Never mutates fromRate/toRate.
 */
export function convertAmount(amount: number, fromRate: ExchangeRate, toRate: ExchangeRate): ConvertedAmount {
  const toDecimals = getCurrencyConfig(toRate.currencyCode).decimals;

  if (fromRate.currencyCode === toRate.currencyCode) {
    return {
      amount: roundToDecimals(amount, toDecimals),
      fromCurrency: fromRate.currencyCode,
      toCurrency: toRate.currencyCode,
      rate: 1,
      asOf: fromRate.fetchedAt,
    };
  }

  const amountInUsd = amount / fromRate.usdRate;
  const converted = amountInUsd * toRate.usdRate;
  const rate = toRate.usdRate / fromRate.usdRate;
  const asOf = fromRate.fetchedAt < toRate.fetchedAt ? fromRate.fetchedAt : toRate.fetchedAt;

  return {
    amount: roundToDecimals(converted, toDecimals),
    fromCurrency: fromRate.currencyCode,
    toCurrency: toRate.currencyCode,
    rate,
    asOf,
  };
}

/**
 * Async wrapper: fetches both currencies' cached rates and converts.
 * Skips the rate fetch entirely when fromCode === toCode (common case —
 * most users never trigger a real cross-currency conversion) rather than
 * doing two cache reads to reach the same trivially-known answer.
 */
export async function convertCurrency(
  amount: number,
  fromCode: string,
  toCode: string,
  now: Date = new Date()
): Promise<ConvertedAmount> {
  if (fromCode === toCode) {
    const decimals = getCurrencyConfig(toCode).decimals;
    return { amount: roundToDecimals(amount, decimals), fromCurrency: fromCode, toCurrency: toCode, rate: 1, asOf: now.toISOString() };
  }

  const rates = await getCachedRates([fromCode, toCode], now);
  return convertAmount(amount, rates.get(fromCode)!, rates.get(toCode)!);
}

/**
 * Resolves the ZAR → toCode rate once, then returns a plain synchronous
 * function for converting any ZAR-denominated amount into that currency.
 *
 * Built specifically for lib/recommendations.ts's Phase 8 fix (see that
 * file's docstring): a downstream module that must stay pure/synchronous
 * (getFinancialIntelligence's documented contract) still needs to convert
 * some ZAR-authored constants into the user's real currency. Doing the
 * one async rate lookup here, up front, and handing the caller a plain
 * closure keeps that downstream module's "no I/O" contract intact while
 * still routing every actual conversion through this engine — never an
 * ad-hoc multiply at the call site.
 */
export async function createZarConverter(toCode: string, now: Date = new Date()): Promise<(zarAmount: number) => number> {
  if (toCode === "ZAR") return (zarAmount: number) => zarAmount;

  const rates = await getCachedRates(["ZAR", toCode], now);
  const zarRate = rates.get("ZAR")!;
  const toRate = rates.get(toCode)!;
  return (zarAmount: number) => convertAmount(zarAmount, zarRate, toRate).amount;
}

/**
 * Resolves rates for several currencies in ONE batched cache read,
 * without doing any conversion math itself. For callers that need to run
 * their OWN local summing/grouping logic (e.g. app/api/shared-goals/detail/route.ts
 * summing several distinct per-currency groups per member) but still
 * must not touch lib/exchangeRates/cache.ts directly — this keeps that
 * "only this file calls the exchange-rate cache" boundary intact while
 * avoiding forcing every caller's data into convertAmountsTo's flat
 * {amount, currencyCode}[] shape.
 */
export async function resolveRates(currencyCodes: string[], now: Date = new Date()): Promise<Map<string, ExchangeRate>> {
  return getCachedRates(currencyCodes, now);
}

/**
 * Batch conversion: converts many (amount, currencyCode) pairs to one
 * target currency, fetching each DISTINCT source currency's rate exactly
 * once — not once per item. Built for exactly the shape Phase 9's
 * mixed-currency leaderboards/groups will need (many users, few distinct
 * currencies among them), so that feature doesn't end up calling
 * convertCurrency() in a loop and re-fetching the same rate repeatedly.
 */
export async function convertAmountsTo(
  items: { amount: number; currencyCode: string }[],
  toCode: string,
  now: Date = new Date()
): Promise<(ConvertedAmount & { originalAmount: number })[]> {
  const allCodes = Array.from(new Set([toCode, ...items.map((i) => i.currencyCode)]));
  const rates = await getCachedRates(allCodes, now);
  const toRate = rates.get(toCode)!;

  return items.map((item) => {
    const fromRate = rates.get(item.currencyCode)!;
    return { ...convertAmount(item.amount, fromRate, toRate), originalAmount: item.amount };
  });
}
