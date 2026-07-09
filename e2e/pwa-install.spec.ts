import { test, expect } from "@playwright/test";

/**
 * e2e/pwa-install.spec.ts
 *
 * Sprint 18 — Phase 5 — "PWA installation (where feasible)".
 *
 * Honest limitation: Chromium's real `beforeinstallprompt` eligibility
 * depends on engagement heuristics (time on site, interaction count) that
 * aren't reliably triggerable in a fresh automated browser context, and
 * Playwright has no first-class API to force-fire it. What CAN be
 * meaningfully tested end-to-end is the set of prerequisites Chrome
 * actually checks before it would ever consider offering the install
 * prompt — a real regression in any of these (e.g. manifest 404s, SW
 * fails to register) would silently break installability in production
 * with no error visible anywhere else in this test suite. That's what
 * this file covers; it stops short of the actual native install dialog.
 *
 * NOT EXECUTED in this delivery — same caveat as every other e2e/ file.
 */

test.describe("PWA installability prerequisites", () => {
  test("manifest.json is served, valid JSON, and has the required installability fields", async ({ page, request }) => {
    await page.goto("/dashboard");
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBe("/manifest.json");

    const res = await request.get(manifestHref!);
    expect(res.ok()).toBe(true);
    const manifest = await res.json();

    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    // At least one icon >= 192px is required for Chrome's installability
    // check — this would catch e.g. the icons array accidentally being
    // emptied or all entries pointing at a 404'd path.
    const hasQualifyingIcon = manifest.icons?.some((i: any) => {
      const size = parseInt(String(i.sizes).split("x")[0], 10);
      return size >= 192;
    });
    expect(hasQualifyingIcon).toBe(true);
  });

  test("the service worker script is served with the correct no-cache header, and registers", async ({ page, request }) => {
    const res = await request.get("/sw.js");
    expect(res.ok()).toBe(true);
    expect(res.headers()["cache-control"]).toContain("no-cache");

    await page.goto("/dashboard");
    const active = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return !!reg.active;
    });
    expect(active).toBe(true);
  });

  test("theme-color meta tag matches the manifest's theme_color (Sprint 14 fix regression check)", async ({ page, request }) => {
    await page.goto("/dashboard");
    const metaThemeColor = await page.locator('meta[name="theme-color"]').getAttribute("content");
    const manifest = await (await request.get("/manifest.json")).json();
    expect(metaThemeColor).toBe(manifest.theme_color);
  });
});
