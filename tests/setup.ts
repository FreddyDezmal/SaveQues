/**
 * tests/setup.ts
 *
 * Sprint 18 — Phase 2. Runs before every component test (jsdom project
 * only — see vitest.config.ts's `projects` array; the "unit" project does
 * not load this file, since node-environment logic tests have no DOM to
 * clean up and no jest-dom matchers to gain from).
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

// ── Browser API stubs ────────────────────────────────────────────────────
// jsdom does not implement several APIs this app's components use for
// real, feature-detected behavior (matchMedia, IntersectionObserver is not
// used currently — skipped). Stubbed here once, globally, rather than in
// each individual test file, since nearly every component test that
// touches a PWA-aware component (OfflineBanner, InstallSaveQuestCard,
// AppHeader) needs at least matchMedia to not throw.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),    // deprecated API, some libs still call it
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
