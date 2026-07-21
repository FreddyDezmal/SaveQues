"use client";

/**
 * app/invite/[token]/InviteRedeemClient.tsx
 *
 * Sprint 22, Phase 18. This is the page GET /api/invitations/preview and
 * POST /api/invitations/redeem's own file headers describe as their
 * intended destination ("this is what a brand new visitor hits before
 * they've signed up, landing on /invite/{token}"; redeem is "typically
 * triggered automatically by the /invite/{token} page once the visitor
 * is signed in") — that backend design is followed exactly here.
 *
 * Known limitation (documented, not silently worked around): this phase
 * is frontend-only and does not touch app/auth/* or the `next`-param
 * convention already used by app/auth/callback/route.ts. So a signed-out
 * visitor who signs up from here is NOT automatically brought back to
 * redeem — they land whatever existing signup produces. The invite link
 * itself stays valid (it's redeemed on demand, not on first view), so
 * this page tells them to come back to it after signing up. Wiring a
 * `next=/invite/{token}` param through login/signup would remove that
 * extra step, and is called out as a follow-up rather than done here.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import UserAvatar from "@/components/social/UserAvatar";
import Skeleton from "@/components/ui/Skeleton";

interface Preview {
  inviter: { display_name: string | null; avatar_emoji: string | null };
  context_type: "general" | "group";
  group: { name: string; emoji: string } | null;
}

interface RedeemResult {
  success: true;
  joined_group_id: string | null;
  invitee_xp: number;
  inviter_referral_count: number;
}

type Stage = "loading" | "not_found" | "signed_out" | "redeeming" | "redeemed" | "redeem_failed";

export default function InviteRedeemClient({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [result, setResult] = useState<RedeemResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const res = await fetch(`/api/invitations/preview?token=${encodeURIComponent(token)}`);
      if (cancelled) return;
      if (!res.ok) {
        setStage("not_found");
        return;
      }
      const data: Preview = await res.json();
      if (cancelled) return;
      setPreview(data);

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;

      if (!user) {
        // Remember it so a "come back and finish" flow is at least
        // possible from within the app later (e.g. a future /invites
        // banner), without this phase needing to touch auth pages.
        try { sessionStorage.setItem("pending_invite_token", token); } catch {}
        setStage("signed_out");
        return;
      }

      setStage("redeeming");
      const redeemRes = await fetch("/api/invitations/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const redeemBody = await redeemRes.json();
      if (cancelled) return;
      if (!redeemRes.ok) {
        setRedeemError(redeemBody.error || "Couldn't redeem that invite");
        setStage("redeem_failed");
        return;
      }
      try { sessionStorage.removeItem("pending_invite_token"); } catch {}
      setResult(redeemBody);
      setStage("redeemed");
    }

    run();
    return () => { cancelled = true; };
  }, [token]);

  if (stage === "loading") {
    return (
      <div className="card p-6 text-center">
        <Skeleton className="w-16 h-16 rounded-full mx-auto mb-4" />
        <Skeleton className="h-4 w-40 mx-auto mb-2" />
        <Skeleton className="h-3 w-56 mx-auto" />
      </div>
    );
  }

  if (stage === "not_found") {
    return (
      <div className="card p-6 text-center">
        <p className="text-4xl mb-3" aria-hidden="true">🔗</p>
        <h1 className="font-display text-lg font-bold text-white mb-2">This invite link isn't valid</h1>
        <p className="text-sm text-white/50 mb-5">
          It may have expired or already been used. You can still join SaveQuest on your own.
        </p>
        <Link href="/auth/signup" className="btn-primary w-full text-sm inline-block">Create an account</Link>
      </div>
    );
  }

  const inviterName = preview?.inviter.display_name || "A SaveQuest user";

  if (stage === "signed_out") {
    return (
      <div className="card p-6 text-center">
        <UserAvatar emoji={preview?.inviter.avatar_emoji ?? null} size="lg" className="mx-auto mb-4" />
        <h1 className="font-display text-lg font-bold text-white mb-2">
          {inviterName} invited you to SaveQuest
        </h1>
        {preview?.context_type === "group" && preview.group && (
          <p className="text-sm text-white/50 mb-1">to join the <span className="text-white/80 font-medium">{preview.group.emoji} {preview.group.name}</span> group</p>
        )}
        <p className="text-sm text-white/50 mb-6">
          Sign up and come back to this link to join{preview?.context_type === "group" ? " the group" : ""} and earn a welcome XP bonus.
        </p>
        <div className="flex flex-col gap-2.5">
          <Link href="/auth/signup" className="btn-primary w-full text-sm">Sign up</Link>
          <Link href="/auth/login" className="btn-ghost w-full text-sm">I already have an account</Link>
        </div>
      </div>
    );
  }

  if (stage === "redeeming") {
    return (
      <div className="card p-6 text-center">
        <UserAvatar emoji={preview?.inviter.avatar_emoji ?? null} size="lg" className="mx-auto mb-4" />
        <p className="text-sm text-white/50" role="status">Claiming your invite…</p>
      </div>
    );
  }

  if (stage === "redeem_failed") {
    return (
      <div className="card p-6 text-center">
        <p className="text-4xl mb-3" aria-hidden="true">⚠️</p>
        <h1 className="font-display text-lg font-bold text-white mb-2">Couldn't claim this invite</h1>
        <p className="text-sm text-white/50 mb-5" role="alert">{redeemError}</p>
        <Link href="/dashboard" className="btn-primary w-full text-sm inline-block">Go to dashboard</Link>
      </div>
    );
  }

  // redeemed
  return (
    <div className="card p-6 text-center">
      <p className="text-4xl mb-3" aria-hidden="true">🎉</p>
      <h1 className="font-display text-lg font-bold text-white mb-2">Welcome to SaveQuest!</h1>
      <p className="text-sm text-white/60 mb-1">
        You earned <span className="text-brand-400 font-semibold">{result?.invitee_xp} XP</span> for joining via {inviterName}'s invite.
      </p>
      {result?.joined_group_id && preview?.group && (
        <p className="text-sm text-white/60 mb-4">You're now a member of <span className="text-white/80 font-medium">{preview.group.emoji} {preview.group.name}</span>.</p>
      )}
      <Link
        href={result?.joined_group_id ? `/groups/${result.joined_group_id}` : "/dashboard"}
        className="btn-primary w-full text-sm inline-block mt-3"
      >
        {result?.joined_group_id ? "Go to group" : "Go to dashboard"}
      </Link>
    </div>
  );
}
