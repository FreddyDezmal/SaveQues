"use client";

/**
 * components/onboarding/NotificationPromptBanner.tsx
 *
 * Shown once after the user completes their first deposit OR first daily quest.
 * Dismissed state is persisted in localStorage (keyed by userId) and also
 * written to profiles.notification_prompt_dismissed via a lightweight PATCH.
 *
 * Tracks:
 *   NOTIFICATION_PROMPT_SHOWN
 *   NOTIFICATION_PROMPT_ACCEPTED
 *   NOTIFICATION_PROMPT_DISMISSED
 */

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";

interface Props {
  userId:                     string;
  hasCompletedFirstDeposit:   boolean;
  hasCompletedFirstQuest:     boolean;
  /** Server-authoritative dismiss flag; prevents flash for returning users */
  alreadyDismissed:           boolean;
}

function localDismissKey(userId: string) {
  return `sq_notif_prompt_${userId}`;
}

function isDismissedLocally(userId: string): boolean {
  try {
    return localStorage.getItem(localDismissKey(userId)) === "1";
  } catch {
    return false;
  }
}

function markDismissedLocally(userId: string) {
  try { localStorage.setItem(localDismissKey(userId), "1"); } catch {}
}

async function persistDismissToServer() {
  try {
    await fetch("/api/onboarding/dismiss-notification-prompt", { method: "POST" });
  } catch { /* fire-and-forget */ }
}

export default function NotificationPromptBanner({
  userId,
  hasCompletedFirstDeposit,
  hasCompletedFirstQuest,
  alreadyDismissed,
}: Props) {
  const shouldShow = hasCompletedFirstDeposit || hasCompletedFirstQuest;

  const [visible, setVisible] = useState(false);
  const [shownTracked, setShownTracked] = useState(false);

  useEffect(() => {
    if (!shouldShow) return;
    if (alreadyDismissed) return;
    if (isDismissedLocally(userId)) return;
    setVisible(true);
  }, [shouldShow, alreadyDismissed, userId]);

  // Track shown once when banner becomes visible
  useEffect(() => {
    if (visible && !shownTracked) {
      setShownTracked(true);
      trackEvent(AnalyticsEvents.NOTIFICATION_PROMPT_SHOWN);
    }
  }, [visible, shownTracked]);

  if (!visible) return null;

  function handleDismiss() {
    setVisible(false);
    markDismissedLocally(userId);
    persistDismissToServer();
    trackEvent(AnalyticsEvents.NOTIFICATION_PROMPT_DISMISSED);
  }

  function handleAccept() {
    setVisible(false);
    markDismissedLocally(userId);
    persistDismissToServer();
    trackEvent(AnalyticsEvents.NOTIFICATION_PROMPT_ACCEPTED);
    // Attempt to trigger web push permission request
    // The existing useNotifications hook manages the actual subscription
    if ("Notification" in window) {
      Notification.requestPermission().catch(() => {});
    }
  }

  return (
    <div className="mb-4 px-4 py-3.5 rounded-xl bg-surface-elevated border border-brand-500/20 flex items-start gap-3">
      <Bell size={18} className="text-brand-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">
          Want help keeping your streak alive? 🔥
        </p>
        <div className="flex gap-2 mt-2.5">
          <button
            onClick={handleAccept}
            className="btn-primary text-xs py-1.5 px-3"
          >
            Enable notifications
          </button>
          <button
            onClick={handleDismiss}
            className="text-xs text-white/40 hover:text-white/60 transition-colors py-1.5 px-2"
          >
            Maybe later
          </button>
        </div>
      </div>
      <button
        onClick={handleDismiss}
        className="text-white/20 hover:text-white/50 transition-colors flex-shrink-0"
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
    </div>
  );
}