"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw, LayoutDashboard } from "lucide-react";

export default function OfflinePage() {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  function handleRetry() {
    setRetrying(true);
    // A full reload (not router.refresh()) so a real network request is
    // attempted — this is what actually tells us whether connectivity is
    // back, rather than re-rendering cached client state.
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center p-4">
      <div className="max-w-sm text-center">
        {/* Simple inline illustration — no image asset dependency, so this
            page works even when nothing beyond the SW's own precached
            shell is available. */}
        <svg width="120" height="120" viewBox="0 0 120 120" className="mx-auto mb-4" aria-hidden="true">
          <circle cx="60" cy="60" r="56" fill="var(--color-surface-elevated)" />
          <path
            d="M35 50c14-14 36-14 50 0M43 62c9-9 25-9 34 0M52 74c4-4 12-4 16 0"
            stroke="var(--color-brand)"
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
            opacity="0.5"
          />
          <line x1="30" y1="30" x2="90" y2="90" stroke="var(--color-brand)" strokeWidth="4" strokeLinecap="round" />
          <circle cx="60" cy="88" r="3.5" fill="var(--color-brand)" />
        </svg>

        <h1 className="font-display text-2xl font-bold text-white mb-2">No connection</h1>
        <p className="text-white/50 text-sm mb-6">
          SaveQuest needs an internet connection to sync your progress. Your data is safe —
          we&apos;ll pick up right where you left off.
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="btn-primary px-6 flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <RefreshCw size={15} className={retrying ? "animate-spin" : ""} />
            {retrying ? "Checking…" : "Try again"}
          </button>
          <button
            onClick={() => router.push("/dashboard")}
            className="btn-ghost px-6 flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <LayoutDashboard size={15} />
            Go to dashboard
          </button>
        </div>

        <p className="text-white/30 text-xs mt-5">
          Deposits and withdrawals are always blocked while offline, even on cached pages —
          this keeps your balance accurate.
        </p>
      </div>
    </div>
  );
}