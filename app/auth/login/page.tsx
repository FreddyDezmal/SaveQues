"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { trackEvent, identifyUser, AnalyticsEvents } from "@/lib/analytics";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const isLocked = attempts >= 5;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (isLocked) return;
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);

      trackEvent(AnalyticsEvents.LOGIN_FAILED, {
        error_message: error.message,
        attempt_number: newAttempts,
      });

      if (newAttempts >= 5) {
        setError("Too many attempts. Please reset your password or wait a few minutes.");
      } else if (error.message.toLowerCase().includes("email not confirmed")) {
        setError("Please verify your email first. Check your inbox for a confirmation link.");
      } else {
        // Show the real error — do not replace with a generic message.
        // Common real errors: "Invalid login credentials", rate limiting, etc.
        setError(error.message);
      }
      setLoading(false);
    } else {
      // Identify user on successful login
      if (data.user) {
        identifyUser(data.user.id);
        trackEvent(AnalyticsEvents.LOGIN_SUCCESS);
      }
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">⚡</div>
          <h1 className="font-display text-3xl font-bold text-gradient-brand">SaveQuest</h1>
          <p className="text-white/40 text-sm mt-1">Level up your savings</p>
        </div>

        {reason === "session_expired" && (
          <div className="bg-surface-elevated border border-surface-border rounded-xl px-4 py-3 text-white/50 text-sm mb-4 text-center">
            Your session ended — sign back in to continue.
          </div>
        )}

        {reason === "confirmation_failed" && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm mb-4 text-center">
            Your confirmation link has expired or already been used. Please sign in and request a new one.
          </div>
        )}

        <div className="card p-6">
          <h2 className="font-display text-xl font-semibold mb-6">Welcome back</h2>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-white/60 mb-1.5">Email</label>
              <input
                type="email"
                className="input-field"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm text-white/60">Password</label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                {error}
                {attempts >= 3 && (
                  <div className="mt-1.5">
                    <Link href="/auth/forgot-password" className="text-brand-400 underline text-xs">
                      Reset your password →
                    </Link>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary w-full mt-2"
              disabled={loading || isLocked}
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-white/40 text-sm mt-6">
          New here?{" "}
          <Link href="/auth/signup" className="text-brand-400 hover:text-brand-300 transition-colors">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}