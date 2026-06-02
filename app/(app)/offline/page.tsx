"use client";

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center p-4">
      <div className="max-w-sm text-center">
        <div className="text-6xl mb-4">📡</div>
        <h1 className="font-display text-2xl font-bold text-white mb-2">No connection</h1>
        <p className="text-white/50 text-sm mb-6">
          SaveQuest needs an internet connection to sync your progress. Your data is safe — we'll pick up where you left off.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="btn-ghost px-6"
        >
          Try again
        </button>
      </div>
    </div>
  );
}