import { test as base, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * e2e/fixtures.ts
 *
 * Sprint 18 — Phase 5. Provides a pre-authenticated `page` via Playwright's
 * storageState mechanism, so specs that need to be logged in don't each
 * pay the cost (and RLS-observable side effects, e.g. record_app_open
 * timestamp churn) of a fresh login. The storageState file itself is
 * produced by e2e/global-setup.ts, which runs once before the whole suite.
 *
 * NOT EXECUTED in this delivery — global-setup.ts needs
 * E2E_TEST_EMAIL/E2E_TEST_PASSWORD against a real Supabase test project to
 * actually produce a valid storageState.json.
 */

const STORAGE_STATE_PATH = path.join(__dirname, ".auth", "user.json");

export const test = base.extend({
  storageState: async ({}, use) => {
    if (!fs.existsSync(STORAGE_STATE_PATH)) {
      throw new Error(
        `Missing ${STORAGE_STATE_PATH} — run the global-setup project first ` +
          `(npx playwright test --project=setup), or set E2E_TEST_EMAIL/E2E_TEST_PASSWORD ` +
          `and let global-setup.ts create it automatically. See docs/DEVELOPMENT.md.`
      );
    }
    await use(STORAGE_STATE_PATH);
  },
});

export { expect };
