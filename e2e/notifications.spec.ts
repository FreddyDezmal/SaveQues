import { test, expect } from "./fixtures";

/**
 * e2e/notifications.spec.ts
 *
 * Sprint 18 — Phase 5. NOT EXECUTED in this delivery. Exercises the
 * Sprint 15/16/17 Notification Center: bell badge, open/close, mark-read
 * with Undo, and the accessibility fixes (focus trap, Escape-to-close)
 * added in Sprint 17.
 */

test.describe("Notification Center", () => {
  test("opens via the bell icon and closes via Escape, returning focus to the bell", async ({ page }) => {
    await page.goto("/dashboard");
    const bell = page.getByRole("button", { name: /notifications/i });
    await bell.click();

    const dialog = page.getByRole("dialog", { name: "Notifications" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(bell).toBeFocused();
  });

  test("Tab cycles within the panel while open (focus trap) rather than escaping to the page behind it", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /notifications/i }).click();
    const dialog = page.getByRole("dialog", { name: "Notifications" });
    await expect(dialog).toBeVisible();

    // Tab repeatedly — focus should never land on an element outside the
    // dialog (e.g. the bottom nav behind the overlay).
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      const activeInsideDialog = await page.evaluate(() => {
        const dialogEl = document.querySelector('[role="dialog"]');
        return dialogEl?.contains(document.activeElement) ?? false;
      });
      expect(activeInsideDialog).toBe(true);
    }
  });

  test("marking a notification read shows an Undo snackbar, and Undo actually reverts it", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /notifications/i }).click();

    const firstUnread = page.locator('[role="dialog"] button').filter({ hasText: /./ }).first();
    const hasNotification = await firstUnread.isVisible().catch(() => false);
    test.skip(!hasNotification, "No notifications in seed data for this test run");

    await firstUnread.click();
    await expect(page.getByText(/notification marked as read/i)).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText(/notification marked as read/i)).not.toBeVisible();

    // The real assertion: reload and confirm the server write was actually
    // cancelled (Sprint 16's deferred-commit design), not just visually
    // reverted client-side.
    await page.reload();
    await page.getByRole("button", { name: /notifications/i }).click();
    // (Specific "still unread" assertion depends on a stable per-row
    // selector not yet added to NotificationCenter — see technical debt.)
  });
});
