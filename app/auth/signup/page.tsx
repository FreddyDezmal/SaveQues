"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { trackEvent, identifyUser, AnalyticsEvents } from "@/lib/analytics";
import { getPendingInviteCookie } from "@/lib/pendingInvite";
import { slugifyForUsername } from "@/lib/username";

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
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

  // Auto-suggest a username from the display name until the person types
  // their own — matches lib/username.ts's slugify rules (same 3-20 char,
  // [A-Za-z0-9_] format the DB constraint and backfill also use) so the
  // suggestion is never rejected by the very check that validates it.
  useEffect(() => {
    if (usernameTouched) return;
    setUsername(slugifyForUsername(displayName));
  }, [displayName, usernameTouched]);

  // Debounced live availability check.
  useEffect(() => {
    if (!username) { setUsernameStatus("idle"); return; }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) { setUsernameStatus("invalid"); return; }

    setUsernameStatus("checking");
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/profile/username-available?username=${encodeURIComponent(username)}`);
        const body = await res.json();
        setUsernameStatus(body.available ? "available" : "taken");
      } catch {
        setUsernameStatus("idle"); // don't block the form on a flaky check — final say is the real API call
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [username]);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (step === 1) {
      if (usernameStatus !== "available") {
        setError(usernameStatus === "taken" ? "That username is taken — try another." : "Pick a valid username to continue.");
        return;
      }
      setError("");
      setStep(2);
      return;
    }
    if (step === 2 && !savingFor) { setError("Pick what you're saving for!"); return; }
    if (step === 2) { setStep(3); return; }

    setLoading(true);
    setError("");
    const supabase = createClient();

    console.log("[signup] attempting signUp for:", email);

    // Sprint 22.5: if the visitor arrived here from /invite/{token}, thread
    // it through the ALREADY-EXISTING `next` param that /auth/callback
    // reads (see that file's own header) — this covers the email-
    // confirmation-required path. See lib/pendingInvite.ts for why a
    // cookie carries this rather than the URL: this page doesn't receive
    // its own query params from /invite/{token} today, and adding that
    // would mean threading a param through every intermediate step of
    // this 3-step wizard — a cookie is the smaller, existing-pattern-
    // compatible change.
    const pendingInviteToken = getPendingInviteCookie();
    const emailRedirectTo = pendingInviteToken
      ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(`/invite/${pendingInviteToken}`)}`
      : `${window.location.origin}/auth/callback`;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName, saving_for: savingFor, username },
        emailRedirectTo,
      },
    });

    console.log("[signup] result:", { data, error });

    if (error) {
      console.error("[signup] error:", error.message, error);
      setError(error.message);
      setLoading(false);
      return;
    }

    if (!data.user) {
      console.error("[signup] no user returned, data:", data);
      setError("Signup failed — please try again.");
      setLoading(false);
      return;
    }

    console.log("[signup] success, user:", data.user.id, "session:", !!data.session);

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

      // Starter goal is created in /auth/callback after the session is guaranteed.
      // (When email confirm is OFF, session is live here; callback still handles it
      //  idempotently via onboarding_goal_created flag.)
    }

    // If Supabase email confirmation is ON:
    //   data.session will be null — route to verify-email. Username is
    //   applied in /auth/callback once the session exists (mirrors the
    //   starter-goal pattern in that file).
    // If email confirmation is OFF:
    //   data.session is set — apply the username directly here, since this
    //   path never touches /auth/callback at all (the same gap Sprint 22.5
    //   found and worked around for invite continuation). A username lost
    //   to a race against another signup in the last few minutes doesn't
    //   block account creation — it's just left unset and can be picked
    //   again from Settings.
    if (data.session) {
      try {
        await fetch("/api/profile/username", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username }),
        });
      } catch {
        // non-fatal — see comment above
      }
      router.push(pendingInviteToken ? `/invite/${pendingInviteToken}` : "/dashboard");
      router.refresh();
    } else {
      router.push(`/auth/verify-email?email=${encodeURIComponent(email)}`);
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

                <label htmlFor="username" className="block text-xs font-medium text-white/50 mb-1.5">
                  Username <span className="text-white/30">— how friends find you</span>
                </label>
                <div className="relative mb-1">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 text-sm pointer-events-none">@</span>
                  <input
                    id="username"
                    className="input-field pl-7"
                    placeholder="username"
                    value={username}
                    onChange={e => { setUsernameTouched(true); setUsername(e.target.value.trim()); }}
                    aria-describedby="username-status"
                    aria-invalid={usernameStatus === "taken" || usernameStatus === "invalid"}
                    required
                  />
                </div>
                <p id="username-status" className="text-xs mb-4 h-4" role="status">
                  {usernameStatus === "checking" && <span className="text-white/40">Checking…</span>}
                  {usernameStatus === "available" && <span className="text-emerald-400">✓ Available</span>}
                  {usernameStatus === "taken" && <span className="text-red-400">Already taken — try another</span>}
                  {usernameStatus === "invalid" && username.length > 0 && (
                    <span className="text-red-400">3-20 characters: letters, numbers, underscores only</span>
                  )}
                </p>

                {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
                <button type="submit" className="btn-primary w-full">
                  Continue →
                </button>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="font-display text-xl font-semibold mb-1">What are you saving for?</h2>
                <p className="text-white/40 text-sm mb-5">We&apos;ll set up your first goal</p>
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