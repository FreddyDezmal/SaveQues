"use client";

/**
 * app/invite/[token]/InviteRedeemClient.tsx
 *
 * Sprint 22, Phase 18 + Sprint 22.5 (seamless continuation).
 *
 * This is the page GET /api/invitations/preview and POST
 * /api/invitations/redeem's own file headers describe as their intended
 * destination ("this is what a brand new visitor hits before they've
 * signed up, landing on /invite/{token}"; redeem is "typically triggered
 * automatically by the /invite/{token} page once the visitor is signed
 * in") — that backend design is followed exactly here, and Sprint 22.5
 * closes the remaining gap: getting the visitor BACK here automatically
 * after they authenticate, instead of asking them to reopen the link.
 * See lib/pendingInvite.ts for how the token survives that detour, and
 * app/auth/login, app/auth/signup, app/auth/callback for where it's set
 * and read.
 *
 * Sprint 22.5 audit finding, addressed here (not a backend change):
 * a brand-new signup can land back on this page microseconds after the
 * `profiles` row is created by the handle_new_user DB trigger — a race
 * that already has a known, existing mitigation elsewhere in this
 * codebase: app/(app)/dashboard/page.tsx redirects to /auth/setting-up,
 * which polls GET /api/auth/profile-ready until the row exists. This
 * flow bypasses /dashboard entirely (by design — that's the point), so
 * it can't rely on that redirect. Rather than duplicate that polling
 * logic, this component calls the SAME GET /api/auth/profile-ready
 * endpoint before ever calling redeem — if the profile row doesn't exist
 * yet, redeem_invite()'s XP-award UPDATEs would silently affect zero
 * rows (Postgres UPDATE with no match is not an error), quietly losing
 * the invitee's reward. This closes that race without touching the RPC.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import UserAvatar from "@/components/social/UserAvatar";
import ShareButton from "@/components/sharing/ShareButton";
import Skeleton from "@/components/ui/Skeleton";
import { setPendingInviteCookie, clearPendingInviteCookie } from "@/lib/pendingInvite";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

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

type Stage =
  | "loading" | "not_found" | "signed_out"
  | "awaiting_profile" | "redeeming"
  | "redeemed" | "redeem_failed" | "network_error";

const PROFILE_POLL_MAX_ATTEMPTS = 10;
const PROFILE_POLL_INTERVAL_MS = 1200;

/** Referral badge thresholds — must match lib/achievements.ts's referral_first/five/ten. */
const REFERRAL_TIERS = [
  { count: 1, title: "Plus One" },
  { count: 5, title: "Squad Builder" },
  { count: 10, title: "Community Pillar" },
] as const;

function nextReferralTier(count: number) {
  return REFERRAL_TIERS.find((t) => count < t.count) ?? null;
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls GET /api/auth/profile-ready — same endpoint app/auth/setting-up/page.tsx
 *  already uses — rather than a second, parallel readiness check. */
async function waitForProfileReady(): Promise<boolean> {
  for (let attempt = 0; attempt < PROFILE_POLL_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch("/api/auth/profile-ready");
      const body = await res.json();
      if (body.ready) return true;
    } catch {
      // keep retrying — matches /auth/setting-up's own "network error, keep retrying" behavior
    }
    await delay(PROFILE_POLL_INTERVAL_MS);
  }
  return false;
}

