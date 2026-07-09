import { defineConfig, devices } from "@playwright/test";

/**
 * playwright.config.ts
 *
 * Sprint 18 — Phase 5. Runs against a real Next.js dev server (started
 * automatically via `webServer` below) rather than a deployed environment,
 * so these tests never touch production data. Requires a real Supabase
 * *test* project's credentials in `.env.test.local` — see
 * docs/DEVELOPMENT.md's "Running E2E tests" section for the seed-data
 * requirements (a confirmed test user, at least one active goal) these
 * specs assume.
 *
 * IMPORTANT — not executed in this delivery: these specs were authored
 * against the real routes/selectors in this codebase, but there is no
 * running dev server, browser, or live Supabase test project available in
 * the environment these were written in. They need a real run against a
 * seeded test project before being trusted as passing — see the
 * Deployment Checklist in the Sprint 18 summary.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  globalSetup: require.resolve("./e2e/global-setup.ts"),

  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],

  // Starts `next dev` automatically for local runs; in CI, a separate step
  // builds and starts the app first (see .github/workflows/ci.yml) so this
  // is skipped via `reuseExistingServer`.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
