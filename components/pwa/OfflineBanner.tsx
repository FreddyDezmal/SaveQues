"use client";

/**
 * components/pwa/OfflineBanner.tsx
 *
 * App-wide, always-mounted offline indicator. This is a different UX layer
 * than the contextual "you're offline" message already inside
 * GoalDetailClient's deposit form (Sprint 14) — that one explains why a
 * specific button is disabled, right where the user is about to tap it;
 * this one gives a persistent, ambient signal across every page so the
 * user isn't confused about why the app feels "stuck" on old data whatever
 * screen they're on. The two are complementary, not duplicate.
 */

import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { useLastSyncedAt, formatRelativeTime } from "@/lib/hooks/useLastSyncedAt";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";

export default function OfflineBanner() {
  const { isOnline, lastSyncedAt } = useLastSyncedAt();
  const [reconnectedVisible, setReconnectedVisible] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const [, forceTick] = useState(0);

  // Re-render once a minute so the "Xm ago" text stays accurate without
  // needing a full timer library for something this low-stakes.
  useEffect(() => {
    if (isOnline) return;
    const id = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
      trackEvent(AnalyticsEvents.OFFLINE_SESSION_STARTED);
    } else if (wasOffline) {
      // Transitioned offline -> online during this session.
      setWasOffline(false);
      setReconnectedVisible(true);
      trackEvent(AnalyticsEvents.OFFLINE_SESSION_ENDED);
      const t = setTimeout(() => setReconnectedVisible(false), 3000);
      return () => clearTimeout(t);
    }
  }, [isOnline, wasOffline]);

  if (isOnline && !reconnectedVisible) return null;

  if (reconnectedVisible) {
    return (
      <div
        role="status"
        className="fixed top-16 left-4 right-4 z-40 mx-auto max-w-sm rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-4 py-2.5 flex items-center gap-2 animate-fade-in"
      >
        <Wifi size={15} className="text-emerald-400 flex-shrink-0" />
        <p className="text-xs font-medium text-emerald-300">Back online — synced up</p>
      </div>
    );
  }

  return (
    <div
      role="status"
      // Sprint 16, Phase 9: uses the shared --app-header-height variable
      // (globals.css) rather than repeating AppHeader's calc() here —
      // the earlier version of this comment described exactly the drift
      // risk that a shared variable, not a comment, actually solves.
      style={{ top: "var(--app-header-height)" }}
      className="sticky z-30 w-full bg-amber-500/15 border-b border-amber-500/25 px-4 py-2 flex items-center justify-center gap-2"
    >
      <WifiOff size={13} className="text-amber-400 flex-shrink-0" />
      <p className="text-xs text-amber-300">
        You're offline
        {lastSyncedAt && <span className="text-amber-300/60"> · last synced {formatRelativeTime(lastSyncedAt)}</span>}
      </p>
    </div>
  );
}
