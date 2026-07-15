// ── Global-ready currency formatting ──────────────────────────
// All monetary values are stored as plain numbers in the database.
// Currency is a display concern only. This module handles all formatting.

export interface CurrencyConfig {
  code: string;
  locale: string;
  label: string;
  country: string;
}

// AUDIT NOTE: profiles.currency_code has a DB CHECK constraint
// (profiles_currency_code_check, migration 025) that must exactly mirror
// the `code` values below. Adding/removing a currency here requires a
// matching migration — see 043_expand_currency_codes.sql for the
// migration that brought this list from 10 to its current size, which is
// the pattern to follow for any future changes.
export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  // ── Africa ──────────────────────────────────────────────────
  { code: "ZAR", locale: "en-ZA", country: "ZA", label: "South African Rand (R)" },
  { code: "NGN", locale: "en-NG", country: "NG", label: "Nigerian Naira (₦)" },
  { code: "GHS", locale: "en-GH", country: "GH", label: "Ghanaian Cedi (₵)" },
  { code: "KES", locale: "sw-KE", country: "KE", label: "Kenyan Shilling (KSh)" },
  { code: "EGP", locale: "ar-EG", country: "EG", label: "Egyptian Pound (E£)" },
  { code: "MAD", locale: "ar-MA", country: "MA", label: "Moroccan Dirham (MAD)" },
  { code: "DZD", locale: "ar-DZ", country: "DZ", label: "Algerian Dinar (DZD)" },
  { code: "TND", locale: "ar-TN", country: "TN", label: "Tunisian Dinar (TND)" },
  { code: "ETB", locale: "en-ET", country: "ET", label: "Ethiopian Birr (Br)" },
  { code: "UGX", locale: "en-UG", country: "UG", label: "Ugandan Shilling (USh)" },
  { code: "TZS", locale: "sw-TZ", country: "TZ", label: "Tanzanian Shilling (TSh)" },
  { code: "RWF", locale: "en-RW", country: "RW", label: "Rwandan Franc (RF)" },
  { code: "ZMW", locale: "en-ZM", country: "ZM", label: "Zambian Kwacha (ZK)" },
  { code: "BWP", locale: "en-BW", country: "BW", label: "Botswana Pula (P)" },
  { code: "MUR", locale: "en-MU", country: "MU", label: "Mauritian Rupee (₨)" },
  { code: "XOF", locale: "fr-SN", country: "SN", label: "West African CFA Franc (CFA)" },
  { code: "XAF", locale: "fr-CM", country: "CM", label: "Central African CFA Franc (FCFA)" },
  { code: "MZN", locale: "pt-MZ", country: "MZ", label: "Mozambican Metical (MT)" },
  { code: "AOA", locale: "pt-AO", country: "AO", label: "Angolan Kwanza (Kz)" },
  { code: "NAD", locale: "en-NA", country: "NA", label: "Namibian Dollar (N$)" },
  { code: "SZL", locale: "en-SZ", country: "SZ", label: "Eswatini Lilangeni (L)" },
  { code: "LSL", locale: "en-LS", country: "LS", label: "Lesotho Loti (L)" },
  { code: "MWK", locale: "en-MW", country: "MW", label: "Malawian Kwacha (MK)" },
  { code: "SDG", locale: "ar-SD", country: "SD", label: "Sudanese Pound (SDG)" },
  { code: "LYD", locale: "ar-LY", country: "LY", label: "Libyan Dinar (LD)" },
  { code: "CDF", locale: "fr-CD", country: "CD", label: "Congolese Franc (FC)" },
  { code: "SOS", locale: "so-SO", country: "SO", label: "Somali Shilling (Sh)" },

  // ── Middle East ─────────────────────────────────────────────
  { code: "AED", locale: "ar-AE", country: "AE", label: "UAE Dirham (AED)" },
  { code: "SAR", locale: "ar-SA", country: "SA", label: "Saudi Riyal (SAR)" },
  { code: "QAR", locale: "ar-QA", country: "QA", label: "Qatari Riyal (QAR)" },
  { code: "KWD", locale: "ar-KW", country: "KW", label: "Kuwaiti Dinar (KWD)" },
  { code: "BHD", locale: "ar-BH", country: "BH", label: "Bahraini Dinar (BHD)" },
  { code: "OMR", locale: "ar-OM", country: "OM", label: "Omani Rial (OMR)" },
  { code: "ILS", locale: "he-IL", country: "IL", label: "Israeli New Shekel (₪)" },
  { code: "JOD", locale: "ar-JO", country: "JO", label: "Jordanian Dinar (JOD)" },
  { code: "LBP", locale: "ar-LB", country: "LB", label: "Lebanese Pound (L£)" },
  { code: "IQD", locale: "ar-IQ", country: "IQ", label: "Iraqi Dinar (IQD)" },
  { code: "TRY", locale: "tr-TR", country: "TR", label: "Turkish Lira (₺)" },

  // ── Asia ────────────────────────────────────────────────────
  { code: "INR", locale: "en-IN", country: "IN", label: "Indian Rupee (₹)" },
  { code: "PKR", locale: "ur-PK", country: "PK", label: "Pakistani Rupee (₨)" },
  { code: "BDT", locale: "bn-BD", country: "BD", label: "Bangladeshi Taka (৳)" },
  { code: "LKR", locale: "si-LK", country: "LK", label: "Sri Lankan Rupee (₨)" },
  { code: "NPR", locale: "ne-NP", country: "NP", label: "Nepalese Rupee (₨)" },
  { code: "CNY", locale: "zh-CN", country: "CN", label: "Chinese Yuan (¥)" },
  { code: "JPY", locale: "ja-JP", country: "JP", label: "Japanese Yen (¥)" },
  { code: "KRW", locale: "ko-KR", country: "KR", label: "South Korean Won (₩)" },
  { code: "HKD", locale: "zh-HK", country: "HK", label: "Hong Kong Dollar (HK$)" },
  { code: "TWD", locale: "zh-TW", country: "TW", label: "New Taiwan Dollar (NT$)" },
  { code: "SGD", locale: "en-SG", country: "SG", label: "Singapore Dollar (S$)" },
  { code: "MYR", locale: "ms-MY", country: "MY", label: "Malaysian Ringgit (RM)" },
  { code: "THB", locale: "th-TH", country: "TH", label: "Thai Baht (฿)" },
  { code: "IDR", locale: "id-ID", country: "ID", label: "Indonesian Rupiah (Rp)" },
  { code: "PHP", locale: "en-PH", country: "PH", label: "Philippine Peso (₱)" },
  { code: "VND", locale: "vi-VN", country: "VN", label: "Vietnamese Dong (₫)" },
  { code: "MMK", locale: "my-MM", country: "MM", label: "Myanmar Kyat (K)" },
  { code: "KHR", locale: "km-KH", country: "KH", label: "Cambodian Riel (៛)" },
  { code: "LAK", locale: "lo-LA", country: "LA", label: "Lao Kip (₭)" },
  { code: "MNT", locale: "mn-MN", country: "MN", label: "Mongolian Tugrik (₮)" },
  { code: "BND", locale: "ms-BN", country: "BN", label: "Brunei Dollar (B$)" },
  { code: "KZT", locale: "kk-KZ", country: "KZ", label: "Kazakhstani Tenge (₸)" },
  { code: "UZS", locale: "uz-UZ", country: "UZ", label: "Uzbekistani Som (UZS)" },
  { code: "AZN", locale: "az-AZ", country: "AZ", label: "Azerbaijani Manat (₼)" },
  { code: "GEL", locale: "ka-GE", country: "GE", label: "Georgian Lari (₾)" },
  { code: "AMD", locale: "hy-AM", country: "AM", label: "Armenian Dram (֏)" },

  // ── Europe ──────────────────────────────────────────────────
  { code: "EUR", locale: "de-DE", country: "DE", label: "Euro (€)" },
  { code: "GBP", locale: "en-GB", country: "GB", label: "British Pound (£)" },
  { code: "CHF", locale: "de-CH", country: "CH", label: "Swiss Franc (CHF)" },
  { code: "SEK", locale: "sv-SE", country: "SE", label: "Swedish Krona (kr)" },
  { code: "NOK", locale: "nb-NO", country: "NO", label: "Norwegian Krone (kr)" },
  { code: "DKK", locale: "da-DK", country: "DK", label: "Danish Krone (kr)" },
  { code: "PLN", locale: "pl-PL", country: "PL", label: "Polish Zloty (zł)" },
  { code: "CZK", locale: "cs-CZ", country: "CZ", label: "Czech Koruna (Kč)" },
  { code: "HUF", locale: "hu-HU", country: "HU", label: "Hungarian Forint (Ft)" },
  { code: "RON", locale: "ro-RO", country: "RO", label: "Romanian Leu (lei)" },
  { code: "BGN", locale: "bg-BG", country: "BG", label: "Bulgarian Lev (лв)" },
  { code: "UAH", locale: "uk-UA", country: "UA", label: "Ukrainian Hryvnia (₴)" },
  { code: "RSD", locale: "sr-RS", country: "RS", label: "Serbian Dinar (дин)" },
  { code: "ISK", locale: "is-IS", country: "IS", label: "Icelandic Krona (kr)" },
  { code: "ALL", locale: "sq-AL", country: "AL", label: "Albanian Lek (L)" },
  { code: "MKD", locale: "mk-MK", country: "MK", label: "Macedonian Denar (ден)" },
  { code: "BAM", locale: "bs-BA", country: "BA", label: "Bosnia-Herzegovina Mark (KM)" },
  { code: "MDL", locale: "ro-MD", country: "MD", label: "Moldovan Leu (MDL)" },
  { code: "BYN", locale: "be-BY", country: "BY", label: "Belarusian Ruble (Br)" },

  // ── Oceania ─────────────────────────────────────────────────
  { code: "AUD", locale: "en-AU", country: "AU", label: "Australian Dollar (A$)" },
  { code: "NZD", locale: "en-NZ", country: "NZ", label: "New Zealand Dollar (NZ$)" },
  { code: "FJD", locale: "en-FJ", country: "FJ", label: "Fijian Dollar (FJ$)" },
  { code: "PGK", locale: "en-PG", country: "PG", label: "Papua New Guinean Kina (K)" },
  { code: "WST", locale: "en-WS", country: "WS", label: "Samoan Tala (WS$)" },
  { code: "TOP", locale: "en-TO", country: "TO", label: "Tongan Paʻanga (T$)" },
  { code: "SBD", locale: "en-SB", country: "SB", label: "Solomon Islands Dollar (SI$)" },
  { code: "VUV", locale: "en-VU", country: "VU", label: "Vanuatu Vatu (VT)" },

  // ── Americas ────────────────────────────────────────────────
  { code: "USD", locale: "en-US", country: "US", label: "US Dollar ($)" },
  { code: "CAD", locale: "en-CA", country: "CA", label: "Canadian Dollar (C$)" },
  { code: "MXN", locale: "es-MX", country: "MX", label: "Mexican Peso (Mex$)" },
  { code: "BRL", locale: "pt-BR", country: "BR", label: "Brazilian Real (R$)" },
  { code: "ARS", locale: "es-AR", country: "AR", label: "Argentine Peso (AR$)" },
  { code: "CLP", locale: "es-CL", country: "CL", label: "Chilean Peso (CL$)" },
  { code: "COP", locale: "es-CO", country: "CO", label: "Colombian Peso (CO$)" },
  { code: "PEN", locale: "es-PE", country: "PE", label: "Peruvian Sol (S/)" },
  { code: "UYU", locale: "es-UY", country: "UY", label: "Uruguayan Peso (UY$)" },
  { code: "PYG", locale: "es-PY", country: "PY", label: "Paraguayan Guarani (₲)" },
  { code: "BOB", locale: "es-BO", country: "BO", label: "Bolivian Boliviano (Bs)" },
  { code: "GTQ", locale: "es-GT", country: "GT", label: "Guatemalan Quetzal (Q)" },
  { code: "HNL", locale: "es-HN", country: "HN", label: "Honduran Lempira (L)" },
  { code: "NIO", locale: "es-NI", country: "NI", label: "Nicaraguan Cordoba (C$)" },
  { code: "CRC", locale: "es-CR", country: "CR", label: "Costa Rican Colon (₡)" },
  { code: "PAB", locale: "es-PA", country: "PA", label: "Panamanian Balboa (B/.)" },
  { code: "DOP", locale: "es-DO", country: "DO", label: "Dominican Peso (RD$)" },
  { code: "JMD", locale: "en-JM", country: "JM", label: "Jamaican Dollar (J$)" },
  { code: "TTD", locale: "en-TT", country: "TT", label: "Trinidad & Tobago Dollar (TT$)" },
  { code: "BBD", locale: "en-BB", country: "BB", label: "Barbadian Dollar (Bds$)" },
  { code: "BSD", locale: "en-BS", country: "BS", label: "Bahamian Dollar (B$)" },
  { code: "BZD", locale: "en-BZ", country: "BZ", label: "Belize Dollar (BZ$)" },
  { code: "GYD", locale: "en-GY", country: "GY", label: "Guyanese Dollar (G$)" },
  { code: "SRD", locale: "nl-SR", country: "SR", label: "Surinamese Dollar (Sr$)" },
  { code: "HTG", locale: "fr-HT", country: "HT", label: "Haitian Gourde (G)" },
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