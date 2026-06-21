import { defineConfig } from "vitest/config";
import path from "path";

/**
 * vitest.config.ts
 *
 * Sprint 11 — Phase 5: Testing infrastructure.
 *
 * No test runner existed in this codebase prior to this sprint (confirmed
 * during investigation — no jest/vitest/testing-library in package.json).
 * Vitest is added as the minimal, ESM-native choice that runs the
 * server-side logic under test (scheduler math, deferred-analytics
 * wrapper, business-metrics threshold logic) without requiring a DOM
 * environment, a Next.js dev server, or a real Supabase connection for
 * the unit-test tier.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});