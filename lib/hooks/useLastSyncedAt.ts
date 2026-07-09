"use client";

import { useEffect, useState } from "react";
import { useOnlineStatus } from "./useOnlineStatus";

const STORAGE_KEY = "sq_last_synced_at";

function readLastSynced(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function writeLastSynced(ts: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(ts));
  } catch {}
}

/**
 * Tracks the most recent timestamp at which the app was confirmed online,
 * so the offline banner can show "Last synced 4m ago" instead of a bare
 * "you're offline" with no sense of how stale things might be.
 *
 * Deliberately simple: this is a UX nicety, not a sync-correctness
 * mechanism. It just means "the browser last reported navigator.onLine ===
 * true at this time" — it says nothing about whether any particular piece
 * of data was actually refetched at that moment. That distinction doesn't
 * matter for its one job (giving the user a rough sense of staleness).
 */
export function useLastSyncedAt(): { lastSyncedAt: number | null; isOnline: boolean } {
  const isOnline = useOnlineStatus();
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    setLastSyncedAt(readLastSynced());
  }, []);

  useEffect(() => {
    if (isOnline) {
      const now = Date.now();
      writeLastSynced(now);
      setLastSyncedAt(now);
    }
  }, [isOnline]);

  return { lastSyncedAt, isOnline };
}

// Sprint 17: this was a byte-for-byte duplicate of NotificationCenter.tsx's
// local timeAgo() — consolidated into lib/utils.ts's timeAgo(). Re-exported
// under the original name here so OfflineBanner.tsx's existing
// `import { formatRelativeTime } from "@/lib/hooks/useLastSyncedAt"` keeps
// working with zero changes at that call site.
export { timeAgo as formatRelativeTime } from "@/lib/utils";
