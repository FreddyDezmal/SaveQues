"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const COOLDOWN_SECONDS  = 60;   // must wait 1 minute between resends
const MAX_RESENDS       = 5;    // maximum resends per hour
const HOUR_MS           = 60 * 60 * 1000;
const STORAGE_KEY       = "sq_resend_log"; // localStorage key

/** Timestamps of resends in the last hour, persisted across refreshes. */
function getResendLog(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const log: number[] = JSON.parse(raw);
    const cutoff = Date.now() - HOUR_MS;
    return log.filter(ts => ts > cutoff);
  } catch {
    return [];
  }
}

function saveResendLog(log: number[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {}
}

export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail]             = useState(searchParams.get("email") ?? "");
  const [resending, setResending]     = useState(false);
  const [resendError, setResendError] = useState("");
  const [lastSentAt, setLastSentAt]   = useState<number | null>(null);
  const [cooldown, setCooldown]       = useState(0);     // seconds remaining
  const [resendCount, setResendCount] = useState(0);     // resends in last hour
  const [justSent, setJustSent]       = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // On mount: load user email and restore persisted state
  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email_confirmed_at) { router.push("/dashboard"); return; }
      // Prefer the live session email; fall back to ?email= query param (set
      // by the signup page when redirecting after signUp() returns no session)
      if (user?.email) setEmail(user.email);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") router.push("/dashboard");
    });

    // Restore resend log from localStorage
    const log = getResendLog();
    setResendCount(log.length);
    if (log.length > 0) {
      const last = log[log.length - 1];
      setLastSentAt(last);
      const elapsed = Math.floor((Date.now() - last) / 1000);
      const remaining = COOLDOWN_SECONDS - elapsed;
      if (remaining > 0) setCooldown(remaining);
    }

    return () => subscription.unsubscribe();
  }, [router]);

  // Countdown timer — ticks every second while cooldown > 0
  useEffect(() => {
    if (cooldown <= 0) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [cooldown]);

  async function handleResend() {
    if (resending || cooldown > 0 || !email) return;

    // Re-check log in case another tab updated it
    const log = getResendLog();
    if (log.length >= MAX_RESENDS) {
      setResendError(`You've reached the limit of ${MAX_RESENDS} resends per hour. Please wait before trying again.`);
      return;
    }

    setResending(true);
    setResendError("");
    setJustSent(false);

    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email });

    if (error) {
      setResendError(error.message);
      setResending(false);
      return;
    }

    // Record this resend
    const now = Date.now();
    const updatedLog = [...log, now];
    saveResendLog(updatedLog);
    setLastSentAt(now);
    setResendCount(updatedLog.length);
    setCooldown(COOLDOWN_SECONDS);
    setJustSent(true);
    setResending(false);
  }

  const hourlyLimitReached = resendCount >= MAX_RESENDS;
  const canResend          = !cooldown && !hourlyLimitReached && !!email;

  function formatCooldown(secs: number): string {
    if (secs >= 60) return `${Math.ceil(secs / 60)}m`;
    return `${secs}s`;
  }

  return (
    <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="text-6xl mb-4">📩</div>
        <h1 className="font-display text-2xl font-bold text-white mb-2">Check your email</h1>
        <p className="text-white/50 text-sm mb-2">We sent a verification link to</p>
        {email && <p className="text-white/80 font-medium text-sm mb-6">{email}</p>}
        <p className="text-white/40 text-xs mb-8">
          Click the link in that email to activate your account and start your savings quest.
        </p>

        <div className="card p-4 text-left mb-5">
          <p className="text-xs text-white/40 font-medium uppercase tracking-wider mb-2">No email?</p>
          <ul className="space-y-1.5 text-xs text-white/50">
            <li>• Check your spam or junk folder</li>
            <li>• Make sure you entered the right email</li>
            <li>• Wait 2–3 minutes and refresh</li>
          </ul>
        </div>

        {/* Success confirmation */}
        {justSent && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-emerald-400 text-sm mb-4">
            ✓ Email resent — check your inbox
          </div>
        )}

        {/* Error */}
        {resendError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
            {resendError}
          </div>
        )}

        {/* Hourly limit reached */}
        {hourlyLimitReached ? (
          <div className="bg-surface-elevated border border-surface-border rounded-xl px-4 py-3 text-white/40 text-sm mb-4">
            Resend limit reached ({MAX_RESENDS}/{MAX_RESENDS} this hour). Please wait before trying again, or{" "}
            <Link href="/auth/login" className="text-brand-400 hover:text-brand-300 underline">use a different email</Link>.
          </div>
        ) : (
          <div className="mb-4">
            <button
              onClick={handleResend}
              disabled={!canResend || resending}
              className={`btn-ghost w-full text-sm transition-all duration-200 ${
                !canResend ? "opacity-40 cursor-not-allowed" : ""
              }`}
            >
              {resending ? (
                "Sending…"
              ) : cooldown > 0 ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="text-white/40">Resend available in</span>
                  <span className="font-display font-bold text-brand-400 tabular-nums">
                    {formatCooldown(cooldown)}
                  </span>
                </span>
              ) : (
                "Resend verification email"
              )}
            </button>

            {/* Resend counter */}
            {resendCount > 0 && !hourlyLimitReached && (
              <p className="text-white/20 text-xs mt-2">
                {resendCount}/{MAX_RESENDS} resends used this hour
              </p>
            )}
          </div>
        )}

        <Link href="/auth/login" className="text-white/30 text-xs hover:text-white/50 transition-colors">
          Use a different email address
        </Link>
      </div>
    </div>
  );
}