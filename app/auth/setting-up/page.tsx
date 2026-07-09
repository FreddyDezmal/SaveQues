"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_ATTEMPTS = 10;
const RETRY_MS     = 1200;

export default function SettingUpPage() {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [failed,  setFailed]  = useState(false);

  useEffect(() => {
    if (attempt >= MAX_ATTEMPTS) {
      setFailed(true);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res  = await fetch("/api/auth/profile-ready");
        const json = await res.json();
        if (json.ready) {
          router.replace("/dashboard");
          return;
        }
      } catch {
        // Network error — keep retrying
      }
      setAttempt(a => a + 1);
    }, RETRY_MS);

    return () => clearTimeout(timer);
  }, [attempt, router]);

  if (failed) {
    return (
      <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h1 className="font-display text-xl font-bold text-white mb-2">Taking longer than expected</h1>
          <p className="text-white/50 text-sm mb-6">
            Your account was created but we&apos;re having trouble loading your dashboard.
          </p>
          <button
            onClick={() => { setFailed(false); setAttempt(0); }}
            className="btn-primary w-full"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="text-5xl mb-4 animate-pulse">⚡</div>
        <h1 className="font-display text-2xl font-bold text-gradient-brand mb-2">
          Setting up your quest…
        </h1>
        <p className="text-white/50 text-sm">
          Just a moment while we prepare your dashboard.
        </p>
        <div className="flex justify-center gap-1.5 mt-6">
          {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                i < attempt ? "bg-brand-500" : "bg-surface-border"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}