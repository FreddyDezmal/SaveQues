import { test, expect } from "./fixtures";

/**
 * e2e/settings.spec.ts
 *
 * Sprint 18 — Phase 5. NOT EXECUTED in this delivery. Exercises Settings
 * (currency, notification opt-in) and the Sprint 16 Notification
 * Preferences page (six category toggles).
 */

test.describe("Settings", () => {
  test("Version Information section renders real, non-placeholder values", async ({ page }) => {
    // Directly exercises Sprint 16 Phase 5 — confirms /api/version actually
    // returns something and the client-side PWA/SW checks resolve.
    await page.goto("/settings");
    await expect(page.getByText(/Application Version/)).toBeVisible();
    await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Service Worker/)).toBeVisible();
  });

  test("changing currency and saving persists across a reload", async ({ page }) => {
    await page.goto("/settings");
    const currencySelect = page.locator("select").first();
    await currencySelect.selectOption({ label: "Euro (€)" }).catch(async () => {
      // Fallback if currency uses a custom dropdown rather than a native
      // <select>, or the exact label text differs — confirm actual markup
      // and label text on first real run.
      await page.getByText(/currency/i).click();
    });
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByText(/saved/i)).toBeVisible();

    await page.reload();
    await expect(currencySelect).toHaveValue(/EUR/i);
  });
});

test.describe("Notification Preferences", () => {
  test("toggling a category persists after reload", async ({ page }) => {
    await page.goto("/settings/notifications");
    const streakToggle = page.getByRole("switch", { name: "Daily streak reminders" });
    await expect(streakToggle).toBeVisible();

    const wasChecked = (await streakToggle.getAttribute("aria-checked")) === "true";
    await streakToggle.click();
    await expect(streakToggle).toHaveAttribute("aria-checked", String(!wasChecked));

    await page.reload();
    await expect(page.getByRole("switch", { name: "Daily streak reminders" })).toHaveAttribute(
      "aria-checked",
      String(!wasChecked)
    );

    // Restore original state so this test is repeatable against the same
    // seeded account without manual cleanup between runs.
    await page.getByRole("switch", { name: "Daily streak reminders" }).click();
  });

  test("product_announcements, xp, referrals, and monthly_summaries are the only 'Coming soon' categories — Sprint 27 Phase 4 regression check", async ({ page }) => {
    await page.goto("/settings/notifications");
    // 4 category rows without a live send path (see the Phase 4 migration's
    // honesty note) + digest frequency's own "(coming soon)" option labels
    // aren't counted here since those live inside a <select>, not as
    // separate "Coming soon" text nodes — this assertion is scoped to the
    // category list specifically, same scope the original Sprint 17 check had.
    await expect(page.locator("text=Coming soon").first()).toBeVisible();
    await expect(page.getByText("Coming soon", { exact: false })).toHaveCount(4);
  });
});
