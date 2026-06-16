"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { trackEvent, identifyUser, AnalyticsEvents } from "@/lib/analytics";

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Onboarding question
  const [savingFor, setSavingFor] = useState("");
  const options = [
    { id: "emergency", label: "Emergency Fund", icon: "🛡️" },
    { id: "travel",    label: "Travel",          icon: "✈️" },
    { id: "gadget",    label: "Gadget",          icon: "💻" },
    { id: "tuition",   label: "Education",       icon: "🎓" },
    { id: "custom",    label: "Something Else",  icon: "⭐" },
  ];

  // Track signup_started once when the page first loads
  useEffect(() => {
    trackEvent(AnalyticsEvents.SIGNUP_STARTED);
  }, []);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (step === 1) { setStep(2); return; }
    if (step === 2 && !savingFor) { setError("Pick what you're saving for!"); return; }
    if (step === 2) { setStep(3); return; }

    setLoading(true);
    setError("");
    const supabase = createClient();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Track successful signup and identify the new user
    if (data.user) {
      trackEvent(AnalyticsEvents.SIGNUP_COMPLETED, {
        saving_for: savingFor,
      });
      identifyUser(data.user.id, {
        display_name: displayName,
        saving_for:   savingFor,
        created_at:   new Date().toISOString(),
      });

      // Auto-create starter goal — fire-and-forget, never blocks navigation
      fetch("/api/onboarding/starter-goal", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ saving_for: savingFor }),
      }).catch(() => { /* goal creation failure must not affect signup */ });
    }

    // If Supabase email confirmation is ON:
    //   data.session will be null — route to verify-email.
    // If email confirmation is OFF:
    //   data.session is set — route straight to dashboard.
    if (data.session) {
      router.push("/dashboard");
      router.refresh();
    } else {
      router.push("/auth/verify-email");
    }
  }

  return (
    <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">⚡</div>
          <h1 className="font-display text-3xl font-bold text-gradient-brand">SaveQuest</h1>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {[1, 2, 3].map(s => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                s === step ? "w-8 bg-brand-500" : s < step ? "w-4 bg-brand-700" : "w-4 bg-surface-border"
              }`}
            />
          ))}
        </div>

        <div className="card p-6">
          <form onSubmit={handleSignup}>
            {step === 1 && (
              <>
                <h2 className="font-display text-xl font-semibold mb-1">What should we call you?</h2>
                <p className="text-white/40 text-sm mb-6">Your quest name</p>
                <input
                  className="input-field mb-4"
                  placeholder="e.g. Alex the Saver"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  required
                />
                <button type="submit" className="btn-primary w-full">
                  Continue →
                </button>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="font-display text-xl font-semibold mb-1">What are you saving for?</h2>
                <p className="text-white/40 text-sm mb-5">We'll set up your first goal</p>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  {options.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => { setSavingFor(opt.id); setError(""); }}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200 ${
                        savingFor === opt.id
                          ? "border-brand-500 bg-brand-500/10 text-brand-400"
                          : "border-surface-border bg-surface-elevated text-white/60 hover:border-surface-border/80"
                      }`}
                    >
                      <span className="text-2xl">{opt.icon}</span>
                      <span className="text-xs font-medium">{opt.label}</span>
                    </button>
                  ))}
                </div>
                {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
                <button type="submit" className="btn-primary w-full">
                  Continue →
                </button>
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="font-display text-xl font-semibold mb-1">Create your account</h2>
                <p className="text-white/40 text-sm mb-5">Almost there, {displayName}!</p>
                <div className="space-y-3 mb-4">
                  <input
                    type="email"
                    className="input-field"
                    placeholder="Email address"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                  <input
                    type="password"
                    className="input-field"
                    placeholder="Password (min 6 chars)"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                </div>
                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm mb-3">
                    {error}
                  </div>
                )}
                <button type="submit" className="btn-primary w-full" disabled={loading}>
                  {loading ? "Creating account…" : "Start My Quest 🚀"}
                </button>
              </>
            )}
          </form>
        </div>

        <p className="text-center text-white/40 text-sm mt-6">
          Already have an account?{" "}
          <Link href="/auth/login" className="text-brand-400 hover:text-brand-300 transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
