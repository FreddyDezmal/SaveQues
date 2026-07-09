"use client";

/**
 * lib/hooks/useHaptics.ts
 *
 * Wraps navigator.vibrate() — the only haptic-adjacent API available to web
 * apps. Real limitations, stated plainly rather than glossed over:
 *   - iOS Safari has never implemented the Vibration API, on any iOS
 *     version, standalone or not. This is a deliberate Apple platform
 *     restriction, not a bug — there is no workaround from a PWA.
 *   - Desktop browsers without a vibration motor no-op harmlessly.
 *   - Android Chrome/Edge (installed or not) is really the only place this
 *     produces an actual physical tap.
 * Feature-detected below; every call is a safe no-op everywhere else,
 * consistent with usePWAInstall/useAppBadge's "gracefully degrade" pattern
 * from Sprint 15.
 *
 * Never gates any UI state on whether haptics actually fired — it's a
 * pure enhancement layer, checked explicitly in each usage site to ensure
 * it never becomes a dependency for the visual feedback it's paired with.
 */

import { useCallback } from "react";

type HapticPattern = "light" | "medium" | "success" | "warning";

const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 25,
  success: [15, 40, 15],
  warning: [20, 30, 20, 30, 20],
};

export function useHaptics() {
  // Sprint 18 fix: wrapped in useCallback with an empty dependency array.
  // Found via `next lint`'s react-hooks/exhaustive-deps warning at this
  // hook's two call sites (CelebrationOverlay.tsx, InstallSuccessCelebration.tsx)
  // — before this fix, `vibrate` was a brand-new function reference every
  // render, which meant the lint-suggested fix ("just add vibrate to the
  // dependency array") would have been actively wrong: it would have made
  // those effects re-run on every unrelated re-render, not just the state
  // transitions they're meant to respond to. Memoizing here, at the
  // source, is the correct fix — now `vibrate` really is safe to list as
  // a dependency wherever it's used.
  const vibrate = useCallback((pattern: HapticPattern = "light") => {
    if (typeof navigator === "undefined") return;
    if (!("vibrate" in navigator)) return; // iOS Safari, most desktop browsers
    try {
      navigator.vibrate(PATTERNS[pattern]);
    } catch {
      // Some browsers throw if called outside a user gesture (autoplay-style
      // restrictions) — never let a haptic failure surface to the user or
      // interrupt the calling code's own success handling.
    }
  }, []);

  return { vibrate };
}