export default function InviteRedeemClient({ token }: { token: string }) {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [result, setResult] = useState<RedeemResult | null>(null);

  const attemptRedemption = useCallback(async () => {
    setStage("awaiting_profile");
    const ready = await waitForProfileReady();
    if (!ready) {
      // Doesn't fail the flow outright — a slow trigger is rare and
      // transient. Fall through and let the redeem call itself surface
      // whatever actually happens rather than blocking indefinitely.
      setStage("redeeming");
    } else {
      setStage("redeeming");
    }

    try {
      const redeemRes = await fetch("/api/invitations/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const redeemBody = await redeemRes.json();
      if (!redeemRes.ok) {
        setRedeemError(redeemBody.error || "Couldn't redeem that invite");
        setStage("redeem_failed");
        return;
      }
      clearPendingInviteCookie();
      setResult(redeemBody);
      setStage("redeemed");
    } catch {
      setStage("network_error");
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // The cookie's only job was surviving the auth detour — once we're
      // back on this page at all, with the token in the URL itself,
      // it's served its purpose. Clear it unconditionally so it can
      // never be read again for a different, unrelated future signup.
      clearPendingInviteCookie();

      try {
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
          setStage("signed_out");
          return;
        }

        await attemptRedemption();
      } catch {
        if (!cancelled) setStage("network_error");
      }
    }

    run();
    return () => { cancelled = true; };
  }, [token, attemptRedemption]);

  function goToAuth(destination: "/auth/signup" | "/auth/login") {
    // Set BEFORE navigating — see lib/pendingInvite.ts. Covers the two
    // auth-completion paths that never touch /auth/callback at all
    // (password login, and signup with email confirmation off); the
    // third path (email confirmation) carries the token via the existing
    // `next` param instead, set inside signup/page.tsx itself.
    setPendingInviteCookie(token);
    router.push(destination);
  }

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
        <h1 className="font-display text-lg font-bold text-white mb-2">This invite link isn&apos;t valid</h1>
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
          Sign up or log in and you&apos;ll be brought right back here to join{preview?.context_type === "group" ? " the group" : ""} and earn a welcome XP bonus.
        </p>
        <div className="flex flex-col gap-2.5">
          <button type="button" onClick={() => goToAuth("/auth/signup")} className="btn-primary w-full text-sm">Sign up</button>
          <button type="button" onClick={() => goToAuth("/auth/login")} className="btn-ghost w-full text-sm">I already have an account</button>
        </div>
      </div>
    );
  }

  if (stage === "awaiting_profile" || stage === "redeeming") {
    return (
      <div className="card p-6 text-center">
        <UserAvatar emoji={preview?.inviter.avatar_emoji ?? null} size="lg" className="mx-auto mb-4" />
        <p className="text-sm text-white/50" role="status">
          {stage === "awaiting_profile" ? "Setting up your account…" : "Claiming your invite…"}
        </p>
      </div>
    );
  }

  if (stage === "network_error") {
    return (
      <div className="card p-6 text-center">
        <p className="text-4xl mb-3" aria-hidden="true">📡</p>
        <h1 className="font-display text-lg font-bold text-white mb-2">Connection trouble</h1>
        <p className="text-sm text-white/50 mb-5" role="alert">
          Check your connection and try again — the invite is still waiting for you.
        </p>
        <button type="button" onClick={attemptRedemption} className="btn-primary w-full text-sm">Try again</button>
      </div>
    );
  }

  if (stage === "redeem_failed") {
    return (
      <div className="card p-6 text-center">
        <p className="text-4xl mb-3" aria-hidden="true">⚠️</p>
        <h1 className="font-display text-lg font-bold text-white mb-2">Couldn&apos;t claim this invite</h1>
        <p className="text-sm text-white/50 mb-5" role="alert">{redeemError}</p>
        <Link href="/dashboard" className="btn-primary w-full text-sm inline-block">Go to dashboard</Link>
      </div>
    );
  }

  // redeemed
  const tier = result ? nextReferralTier(result.inviter_referral_count) : null;
  const priorTierCount = tier
    ? (REFERRAL_TIERS[REFERRAL_TIERS.indexOf(tier) - 1]?.count ?? 0)
    : (REFERRAL_TIERS[REFERRAL_TIERS.length - 1]?.count ?? 0);
  const tierSpan = tier ? tier.count - priorTierCount : 1;
  const tierProgress = tier ? Math.min(1, ((result?.inviter_referral_count ?? 0) - priorTierCount) / tierSpan) : 1;

  return (
    <div
      className="card p-6 text-center"
      style={reducedMotion ? undefined : { animation: "badgePop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) both" }}
    >
      <p className="text-4xl mb-3" aria-hidden="true">🎉</p>
      <h1 className="font-display text-lg font-bold text-white mb-2">Welcome to SaveQuest!</h1>
      <p className="text-sm text-white/60 mb-1">
        You earned <span className="text-brand-400 font-semibold">{result?.invitee_xp} XP</span> for joining via {inviterName}&apos;s invite.
      </p>
      {result?.joined_group_id && preview?.group && (
        <p className="text-sm text-white/60 mb-4">
          You joined: <span className="text-white/80 font-medium">{preview.group.emoji} {preview.group.name}</span>
        </p>
      )}

      {tier && result && (
        <div className="bg-surface-elevated rounded-xl p-3 mt-4 mb-1 text-left">
          <p className="text-xs text-white/50 mb-1.5">
            You just helped {inviterName} toward their next referral badge
          </p>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden mb-1.5" role="img" aria-label={`${result.inviter_referral_count} of ${tier.count} referrals toward ${tier.title}`}>
            <div className="h-full bg-brand-500 rounded-full" style={{ width: `${tierProgress * 100}%` }} />
          </div>
          <p className="text-xs text-white/40">
            {result.inviter_referral_count} / {tier.count} referrals · next: {tier.title}
          </p>
        </div>
      )}

      <Link
        href={result?.joined_group_id ? `/groups/${result.joined_group_id}` : "/dashboard"}
        className="btn-primary w-full text-sm inline-block mt-4"
      >
        {result?.joined_group_id ? "Go to group" : "Go to dashboard"}
      </Link>
      <div className="mt-3">
        <ShareButton
          title="Join me on SaveQuest"
          text="I'm using SaveQuest to save smarter — join me and we both earn XP!"
          shareContext="invite_redeemed_referral"
          className="w-full"
        />
      </div>
    </div>
  );
}
