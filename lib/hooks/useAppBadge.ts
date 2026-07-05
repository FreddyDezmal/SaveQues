"use client";

import { useEffect, useRef } from "react";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";

/**
 * Wraps the App Badge API (navigator.setAppBadge / clearAppBadge).
 *
 * Browser support reality: this is currently Chromium-only (Chrome/Edge on
 * Android and Desktop, when the app is installed) — Safari and Firefox
 * don't implement it. Feature-detected below; on unsupported browsers this
 * hook is simply a no-op, which is the correct degrade — there is no
 * fallback UI needed since the in-app bell badge (NotificationBell) already
 * covers the same information for everyone regardless of browser support.
 *
 * `count === null` means "not loaded yet" and intentionally does nothing —
 * it avoids clearing a legitimate existing badge for a split second while
 * the real count is still being fetched on mount.
 */
export function useAppBadge(count: number | null): void {
  const lastSet = useRef<number | null>(null);

  useEffect(() => {
    if (count === null) return;
    if (!("setAppBadge" in navigator)) return;
    if (lastSet.current === count) return;

    lastSet.current = count;

    if (count > 0) {
      (navigator as any).setAppBadge(count).catch(() => {});
      trackEvent(AnalyticsEvents.BADGE_SET, { count });
    } else {
      (navigator as any).clearAppBadge().catch(() => {});
      trackEvent(AnalyticsEvents.BADGE_CLEARED);
    }
  }, [count]);
}
