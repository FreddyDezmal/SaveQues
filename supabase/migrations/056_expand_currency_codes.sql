-- 043_expand_currency_codes.sql
--
-- Expands lib/currency.ts's SUPPORTED_CURRENCIES from 10 to 116 ISO 4217
-- codes, covering essentially all actively-circulating world currencies
-- (crypto/precious-metal ISO codes like XAU/XAG/BTC intentionally
-- excluded — not relevant to a savings app). This migration updates
-- profiles_currency_code_check (added in migration 025) to match, per
-- that migration's own comment: "If a new currency is added to that file,
-- this constraint must be updated in a follow-up migration."
--
-- Safe by construction: every one of the original 10 codes is still in
-- the new list (strictly additive), so no existing profile row can
-- possibly violate the new constraint. The defensive pre-check is kept
-- anyway, matching migration 025's own pattern, in case of any drift
-- between this migration and the live database.

DO $$
DECLARE bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count FROM public.profiles
  WHERE currency_code NOT IN (
    'ZAR', 'NGN', 'GHS', 'KES', 'EGP', 'MAD', 'DZD', 'TND',
    'ETB', 'UGX', 'TZS', 'RWF', 'ZMW', 'BWP', 'MUR', 'XOF',
    'XAF', 'MZN', 'AOA', 'NAD', 'SZL', 'LSL', 'MWK', 'SDG',
    'LYD', 'CDF', 'SOS', 'AED', 'SAR', 'QAR', 'KWD', 'BHD',
    'OMR', 'ILS', 'JOD', 'LBP', 'IQD', 'TRY', 'INR', 'PKR',
    'BDT', 'LKR', 'NPR', 'CNY', 'JPY', 'KRW', 'HKD', 'TWD',
    'SGD', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'MMK', 'KHR',
    'LAK', 'MNT', 'BND', 'KZT', 'UZS', 'AZN', 'GEL', 'AMD',
    'EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK',
    'HUF', 'RON', 'BGN', 'UAH', 'RSD', 'ISK', 'ALL', 'MKD',
    'BAM', 'MDL', 'BYN', 'AUD', 'NZD', 'FJD', 'PGK', 'WST',
    'TOP', 'SBD', 'VUV', 'USD', 'CAD', 'MXN', 'BRL', 'ARS',
    'CLP', 'COP', 'PEN', 'UYU', 'PYG', 'BOB', 'GTQ', 'HNL',
    'NIO', 'CRC', 'PAB', 'DOP', 'JMD', 'TTD', 'BBD', 'BSD',
    'BZD', 'GYD', 'SRD', 'HTG'
  );

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot expand profiles_currency_code_check: % row(s) have a currency_code outside the new supported set. Review before re-running.',
      bad_count;
  END IF;
END $$;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_currency_code_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_currency_code_check
  CHECK (currency_code IN (
    'ZAR', 'NGN', 'GHS', 'KES', 'EGP', 'MAD', 'DZD', 'TND',
    'ETB', 'UGX', 'TZS', 'RWF', 'ZMW', 'BWP', 'MUR', 'XOF',
    'XAF', 'MZN', 'AOA', 'NAD', 'SZL', 'LSL', 'MWK', 'SDG',
    'LYD', 'CDF', 'SOS', 'AED', 'SAR', 'QAR', 'KWD', 'BHD',
    'OMR', 'ILS', 'JOD', 'LBP', 'IQD', 'TRY', 'INR', 'PKR',
    'BDT', 'LKR', 'NPR', 'CNY', 'JPY', 'KRW', 'HKD', 'TWD',
    'SGD', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'MMK', 'KHR',
    'LAK', 'MNT', 'BND', 'KZT', 'UZS', 'AZN', 'GEL', 'AMD',
    'EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK',
    'HUF', 'RON', 'BGN', 'UAH', 'RSD', 'ISK', 'ALL', 'MKD',
    'BAM', 'MDL', 'BYN', 'AUD', 'NZD', 'FJD', 'PGK', 'WST',
    'TOP', 'SBD', 'VUV', 'USD', 'CAD', 'MXN', 'BRL', 'ARS',
    'CLP', 'COP', 'PEN', 'UYU', 'PYG', 'BOB', 'GTQ', 'HNL',
    'NIO', 'CRC', 'PAB', 'DOP', 'JMD', 'TTD', 'BBD', 'BSD',
    'BZD', 'GYD', 'SRD', 'HTG'
  ));
