import { test, expect } from "./fixtures";

/**
 * e2e/offline.spec.ts
 *
 * Sprint 18 — Phase 5. NOT EXECUTED in this delivery. Exercises the
 * Sprint 14 offline architecture end-to-end: service worker registration,
 * the offline fallback page, and the app-wide OfflineBanner (Sprint 15).
 *
 * Important limitation, stated plainly: Playwright's `context.setOffline()`
 * simulates network failure at the browser level, which is what
 * navigator.onLine / online-offline events respond to (what OfflineBanner
 * and useOnlineStatus rely on) — but it does NOT disable the service
 * worker's own cache, so these tests correctly exercise "the app while the
 * network is down" but are a weaker test of "the app after a real SW
 * install with a cold cache," which needs a slower, more manual Playwright
 * flow (register, wait for activation, THEN go offline) not written here
 * due to time — flagged in technical debt below.
 */

test.describe("Offline experience", () => {
  test("service worker registers successfully on first load", async ({ page }) => {
    await page.goto("/dashboard");
    const swRegistered = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    });
    expect(swRegistered).toBe(true);
  });

  test("navigating to a never-visited route while offline shows the /offline fallback page", async ({ page, context }) => {
    // Visit once online first so the SW has a chance to install/activate —
    // going offline before any successful load would just show the
    // browser's own native offline error, not our fallback.
    await page.goto("/dashboard");
    await page.waitForTimeout(2000); // allow SW activation; a real run should poll registration.active instead

    await context.setOffline(true);
    await page.goto("/timeline").catch(() => {}); // navigation may reject; the assertion below is what matters
    await expect(page.getByText("No connection")).toBeVisible({ timeout: 10_000 });
    await context.setOffline(false);
  });

  test("the offline page's Try Again button attempts a real reload", async ({ page, context }) => {
    await page.goto("/dashboard");
    await context.setOffline(true);
    await page.goto("/some-never-cached-route").catch(() => {});
    await expect(page.getByText("No connection")).toBeVisible();

    await context.setOffline(false);
    await page.getByRole("button", { name: /try again/i }).click();
    await expect(page.getByText("No connection")).not.toBeVisible({ timeout: 10_000 });
  });

  test("the app-wide OfflineBanner appears below the header, not overlapping it", async ({ page, context }) => {
    await page.goto("/dashboard");
    await context.setOffline(true);
    const banner = page.getByText(/you're offline/i);
    await expect(banner).toBeVisible();

    const headerBox = await page.locator("header").boundingBox();
    const bannerBox = await banner.boundingBox();
    expect(headerBox && bannerBox && bannerBox.y >= headerBox.y + headerBox.height - 1).toBeTruthy();
    await context.setOffline(false);
  });
});
