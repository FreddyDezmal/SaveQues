// ── Global-ready currency formatting ──────────────────────────
// All monetary values are stored as plain numbers in the database.
// Currency is a display concern only. This module handles all formatting.

export interface CurrencyConfig {
  code: string;
  locale: string;
  label: string;
  country: string;
}

export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  { code: "ZAR", locale: "en-ZA", country: "ZA", label: "South African Rand (R)" },
  { code: "USD", locale: "en-US", country: "US", label: "US Dollar ($)" },
  { code: "GBP", locale: "en-GB", country: "GB", label: "British Pound (£)" },
  { code: "EUR", locale: "de-DE", country: "DE", label: "Euro (€)" },
  { code: "KES", locale: "sw-KE", country: "KE", label: "Kenyan Shilling (KSh)" },
  { code: "NGN", locale: "en-NG", country: "NG", label: "Nigerian Naira (₦)" },
  { code: "GHS", locale: "en-GH", country: "GH", label: "Ghanaian Cedi (₵)" },
  { code: "AUD", locale: "en-AU", country: "AU", label: "Australian Dollar (A$)" },
  { code: "CAD", locale: "en-CA", country: "CA", label: "Canadian Dollar (C$)" },
  { code: "INR", locale: "en-IN", country: "IN", label: "Indian Rupee (₹)" },
];

export const DEFAULT_CURRENCY = "ZAR";
export const DEFAULT_LOCALE   = "en-ZA";

/**
 * Format a number as a currency string using the user's locale.
 * Falls back to ZAR / en-ZA if anything is missing.
 *
 * Examples:
 *   formatAmount(5000, "ZAR", "en-ZA") → "R 5 000"
 *   formatAmount(5000, "USD", "en-US") → "$5,000"
 *   formatAmount(5000, "GBP", "en-GB") → "£5,000"
 *   formatAmount(5000, "EUR", "de-DE") → "5.000 €"
 */
export function formatAmount(
  amount: number,
  currencyCode = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Fallback if locale/currency combo is unsupported in the runtime
    return `${currencyCode} ${amount.toLocaleString()}`;
  }
}

/**
 * Compact formatting for small spaces — e.g. "R5K" instead of "R 5 000".
 * Used in tight UI contexts like stat cards and progress bars.
 */
export function formatAmountCompact(
  amount: number,
  currencyCode = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return formatAmount(amount, currencyCode, locale);
  }
}

/**
 * Get a currency config by code. Falls back to ZAR.
 */
export function getCurrencyConfig(code: string): CurrencyConfig {
  return (
    SUPPORTED_CURRENCIES.find(c => c.code === code) ??
    SUPPORTED_CURRENCIES[0]
  );
}

/**
 * Weekly savings suggestion.
 * Given a remaining amount and weeks remaining, returns the weekly target.
 * Used in goal creation and goal detail screens.
 */
export function weeklyTarget(
  remainingAmount: number,
  weeksRemaining: number
): number {
  if (weeksRemaining <= 0) return remainingAmount;
  return Math.ceil(remainingAmount / weeksRemaining);
}