"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle, XCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);

  useEffect(() => {
    // Supabase exchanges the token from the URL hash automatically
    const supabase = createClient();
    supabase.auth.onAuthStateChange(async (event) => {
      if (event === "PASSWORD_RECOVERY") {
        setSessionReady(true);
      }
    });

    // If no session after 3s, token is likely expired/invalid
    const timeout = setTimeout(() => {
      if (!sessionReady) setInvalidToken(true);
    }, 3000);

    return () => clearTimeout(timeout);
  }, [sessionReady]);

  function getPasswordStrength(pw: string): { label: string; color: string; score: number } {
    let score = 0;
    if (pw.length >= 8)  score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 1) return { label: "Weak",   color: "#ef4444", score };
    if (score <= 3) return { label: "Fair",   color: "#f97316", score };
    if (score <= 4) return { label: "Strong", color: "#10b981", score };
    return                { label: "Great",  color: "#ffb800", score };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (password.length < 8)  { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setTimeout(() => router.push("/dashboard"), 2500);
    }
  }

  const strength = getPasswordStrength(password);

  if (invalidToken) {
    return (
      <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-4">🔗</div>
          <h1 className="font-display text-2xl font-bold text-white mb-2">Link expired</h1>
          <p className="text-white/50 text-sm mb-6">
            Password reset links expire after 1 hour for your security. Request a new one and try again.
          </p>
          <Link href="/auth/forgot-password" className="btn-primary inline-block px-6">
            Get a new link
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <CheckCircle size={56} className="text-emerald-400 mx-auto mb-4" />
          <h1 className="font-display text-2xl font-bold text-white mb-2">Password updated</h1>
          <p className="text-white/50 text-sm">Taking you back to SaveQuest…</p>
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
          <h2 className="font-display text-xl font-semibold text-white mb-1">Set a new password</h2>
          <p className="text-white/40 text-sm mb-5">Choose something you haven't used before.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-white/60 mb-1.5">New password</label>
              <input
                type="password"
                className="input-field"
                placeholder="Min. 8 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              {password.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1,2,3,4,5].map(i => (
                      <div
                        key={i}
                        className="h-1 flex-1 rounded-full transition-all duration-300"
                        style={{ backgroundColor: i <= strength.score ? strength.color : "#2a2a38" }}
                      />
                    ))}
                  </div>
                  <p className="text-xs" style={{ color: strength.color }}>{strength.label}</p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-1.5">Confirm password</label>
              <input
                type="password"
                className="input-field"
                placeholder="Repeat your password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
              {confirm.length > 0 && password !== confirm && (
                <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
                  <XCircle size={12} /> Passwords don't match
                </p>
              )}
              {confirm.length > 0 && password === confirm && (
                <p className="text-xs text-emerald-400 mt-1.5 flex items-center gap-1">
                  <CheckCircle size={12} /> Passwords match
                </p>
              )}
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={loading || !sessionReady || password !== confirm || password.length < 8}
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}