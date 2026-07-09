import { test, expect } from "@playwright/test";

/**
 * e2e/auth.spec.ts
 *
 * Sprint 18 — Phase 5. Requires E2E_TEST_EMAIL / E2E_TEST_PASSWORD env
 * vars pointing at a real, confirmed test account in a Supabase *test*
 * project (never production) — see docs/DEVELOPMENT.md.
 *
 * NOT EXECUTED in this delivery — no dev server, browser, or live
 * Supabase test project is available in the environment these were
 * authored in. Selectors were written against the real page source
 * (app/auth/login/page.tsx), including the htmlFor/id fix made in this
 * same sprint specifically so `getByLabel` would work reliably here.
 */

test.describe("Login", () => {
  test("shows a validation error for an unregistered email", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Email").fill("definitely-not-a-real-account@example.com");
    await page.getByLabel("Password").fill("wrongpassword123");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page.getByText(/invalid|incorrect|not found/i)).toBeVisible({ timeout: 10_000 });
  });

  test("successfully logs in with valid credentials and lands on the dashboard", async ({ page }) => {
    const email = process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEST_PASSWORD;
    test.skip(!email || !password, "E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set");

    await page.goto("/auth/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test("the 'Forgot password?' link navigates to the reset flow", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/auth\/forgot-password/);
  });

  test("unauthenticated access to /dashboard redirects to /auth/login (middleware check)", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
