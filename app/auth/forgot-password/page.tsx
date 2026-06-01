"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) {
      setError("Something went wrong. Please try again.");
    } else {
      setSent(true);
    }
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-4">📬</div>
          <h1 className="font-display text-2xl font-bold text-white mb-2">Check your inbox</h1>
          <p className="text-white/50 text-sm mb-6">
            We sent a reset link to <span className="text-white/80">{email}</span>.
            It expires in 1 hour.
          </p>
          <p className="text-white/30 text-xs mb-6">
            No email? Check your spam folder, or{" "}
            <button
              onClick={() => setSent(false)}
              className="text-brand-400 hover:text-brand-300 underline"
            >
              try again
            </button>
            .
          </p>
          <Link href="/auth/login" className="text-brand-400 text-sm hover:text-brand-300 transition-colors">
            ← Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">⚡</div>
          <h1 className="font-display text-3xl font-bold text-gradient-brand">SaveQuest</h1>
        </div>

        <div className="card p-6">
          <Link href="/auth/login" className="flex items-center gap-1.5 text-white/40 hover:text-white/60 transition-colors text-sm mb-5">
            <ArrowLeft size={14} /> Back to sign in
          </Link>

          <h2 className="font-display text-xl font-semibold text-white mb-1">Forgot your password?</h2>
          <p className="text-white/40 text-sm mb-5">
            No problem. Enter your email and we'll send you a reset link.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-white/60 mb-1.5">Email address</label>
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

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}