"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="text-6xl mb-4">🔧</div>
        <h1 className="font-display text-2xl font-bold text-white mb-2">Something went wrong</h1>
        <p className="text-white/50 text-sm mb-6">
          Our servers had a moment. Your progress is saved — please try again.
        </p>
        <button onClick={reset} className="btn-primary px-6">
          Try again
        </button>
      </div>
    </div>
  );
}