import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * vitest.config.ts
 *
 * Sprint 11 — Phase 5: Testing infrastructure (original).
 * Sprint 18 — Phase 2: extended (not replaced) to add a second test
 * project for component tests, which need jsdom + React. This uses
 * Vitest's `projects` feature specifically so the existing "node"
 * environment for pure-logic unit tests is untouched — those tests never
 * needed a DOM and adding jsdom globally would be a regression risk for
 * zero benefit (jsdom setup can leak globals that pure logic tests
 * shouldn't have needed to think about).
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
    },
    projects: [
      {
        // Original unit-test project — untouched in behavior.
        test: {
          name: "unit",
          environment: "node",
          globals: true,
          include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
        },
        resolve: {
          alias: { "@": path.resolve(__dirname, ".") },
        },
      },
      {
        // Sprint 18: component tests, jsdom + React Testing Library.
        // Fix found by actually running the suite for the first time:
        // without @vitejs/plugin-react, Vitest's default transform can't
        // parse JSX in .test.tsx files at all — every single component
        // test failed with a parse error until this plugin was added.
        plugins: [react()],
        test: {
          name: "component",
          environment: "jsdom",
          globals: true,
          include: ["tests/component/**/*.test.tsx"],
          setupFiles: ["./tests/setup.ts"],
        },
        resolve: {
          alias: { "@": path.resolve(__dirname, ".") },
        },
      },
    ],
  },
});