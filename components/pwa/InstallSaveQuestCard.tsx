"use client";

/**
 * components/pwa/InstallSaveQuestCard.tsx
 *
 * First-class install prompt. Mirrors the existing
 * components/onboarding/NotificationPromptBanner.tsx pattern deliberately —
 * same dismissal mechanics (localStorage, keyed per user), same visual
 * language, same trackEvent usage — so this reads as a natural extension of
 * the app rather than a bolted-on component.
 *
 * Renders nothing when:
 *   - the browser never fired beforeinstallprompt (Safari, Firefox — see
 *     usePWAInstall.ts for why there's no workaround for this)
 *   - the app is already installed
 *   - the user dismissed it before (persisted per-user in localStorage)
 */

import { useEffect, useState } from "react";
import { Download, X, Zap, WifiOff, Bell } from "lucide-react";
import { usePWAInstall } from "@/lib/hooks/usePWAInstall";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";

interface Props {
  userId: string;
}

function localDismissKey(userId: string) {
  return `sq_install_dismissed_${userId}`;
}

function isDismissedLocally(userId: string): boolean {
  try {
    return localStorage.getItem(localDismissKey(userId)) === "1";
  } catch {
    return false;
  }
}

function markDismissedLocally(userId: string) {
  try {
    localStorage.setItem(localDismissKey(userId), "1");
  } catch {}
}

export default function InstallSaveQuestCard({ userId }: Props) {
  const { canInstall, isInstalled, promptInstall } = usePWAInstall();
  const [dismissed, setDismissed] = useState(true); // default hidden until localStorage check resolves, avoids a flash
  const [shownTracked, setShownTracked] = useState(false);

  useEffect(() => {
    setDismissed(isDismissedLocally(userId));
  }, [userId]);

  const visible = canInstall && !isInstalled && !dismissed;

  useEffect(() => {
    if (visible && !shownTracked) {
      setShownTracked(true);
      trackEvent(AnalyticsEvents.PWA_INSTALL_PROMPT_SHOWN);
    }
  }, [visible, shownTracked]);

  if (!visible) return null;

  async function handleInstall() {
    trackEvent(AnalyticsEvents.PWA_INSTALL_PROMPT_ACCEPTED);
    const outcome = await promptInstall();
    // "accepted" also gets confirmed separately via the `appinstalled`
    // window event (see usePWAInstall) which fires PWA_INSTALLED — this
    // event captures the *prompt* choice, not proof of a completed install.
    if (outcome === "dismissed") {
      markDismissedLocally(userId);
      setDismissed(true);
    }
  }

  function handleDismiss() {
    setDismissed(true);
    markDismissedLocally(userId);
    trackEvent(AnalyticsEvents.PWA_INSTALL_PROMPT_DISMISSED);
  }

  return (
    <div className="mb-4 p-4 rounded-2xl bg-surface-elevated border border-brand-500/20">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-brand-500/15 flex items-center justify-center flex-shrink-0">
          <Download size={20} className="text-brand-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Install SaveQuest</p>
          <p className="text-xs text-white/50 mt-0.5">
            Get the full-screen app experience — faster loads, offline access, and reminders.
          </p>

          <ul className="mt-3 space-y-1.5">
            <li className="flex items-center gap-2 text-xs text-white/60">
              <Zap size={13} className="text-brand-400 flex-shrink-0" /> Opens instantly from your home screen
            </li>
            <li className="flex items-center gap-2 text-xs text-white/60">
              <WifiOff size={13} className="text-brand-400 flex-shrink-0" /> Browse goals and quests offline
            </li>
            <li className="flex items-center gap-2 text-xs text-white/60">
              <Bell size={13} className="text-brand-400 flex-shrink-0" /> Streak and goal reminders
            </li>
          </ul>

          <div className="flex gap-2 mt-3.5">
            <button
              onClick={handleInstall}
              className="btn-primary text-xs py-1.5 px-3 focus-visible:ring-2 focus-visible:ring-brand-500/50"
            >
              Install
            </button>
            <button
              onClick={handleDismiss}
              className="text-xs text-white/40 hover:text-white/60 transition-colors py-1.5 px-2"
            >
              Not now
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
    </div>
  );
}
