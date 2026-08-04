// ── Global-ready currency formatting ──────────────────────────
// All monetary values are stored as plain numbers in the database.
// Currency is a display concern only. This module handles all formatting.

export interface CurrencyConfig {
  code: string;
  locale: string;
  label: string;
  country: string;
  /**
   * ISO-4217 minor unit count for this currency (e.g. 2 for USD/ZAR/EUR,
   * 0 for JPY/KRW, 3 for BHD/KWD/OMR). NOT used by default in formatAmount —
   * default display across the app intentionally shows whole units with no
   * decimals for every currency (a deliberate product choice, not a bug).
   * This field exists so callers that need precise/exact amounts (e.g. a
   * future ledger export) can opt in via formatAmount's `precise` option
   * instead of each call site re-deriving the correct decimal count itself.
   */
  decimals: number;
}

// AUDIT NOTE: profiles.currency_code has a DB CHECK constraint
// (profiles_currency_code_check, migration 025) that must exactly mirror
// the `code` values below. Adding/removing a currency here requires a
// matching migration — see 043_expand_currency_codes.sql for the
// migration that brought this list from 10 to its current size, which is
// the pattern to follow for any future changes.
export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  // ── Africa ──────────────────────────────────────────────────
  { code: "ZAR", locale: "en-ZA", country: "ZA", label: "South African Rand (R)", decimals: 2 },
  { code: "NGN", locale: "en-NG", country: "NG", label: "Nigerian Naira (₦)", decimals: 2 },
  { code: "GHS", locale: "en-GH", country: "GH", label: "Ghanaian Cedi (₵)", decimals: 2 },
  { code: "KES", locale: "sw-KE", country: "KE", label: "Kenyan Shilling (KSh)", decimals: 2 },
  { code: "EGP", locale: "ar-EG", country: "EG", label: "Egyptian Pound (E£)", decimals: 2 },
  { code: "MAD", locale: "ar-MA", country: "MA", label: "Moroccan Dirham (MAD)", decimals: 2 },
  { code: "DZD", locale: "ar-DZ", country: "DZ", label: "Algerian Dinar (DZD)", decimals: 2 },
  { code: "TND", locale: "ar-TN", country: "TN", label: "Tunisian Dinar (TND)", decimals: 3 },
  { code: "ETB", locale: "en-ET", country: "ET", label: "Ethiopian Birr (Br)", decimals: 2 },
  { code: "UGX", locale: "en-UG", country: "UG", label: "Ugandan Shilling (USh)", decimals: 0 },
  { code: "TZS", locale: "sw-TZ", country: "TZ", label: "Tanzanian Shilling (TSh)", decimals: 2 },
  { code: "RWF", locale: "en-RW", country: "RW", label: "Rwandan Franc (RF)", decimals: 0 },
  { code: "ZMW", locale: "en-ZM", country: "ZM", label: "Zambian Kwacha (ZK)", decimals: 2 },
  { code: "BWP", locale: "en-BW", country: "BW", label: "Botswana Pula (P)", decimals: 2 },
  { code: "MUR", locale: "en-MU", country: "MU", label: "Mauritian Rupee (₨)", decimals: 2 },
  { code: "XOF", locale: "fr-SN", country: "SN", label: "West African CFA Franc (CFA)", decimals: 0 },
  { code: "XAF", locale: "fr-CM", country: "CM", label: "Central African CFA Franc (FCFA)", decimals: 0 },
  { code: "MZN", locale: "pt-MZ", country: "MZ", label: "Mozambican Metical (MT)", decimals: 2 },
  { code: "AOA", locale: "pt-AO", country: "AO", label: "Angolan Kwanza (Kz)", decimals: 2 },
  { code: "NAD", locale: "en-NA", country: "NA", label: "Namibian Dollar (N$)", decimals: 2 },
  { code: "SZL", locale: "en-SZ", country: "SZ", label: "Eswatini Lilangeni (L)", decimals: 2 },
  { code: "LSL", locale: "en-LS", country: "LS", label: "Lesotho Loti (L)", decimals: 2 },
  { code: "MWK", locale: "en-MW", country: "MW", label: "Malawian Kwacha (MK)", decimals: 2 },
  { code: "SDG", locale: "ar-SD", country: "SD", label: "Sudanese Pound (SDG)", decimals: 2 },
  { code: "LYD", locale: "ar-LY", country: "LY", label: "Libyan Dinar (LD)", decimals: 3 },
  { code: "CDF", locale: "fr-CD", country: "CD", label: "Congolese Franc (FC)", decimals: 2 },
  { code: "SOS", locale: "so-SO", country: "SO", label: "Somali Shilling (Sh)", decimals: 2 },

  // ── Middle East ─────────────────────────────────────────────
  { code: "AED", locale: "ar-AE", country: "AE", label: "UAE Dirham (AED)", decimals: 2 },
  { code: "SAR", locale: "ar-SA", country: "SA", label: "Saudi Riyal (SAR)", decimals: 2 },
  { code: "QAR", locale: "ar-QA", country: "QA", label: "Qatari Riyal (QAR)", decimals: 2 },
  { code: "KWD", locale: "ar-KW", country: "KW", label: "Kuwaiti Dinar (KWD)", decimals: 3 },
  { code: "BHD", locale: "ar-BH", country: "BH", label: "Bahraini Dinar (BHD)", decimals: 3 },
  { code: "OMR", locale: "ar-OM", country: "OM", label: "Omani Rial (OMR)", decimals: 3 },
  { code: "ILS", locale: "he-IL", country: "IL", label: "Israeli New Shekel (₪)", decimals: 2 },
  { code: "JOD", locale: "ar-JO", country: "JO", label: "Jordanian Dinar (JOD)", decimals: 3 },
  { code: "LBP", locale: "ar-LB", country: "LB", label: "Lebanese Pound (L£)", decimals: 2 },
  { code: "IQD", locale: "ar-IQ", country: "IQ", label: "Iraqi Dinar (IQD)", decimals: 3 },
  { code: "TRY", locale: "tr-TR", country: "TR", label: "Turkish Lira (₺)", decimals: 2 },

  // ── Asia ────────────────────────────────────────────────────
  { code: "INR", locale: "en-IN", country: "IN", label: "Indian Rupee (₹)", decimals: 2 },
  { code: "PKR", locale: "ur-PK", country: "PK", label: "Pakistani Rupee (₨)", decimals: 2 },
  { code: "BDT", locale: "bn-BD", country: "BD", label: "Bangladeshi Taka (৳)", decimals: 2 },
  { code: "LKR", locale: "si-LK", country: "LK", label: "Sri Lankan Rupee (₨)", decimals: 2 },
  { code: "NPR", locale: "ne-NP", country: "NP", label: "Nepalese Rupee (₨)", decimals: 2 },
  { code: "CNY", locale: "zh-CN", country: "CN", label: "Chinese Yuan (¥)", decimals: 2 },
  { code: "JPY", locale: "ja-JP", country: "JP", label: "Japanese Yen (¥)", decimals: 0 },
  { code: "KRW", locale: "ko-KR", country: "KR", label: "South Korean Won (₩)", decimals: 0 },
  { code: "HKD", locale: "zh-HK", country: "HK", label: "Hong Kong Dollar (HK$)", decimals: 2 },
  { code: "TWD", locale: "zh-TW", country: "TW", label: "New Taiwan Dollar (NT$)", decimals: 2 },
  { code: "SGD", locale: "en-SG", country: "SG", label: "Singapore Dollar (S$)", decimals: 2 },
  { code: "MYR", locale: "ms-MY", country: "MY", label: "Malaysian Ringgit (RM)", decimals: 2 },
  { code: "THB", locale: "th-TH", country: "TH", label: "Thai Baht (฿)", decimals: 2 },
  { code: "IDR", locale: "id-ID", country: "ID", label: "Indonesian Rupiah (Rp)", decimals: 2 },
  { code: "PHP", locale: "en-PH", country: "PH", label: "Philippine Peso (₱)", decimals: 2 },
  { code: "VND", locale: "vi-VN", country: "VN", label: "Vietnamese Dong (₫)", decimals: 0 },
  { code: "MMK", locale: "my-MM", country: "MM", label: "Myanmar Kyat (K)", decimals: 2 },
  { code: "KHR", locale: "km-KH", country: "KH", label: "Cambodian Riel (៛)", decimals: 2 },
  { code: "LAK", locale: "lo-LA", country: "LA", label: "Lao Kip (₭)", decimals: 2 },
  { code: "MNT", locale: "mn-MN", country: "MN", label: "Mongolian Tugrik (₮)", decimals: 2 },
  { code: "BND", locale: "ms-BN", country: "BN", label: "Brunei Dollar (B$)", decimals: 2 },
  { code: "KZT", locale: "kk-KZ", country: "KZ", label: "Kazakhstani Tenge (₸)", decimals: 2 },
  { code: "UZS", locale: "uz-UZ", country: "UZ", label: "Uzbekistani Som (UZS)", decimals: 0 },
  { code: "AZN", locale: "az-AZ", country: "AZ", label: "Azerbaijani Manat (₼)", decimals: 2 },
  { code: "GEL", locale: "ka-GE", country: "GE", label: "Georgian Lari (₾)", decimals: 2 },
  { code: "AMD", locale: "hy-AM", country: "AM", label: "Armenian Dram (֏)", decimals: 2 },

  // ── Europe ──────────────────────────────────────────────────
  { code: "EUR", locale: "de-DE", country: "DE", label: "Euro (€)", decimals: 2 },
  { code: "GBP", locale: "en-GB", country: "GB", label: "British Pound (£)", decimals: 2 },
  { code: "CHF", locale: "de-CH", country: "CH", label: "Swiss Franc (CHF)", decimals: 2 },
  { code: "SEK", locale: "sv-SE", country: "SE", label: "Swedish Krona (kr)", decimals: 2 },
  { code: "NOK", locale: "nb-NO", country: "NO", label: "Norwegian Krone (kr)", decimals: 2 },
  { code: "DKK", locale: "da-DK", country: "DK", label: "Danish Krone (kr)", decimals: 2 },
  { code: "PLN", locale: "pl-PL", country: "PL", label: "Polish Zloty (zł)", decimals: 2 },
  { code: "CZK", locale: "cs-CZ", country: "CZ", label: "Czech Koruna (Kč)", decimals: 2 },
  { code: "HUF", locale: "hu-HU", country: "HU", label: "Hungarian Forint (Ft)", decimals: 2 },
  { code: "RON", locale: "ro-RO", country: "RO", label: "Romanian Leu (lei)", decimals: 2 },
  { code: "BGN", locale: "bg-BG", country: "BG", label: "Bulgarian Lev (лв)", decimals: 2 },
  { code: "UAH", locale: "uk-UA", country: "UA", label: "Ukrainian Hryvnia (₴)", decimals: 2 },
  { code: "RSD", locale: "sr-RS", country: "RS", label: "Serbian Dinar (дин)", decimals: 2 },
  { code: "ISK", locale: "is-IS", country: "IS", label: "Icelandic Krona (kr)", decimals: 0 },
  { code: "ALL", locale: "sq-AL", country: "AL", label: "Albanian Lek (L)", decimals: 2 },
  { code: "MKD", locale: "mk-MK", country: "MK", label: "Macedonian Denar (ден)", decimals: 2 },
  { code: "BAM", locale: "bs-BA", country: "BA", label: "Bosnia-Herzegovina Mark (KM)", decimals: 2 },
  { code: "MDL", locale: "ro-MD", country: "MD", label: "Moldovan Leu (MDL)", decimals: 2 },
  { code: "BYN", locale: "be-BY", country: "BY", label: "Belarusian Ruble (Br)", decimals: 2 },

  // ── Oceania ─────────────────────────────────────────────────
  { code: "AUD", locale: "en-AU", country: "AU", label: "Australian Dollar (A$)", decimals: 2 },
  { code: "NZD", locale: "en-NZ", country: "NZ", label: "New Zealand Dollar (NZ$)", decimals: 2 },
  { code: "FJD", locale: "en-FJ", country: "FJ", label: "Fijian Dollar (FJ$)", decimals: 2 },
  { code: "PGK", locale: "en-PG", country: "PG", label: "Papua New Guinean Kina (K)", decimals: 2 },
  { code: "WST", locale: "en-WS", country: "WS", label: "Samoan Tala (WS$)", decimals: 2 },
  { code: "TOP", locale: "en-TO", country: "TO", label: "Tongan Paʻanga (T$)", decimals: 2 },
  { code: "SBD", locale: "en-SB", country: "SB", label: "Solomon Islands Dollar (SI$)", decimals: 2 },
  { code: "VUV", locale: "en-VU", country: "VU", label: "Vanuatu Vatu (VT)", decimals: 0 },

  // ── Americas ────────────────────────────────────────────────
  { code: "USD", locale: "en-US", country: "US", label: "US Dollar ($)", decimals: 2 },
  { code: "CAD", locale: "en-CA", country: "CA", label: "Canadian Dollar (C$)", decimals: 2 },
  { code: "MXN", locale: "es-MX", country: "MX", label: "Mexican Peso (Mex$)", decimals: 2 },
  { code: "BRL", locale: "pt-BR", country: "BR", label: "Brazilian Real (R$)", decimals: 2 },
  { code: "ARS", locale: "es-AR", country: "AR", label: "Argentine Peso (AR$)", decimals: 2 },
  { code: "CLP", locale: "es-CL", country: "CL", label: "Chilean Peso (CL$)", decimals: 0 },
  { code: "COP", locale: "es-CO", country: "CO", label: "Colombian Peso (CO$)", decimals: 2 },
  { code: "PEN", locale: "es-PE", country: "PE", label: "Peruvian Sol (S/)", decimals: 2 },
  { code: "UYU", locale: "es-UY", country: "UY", label: "Uruguayan Peso (UY$)", decimals: 2 },
  { code: "PYG", locale: "es-PY", country: "PY", label: "Paraguayan Guarani (₲)", decimals: 0 },
  { code: "BOB", locale: "es-BO", country: "BO", label: "Bolivian Boliviano (Bs)", decimals: 2 },
  { code: "GTQ", locale: "es-GT", country: "GT", label: "Guatemalan Quetzal (Q)", decimals: 2 },
  { code: "HNL", locale: "es-HN", country: "HN", label: "Honduran Lempira (L)", decimals: 2 },
  { code: "NIO", locale: "es-NI", country: "NI", label: "Nicaraguan Cordoba (C$)", decimals: 2 },
  { code: "CRC", locale: "es-CR", country: "CR", label: "Costa Rican Colon (₡)", decimals: 2 },
  { code: "PAB", locale: "es-PA", country: "PA", label: "Panamanian Balboa (B/.)", decimals: 2 },
  { code: "DOP", locale: "es-DO", country: "DO", label: "Dominican Peso (RD$)", decimals: 2 },
  { code: "JMD", locale: "en-JM", country: "JM", label: "Jamaican Dollar (J$)", decimals: 2 },
  { code: "TTD", locale: "en-TT", country: "TT", label: "Trinidad & Tobago Dollar (TT$)", decimals: 2 },
  { code: "BBD", locale: "en-BB", country: "BB", label: "Barbadian Dollar (Bds$)", decimals: 2 },
  { code: "BSD", locale: "en-BS", country: "BS", label: "Bahamian Dollar (B$)", decimals: 2 },
  { code: "BZD", locale: "en-BZ", country: "BZ", label: "Belize Dollar (BZ$)", decimals: 2 },
  { code: "GYD", locale: "en-GY", country: "GY", label: "Guyanese Dollar (G$)", decimals: 2 },
  { code: "SRD", locale: "nl-SR", country: "SR", label: "Surinamese Dollar (Sr$)", decimals: 2 },
  { code: "HTG", locale: "fr-HT", country: "HT", label: "Haitian Gourde (G)", decimals: 2 },
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
  locale = DEFAULT_LOCALE,
  options?: { precise?: boolean }
): string {
  // Default (unchanged): every currency displays as whole units, no
  // decimals — this is the existing behavior for all current callers and
  // must not change. `precise: true` is opt-in only, for callers that need
  // the currency's real minor-unit precision (e.g. BHD's 3 decimals).
  const fractionDigits = options?.precise ? getCurrencyConfig(currencyCode).decimals : 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
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

// Sprint 31 — Phase 13 (Performance Audit): getCurrencyConfig() is called
// from formatAmount (every money display in the app) and directly in
// several list-rendering components (e.g. ContributionCard, once per
// row). SUPPORTED_CURRENCIES.find() re-scanned all 116 entries on every
// single call. SUPPORTED_CURRENCIES is a static const, so this Map is
// built exactly once at module load and every lookup after that is O(1).
const CURRENCY_CONFIG_BY_CODE = new Map(SUPPORTED_CURRENCIES.map((c) => [c.code, c]));

/**
 * Get a currency config by code. Falls back to ZAR.
 */
export function getCurrencyConfig(code: string): CurrencyConfig {
  return CURRENCY_CONFIG_BY_CODE.get(code) ?? SUPPORTED_CURRENCIES[0];
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