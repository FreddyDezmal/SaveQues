/**
 * lib/exchangeRates/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 31 — Phase 6. Same selector shape as lib/push/index.ts and
 * lib/email/index.ts, but the "which default is safe" reasoning matches
 * email's, not push's: there is no pre-existing FX feed in this app to
 * preserve (unlike push's existing webpush integration), so the honest,
 * regression-free default is identityProvider — see providers/identity.ts's
 * file header for why that's "1:1 rates + loud warning," not silence.
 *
 * Selection is env-var driven:
 *   EXCHANGE_RATE_PROVIDER   - "identity" (default) | "exchangerate_api"
 *   EXCHANGE_RATE_API_KEY    - required only when EXCHANGE_RATE_PROVIDER=exchangerate_api
 *
 * Neither is set anywhere in this project as of Phase 6 — confirmed the
 * same way Phase 9 (email) and Phase 10 (push) confirmed it. Nothing in
 * the app calls this yet either (see the Phase 6 design note on there
 * being no consumer until Phase 7/9) — selecting a provider here doesn't,
 * by itself, cause any conversion to happen anywhere.
 */
import type { ExchangeRateProvider } from "./types";
import { identityProvider } from "./providers/identity";
import { createExchangeRateApiProvider } from "./providers/exchangerateApi";
import { createLogger } from "@/lib/logger";

export type { ExchangeRate, ExchangeRateProvider } from "./types";

const log = createLogger("exchange-rates");

export function selectExchangeRateProvider(env: Record<string, string | undefined>): ExchangeRateProvider {
  const providerName = env.EXCHANGE_RATE_PROVIDER;

  if (!providerName || providerName === "identity") return identityProvider;

  switch (providerName) {
    case "exchangerate_api": {
      if (!env.EXCHANGE_RATE_API_KEY) {
        log.warn('EXCHANGE_RATE_PROVIDER=exchangerate_api set but EXCHANGE_RATE_API_KEY is missing — falling back to identity.');
        return identityProvider;
      }
      return createExchangeRateApiProvider({ apiKey: env.EXCHANGE_RATE_API_KEY });
    }
    default:
      log.warn(`Unknown EXCHANGE_RATE_PROVIDER="${providerName}" — falling back to identity.`);
      return identityProvider;
  }
}

export function getExchangeRateProvider(): ExchangeRateProvider {
  return selectExchangeRateProvider(process.env as Record<string, string | undefined>);
}
