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

type HapticPattern = "light" | "medium" | "success" | "warning";

const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 25,
  success: [15, 40, 15],
  warning: [20, 30, 20, 30, 20],
};

export function useHaptics() {
  function vibrate(pattern: HapticPattern = "light") {
    if (typeof navigator === "undefined") return;
    if (!("vibrate" in navigator)) return; // iOS Safari, most desktop browsers
    try {
      navigator.vibrate(PATTERNS[pattern]);
    } catch {
      // Some browsers throw if called outside a user gesture (autoplay-style
      // restrictions) — never let a haptic failure surface to the user or
      // interrupt the calling code's own success handling.
    }
  }

  return { vibrate };
}
