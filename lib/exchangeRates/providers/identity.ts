/**
 * lib/exchangeRates/providers/identity.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 31 — Phase 6. The default provider when EXCHANGE_RATE_PROVIDER is
 * unset or unconfigured.
 *
 * Same philosophy as lib/email/index.ts's Phase 9 default ("defaulting to
 * null would be a regression... the honest default was send nothing"),
 * adapted for the one real difference here: push already had a working
 * production provider to preserve (defaulting to webpush), but there is no
 * existing FX feed anywhere in this app to preserve. So the honest default
 * for exchange rates isn't "do nothing" (a provider that throws would break
 * every caller) — it's "return 1:1 rates for every currency and be loud
 * about it," so the app keeps functioning exactly as it does today (no
 * currency actually gets converted anywhere yet — see the Phase 6 design
 * note) while making it impossible to silently ship inaccurate conversion
 * math once something DOES start calling this.
 */

import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import type { ExchangeRate, ExchangeRateProvider } from "../types";
import { createLogger } from "@/lib/logger";

const log = createLogger("exchange-rates.identity");

let hasWarned = false;

export const identityProvider: ExchangeRateProvider = {
  name: "identity",

  async getRates(): Promise<ExchangeRate[]> {
    // Warn once per process, not once per call — this runs on every cache
    // miss otherwise, which would spam logs without adding information.
    if (!hasWarned) {
      log.warn(
        "EXCHANGE_RATE_PROVIDER is not configured — serving 1:1 identity rates for all currencies. " +
          "Cross-currency conversion will be WRONG until a real provider is configured. " +
          "Set EXCHANGE_RATE_PROVIDER=exchangerate_api and EXCHANGE_RATE_API_KEY to fix this."
      );
      hasWarned = true;
    }

    const fetchedAt = new Date().toISOString();
    return SUPPORTED_CURRENCIES.map((c) => ({
      currencyCode: c.code,
      usdRate: 1,
      fetchedAt,
      source: "identity",
    }));
  },
};
