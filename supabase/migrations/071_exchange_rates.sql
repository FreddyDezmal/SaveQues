-- 071_exchange_rates.sql
--
-- Sprint 31 — Phase 6: Exchange Rate Infrastructure.
--
-- One row per supported currency (not per pair — see
-- lib/exchangeRates/types.ts's file header for why), priced against USD.
-- Populated by the daily cron at app/api/cron/exchange-rates/route.ts and
-- read by lib/exchangeRates/cache.ts, which falls back to a live provider
-- call if a row is missing or older than 24h, and to the previous value if
-- that live call also fails (see cache.ts for the exact fallback order).
--
-- currency_code CHECK constraint mirrors profiles_currency_code_check
-- (migrations 025, 056) against the same lib/currency.ts SUPPORTED_CURRENCIES
-- list — if a new currency is ever added there, this constraint needs the
-- same follow-up migration treatment as profiles' does.
--
-- RLS: enabled, no policies at all — same pattern as billing_webhook_events
-- (migration 069). This table is never read or written by an authenticated
-- user session; only the cron route and lib/exchangeRates/cache.ts via the
-- service-role client touch it. Directly satisfies Phase 14's "users cannot
-- manipulate exchange rates."

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  currency_code  text PRIMARY KEY
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
    )),
  -- Units of this currency per 1 USD. USD's own row always has usd_rate = 1.
  usd_rate       numeric NOT NULL CHECK (usd_rate > 0),
  fetched_at     timestamptz NOT NULL,
  source         text NOT NULL
);

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
-- No client policies at all — see file header. Only the service-role
-- client (cron route, cache.ts) reads or writes this table.

CREATE INDEX IF NOT EXISTS idx_exchange_rates_fetched_at
  ON public.exchange_rates (fetched_at);
