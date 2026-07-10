"use client";

/**
 * lib/hooks/usePrefersReducedMotion.ts
 *
 * Sprint 20 — Phase 8: Premium Celebrations.
 *
 * Audit finding: no component in the codebase previously checked
 * `prefers-reduced-motion` — confetti/animation code in
 * CelebrationOverlay ran unconditionally for every user. This hook fills
 * that gap, following the same "feature-detect, safe default, gracefully
 * degrade" pattern as lib/hooks/useHaptics.ts.
 *
 * Defaults to `false` (motion allowed) until the media query can be read
 * on the client, matching SSR-safe conventions used elsewhere in
 * lib/hooks/ (useOnlineStatus.ts, usePWAInstall.ts).
 */

import { useEffect, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}
