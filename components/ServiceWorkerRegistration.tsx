"use client";

import { useEffect } from "react";

/**
 * Registers the service worker unconditionally on every page load.
 *
 * Sprint 14 gap this closes: previously, /sw.js was ONLY registered inside
 * lib/hooks/useNotifications.ts's subscribe() flow — meaning a user who
 * never opted into push notifications never got a service worker at all,
 * which meant no install-prompt eligibility and no offline fallback for
 * the vast majority of users.
 *
 * This component owns SW *registration* only. It intentionally does nothing
 * else — no push subscription, no permission prompts. useNotifications.ts
 * keeps full ownership of the push subscription lifecycle; its own
 * navigator.serviceWorker.register() call becomes a harmless no-op once
 * this component has already registered the SW (registering an
 * already-registered SW at the same scope just resolves with the existing
 * registration, per spec), so no changes to that file are required.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      // Non-fatal by design: the app must remain fully usable without a
      // service worker. Losing install/offline support is acceptable;
      // breaking navigation is not.
      console.error("[SaveQuest] Service worker registration failed:", err);
    });
  }, []);

  return null;
}
