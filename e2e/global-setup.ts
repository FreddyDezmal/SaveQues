import { chromium, type FullConfig } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * e2e/global-setup.ts
 *
 * Sprint 18 — Phase 5. Runs once before the full Playwright suite (wired
 * in playwright.config.ts via `globalSetup`). Logs in with
 * E2E_TEST_EMAIL/E2E_TEST_PASSWORD and saves the resulting cookies/storage
 * to e2e/.auth/user.json, which e2e/fixtures.ts's authenticated `test`
 * then reuses across every spec that needs a logged-in session.
 *
 * Skips gracefully (does not throw) when the env vars aren't set, so
 * `npm run test:e2e` still runs the unauthenticated specs (auth.spec.ts)
 * in an environment that hasn't been configured with test credentials yet.
 */
export default async function globalSetup(config: FullConfig) {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!email || !password) {
    console.warn(
      "[global-setup] E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set — skipping authenticated " +
        "session setup. Specs using e2e/fixtures.ts's authenticated `test` will fail with " +
        "a clear error rather than silently running unauthenticated."
    );
    return;
  }

  const baseURL = config.projects[0]?.use?.baseURL || "http://localhost:3000";
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });

  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

  const authDir = path.join(__dirname, ".auth");
  fs.mkdirSync(authDir, { recursive: true });
  await page.context().storageState({ path: path.join(authDir, "user.json") });

  await browser.close();
}
