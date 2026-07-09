"use client";

/**
 * components/pwa/InstallSuccessCelebration.tsx
 *
 * Mounted at the root layout (not just the dashboard, where
 * InstallSaveQuestCard lives) specifically so `usePWAInstall`'s
 * `appinstalled` listener is active regardless of which page the user
 * happens to be on when they install — e.g. via the browser's own omnibox
 * icon rather than our custom card. This incidentally closes a limitation
 * flagged during Sprint 15 review (PWA_INSTALLED tracking only fired while
 * the dashboard card was mounted); worth noting since it wasn't the
 * primary goal of this component, but is a real, positive side effect.
 *
 * "Never display again" is enforced via localStorage, keyed globally (not
 * per-user) since this is about the BROWSER/device's install state, not
 * the account — the same device could later be used to install for a
 * different SaveQuest account, and re-celebrating in that case is
 * arguably correct, but re-celebrating every time the SAME account
 * re-installs on the SAME device is not something worth engineering
 * around for a one-time congratulatory modal.
 */

import { useEffect, useState } from "react";
import { PartyPopper, X } from "lucide-react";
import { usePWAInstall } from "@/lib/hooks/usePWAInstall";
import { useHaptics } from "@/lib/hooks/useHaptics";

const STORAGE_KEY = "sq_install_celebrated";

export default function InstallSuccessCelebration() {
  const { justInstalled } = usePWAInstall();
  const [visible, setVisible] = useState(false);
  const { vibrate } = useHaptics();

  useEffect(() => {
    if (!justInstalled) return;
    let alreadyCelebrated = false;
    try {
      alreadyCelebrated = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {}
    if (!alreadyCelebrated) {
      setVisible(true);
      vibrate("success");
    }
  }, [justInstalled, vibrate]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-sm rounded-2xl bg-surface-elevated border border-brand-500/20 p-6 text-center animate-fade-in">
        <button
          onClick={dismiss}
          className="absolute top-4 right-4 text-white/30 hover:text-white/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-lg"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>

        <div className="w-14 h-14 rounded-2xl bg-brand-500/15 flex items-center justify-center mx-auto mb-4">
          <PartyPopper size={26} className="text-brand-400" />
        </div>

        <h2 className="font-display text-xl font-bold text-white mb-2">SaveQuest Installed! 🎉</h2>
        <p className="text-sm text-white/60 mb-6">
          You&apos;re now using SaveQuest like a native app. Launch it anytime from your home screen —
          faster, full-screen, and ready even with a spotty connection.
        </p>

        <button
          onClick={dismiss}
          className="btn-primary w-full focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
