"use client";

import { useEffect, useState } from "react";

/**
 * Tracks browser online/offline state via the `online`/`offline` window
 * events, which fire reliably for connectivity transitions in all target
 * browsers (Chrome, Safari, Edge, Firefox — desktop and mobile).
 *
 * Sprint 14 financial-safety rule this hook exists to support: deposits and
 * withdrawals must NEVER be queued or executed while offline (see Phase 4 of
 * the Sprint 14 guide for the full reasoning — in short, a queued mutation
 * would be validated against stale client-side state, which conflicts with
 * the server-side concurrency and overdraft-protection guarantees already
 * shipped in prior sprints). This hook is what lets financial UI disable
 * itself accurately instead of guessing from a failed fetch after the fact.
 */
export function useOnlineStatus(): boolean {
  // Default to true on the server / before mount so SSR output doesn't
  // flash a "you're offline" state for users who are actually online —
  // navigator.onLine is only trustworthy once we're in the browser.
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return isOnline;
}
