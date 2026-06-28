"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * /auth/setting-up
 *
 * Shown when the dashboard RPC returns "profile not found" — which happens
 * for brand-new users when the auth callback redirect and the dashboard page
 * load race against the handle_new_user trigger completing.
 *
 * Retries /dashboard every 1.5 seconds (up to 8 attempts = 12 seconds).
 * In practice the profile is always ready within 1–2 retries.
 */
const MAX_ATTEMPTS = 8;
const RETRY_MS     = 1500;

export default function SettingUpPage() {
  const router   = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [failed,  setFailed]  = useState(false);

  useEffect(() => {
    if (attempt >= MAX_ATTEMPTS) {
      setFailed(true);
      return;
    }

    const timer = setTimeout(async () => {
      // Ping the dashboard — if it returns 200 the profile is ready
      try {
        const res = await fetch("/dashboard", { method: "HEAD", redirect: "manual" });
        // A redirect (3xx) or 200 means Next.js rendered it without throwing
        if (res.ok || res.type === "opaqueredirect" || res.status < 400) {
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
            Your account was created but we're having trouble loading your dashboard.
          </p>
          <button
            onClick={() => router.replace("/dashboard")}
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
        {/* Progress dots */}
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