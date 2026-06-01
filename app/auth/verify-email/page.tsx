"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    const supabase = createClient();
    // If user is already verified, move them along
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email_confirmed_at) router.push("/dashboard");
      if (user?.email) setEmail(user.email);
    });

    // Listen for verification event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") router.push("/dashboard");
    });

    return () => subscription.unsubscribe();
  }, [router]);

  async function handleResend() {
    setResending(true);
    const supabase = createClient();
    await supabase.auth.resend({ type: "signup", email });
    setResending(false);
    setResent(true);
  }

  return (
    <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="text-6xl mb-4">📩</div>
        <h1 className="font-display text-2xl font-bold text-white mb-2">Check your email</h1>
        <p className="text-white/50 text-sm mb-2">
          We sent a verification link to
        </p>
        {email && (
          <p className="text-white/80 font-medium text-sm mb-6">{email}</p>
        )}
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

        {resent ? (
          <p className="text-emerald-400 text-sm mb-4">✓ Email resent — check your inbox</p>
        ) : (
          <button
            onClick={handleResend}
            disabled={resending || !email}
            className="btn-ghost w-full mb-3 text-sm"
          >
            {resending ? "Sending…" : "Resend verification email"}
          </button>
        )}

        <Link href="/auth/login" className="text-white/30 text-xs hover:text-white/50 transition-colors">
          Use a different email address
        </Link>
      </div>
    </div>
  );
}