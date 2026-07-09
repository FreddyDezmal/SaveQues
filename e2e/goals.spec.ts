import { test, expect } from "./fixtures";

/**
 * e2e/goals.spec.ts
 *
 * Sprint 18 — Phase 5. NOT EXECUTED in this delivery — see auth.spec.ts's
 * header for the standard caveat. Selectors reference the real multi-step
 * wizard in app/(app)/goals/new/page.tsx (title input has no stable
 * data-testid currently — matched by placeholder text instead, which is
 * brittle against copy changes; adding data-testid attributes to this
 * wizard would be a good, low-risk follow-up, noted in the Sprint 18
 * technical debt list rather than done here to avoid scope creep into a
 * component this sprint didn't otherwise need to touch).
 */

test.describe("Goal creation", () => {
  test("creating a goal through the full wizard lands on the new goal's detail page", async ({ page }) => {
    await page.goto("/goals/new");

    // Step 1: category selection (assumes at least one category card is
    // clickable and advances the wizard — exact selector to be confirmed
    // against the live category grid on first real run).
    await page.getByRole("button", { name: "Continue →" }).click();

    // Step 2: title
    const titleInput = page.locator("input").first();
    await titleInput.fill(`E2E Test Goal ${Date.now()}`);
    await page.getByRole("button", { name: "Continue →" }).click();

    // Step 3: target amount
    const amountInput = page.locator('input[type="number"], input[inputmode="decimal"]').first();
    await amountInput.fill("500");
    await page.getByRole("button", { name: /create|finish/i }).click();

    await expect(page).toHaveURL(/\/goals\/[a-f0-9-]+/, { timeout: 10_000 });
  });

  test("the Goals page empty state (new account, no goals) links to goal creation", async ({ page }) => {
    // This only meaningfully exercises the EmptyState component (Sprint
    // 16 migration) on an account with zero goals — skip if the shared
    // test account already has goals from earlier spec runs.
    await page.goto("/goals");
    const emptyState = page.getByText("No goals yet");
    if (await emptyState.isVisible().catch(() => false)) {
      await page.getByRole("link", { name: /create my first goal/i }).click();
      await expect(page).toHaveURL(/\/goals\/new/);
    } else {
      test.skip(true, "Test account already has goals — empty state not reachable this run");
    }
  });
});

test.describe("Goal completion", () => {
  test(
    "completing a goal (deposit reaching 100%) shows the celebration overlay with a Share option",
    async ({ page }) => {
      // Requires a seeded goal close to its target — see
      // docs/DEVELOPMENT.md's seed-data requirements. This test deposits
      // exactly enough to cross 100% and asserts the Sprint 15
      // CelebrationOverlay + ShareButton (wired for type "goal") appear.
      await page.goto("/goals");
      const nearCompleteGoal = page.getByText(/almost there|99%/i).first();
      const hasNearCompleteGoal = await nearCompleteGoal.isVisible().catch(() => false);
      test.skip(!hasNearCompleteGoal, "No near-complete goal in seed data for this test run");
      await nearCompleteGoal.click();

      await page.getByRole("button", { name: /log saving|deposit/i }).click();
      const amountInput = page.locator('input[type="number"]');
      await amountInput.fill("1000"); // overshoot on purpose to guarantee completion
      await page.getByRole("button", { name: /log saving|save|confirm/i }).click();

      await expect(page.getByText(/goal complete|congratulations/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: /share/i })).toBeVisible();
    }
  );
});
