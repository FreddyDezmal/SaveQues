"use client";

import { useEffect, useState, useCallback } from "react";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";

/**
 * Captures the browser's `beforeinstallprompt` event (Chrome/Edge on Android
 * and Desktop) so a custom install UI can trigger it on demand, and tracks
 * whether the app is already running in standalone/installed mode.
 *
 * Browser support reality, stated plainly:
 *   - Chrome/Edge (Android + Desktop): fires `beforeinstallprompt`. This is
 *     the only path where a custom "Install" button can trigger the native
 *     install dialog programmatically.
 *   - Safari (iOS/macOS) and Firefox: never fire this event. There is no
 *     API to detect install eligibility or trigger install on these
 *     browsers — install is manual (Share → Add to Home Screen on iOS).
 *     `canInstall` will simply stay `false` there, which is the correct,
 *     honest state — the UI is expected to render nothing rather than a
 *     broken or misleading button.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface UsePWAInstallReturn {
  /** True only when the browser has fired beforeinstallprompt and it hasn't been used/dismissed yet. */
  canInstall: boolean;
  /** True if the app is already running installed (standalone display mode). */
  isInstalled: boolean;
  /**
   * True only in the exact browser session where the `appinstalled` event
   * just fired — i.e. an install that happened THIS session, not "was
   * already installed before this page load." Sprint 16's
   * InstallSuccessCelebration relies on this distinction specifically:
   * isInstalled alone would be true on every subsequent launch of an
   * already-installed app, which would wrongly re-trigger a "just
   * installed!" celebration on every normal open.
   */
  justInstalled: boolean;
  /** Triggers the native install dialog. Resolves with the user's choice. */
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // Covers Chrome/Edge/Android ("standalone" display-mode media query) and
  // iOS Safari's older non-standard navigator.standalone flag.
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

export function usePWAInstall(): UsePWAInstallReturn {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);

  useEffect(() => {
    setIsInstalled(detectStandalone());

    function handleBeforeInstallPrompt(e: Event) {
      // Prevent the browser's default mini-infobar so we control timing
      // and presentation via InstallSaveQuestCard instead.
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setIsInstalled(true);
      setJustInstalled(true);
      setDeferredEvent(null);
      // Fired here (not in the card component) so it's captured regardless
      // of whether install happened via our custom card or the browser's
      // own install affordance (e.g. Chrome's omnibox icon).
      trackEvent(AnalyticsEvents.PWA_INSTALLED);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!deferredEvent) return "unavailable";
    await deferredEvent.prompt();
    const { outcome } = await deferredEvent.userChoice;
    // The captured event can only be used once per browser spec.
    setDeferredEvent(null);
    return outcome;
  }, [deferredEvent]);

  return {
    canInstall: deferredEvent !== null && !isInstalled,
    isInstalled,
    justInstalled,
    promptInstall,
  };
}
