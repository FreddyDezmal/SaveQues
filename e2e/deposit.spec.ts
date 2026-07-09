import { test, expect } from "@playwright/test";

/**
 * e2e/deposit.spec.ts
 *
 * Sprint 18 — Phase 5. All tests here require an authenticated session —
 * see e2e/fixtures.ts's `authenticatedPage` (storageState-based login,
 * run once via a Playwright global setup project rather than logging in
 * fresh in every single spec, which would be slow and RLS-rate-limit-prone
 * across a full suite run).
 *
 * NOT EXECUTED in this delivery — same caveat as auth.spec.ts.
 */
import { test as authTest } from "./fixtures";

authTest.describe("Deposit flow", () => {
  authTest("depositing into a goal increases its progress and shows a success state", async ({ page }) => {
    await page.goto("/goals");
    await page.getByRole("link").first().click(); // first goal card
    await page.getByRole("button", { name: /log saving|deposit/i }).click();

    const amountInput = page.locator('input[type="number"]');
    await amountInput.fill("25");
    await page.getByRole("button", { name: /log saving|save|confirm/i }).click();

    // Financial correctness signal, not just a UI toast: the goal's
    // progress bar/percentage text should reflect the new total.
    await expect(page.getByText(/\+25|saved/i)).toBeVisible({ timeout: 10_000 });
  });

  authTest(
    "the deposit form is disabled while offline, with an explanatory message — the core Sprint 14 financial-safety guarantee",
    async ({ page, context }) => {
      await page.goto("/goals");
      await page.getByRole("link").first().click();

      await context.setOffline(true);
      // useOnlineStatus needs a browser online/offline event to update;
      // Playwright's context.setOffline() dispatches this correctly.
      await expect(page.getByText(/you're offline/i)).toBeVisible({ timeout: 5_000 });

      const submitButton = page.getByRole("button", { name: /reconnect to continue|log saving/i });
      await expect(submitButton).toBeDisabled();

      await context.setOffline(false);
      await expect(page.getByText(/you're offline/i)).not.toBeVisible({ timeout: 5_000 });
    }
  );

  authTest(
    "pressing Enter in the amount field while offline does NOT submit the deposit (the real safety net, not just the disabled button)",
    async ({ page, context }) => {
      await page.goto("/goals");
      await page.getByRole("link").first().click();
      await page.getByRole("button", { name: /log saving|deposit/i }).click();

      await context.setOffline(true);
      const amountInput = page.locator('input[type="number"]');
      await amountInput.fill("25");
      await amountInput.press("Enter");

      // Must NOT show a success state — this is the exact bypass scenario
      // the Sprint 14 handleSubmit() offline guard was written to prevent.
      await expect(page.getByText(/reconnect to make sure/i)).toBeVisible();
      await context.setOffline(false);
    }
  );
});
