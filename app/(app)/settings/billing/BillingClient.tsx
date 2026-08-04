"use client";

/**
 * app/(app)/settings/billing/BillingClient.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 8/10/11: the "one
 * portal entry point" the brief asks for. Free users see their current
 * usage against Free-tier limits and an upgrade CTA (Phase 11: "explain
 * benefits, differences, current usage, remaining limits, value").
 * Premium users see their status and a button into Stripe's hosted
 * Customer Portal for payment method / invoices / cancellation — this
 * app deliberately does not build its own invoice list or
 * payment-method form (Phase 8: "through one portal entry point").
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Crown, Loader2, ExternalLink } from "lucide-react";
import PremiumBadge from "@/components/billing/PremiumBadge";
import PlanComparisonDialog from "@/components/billing/PlanComparisonDialog";
import { formatDateNumeric } from "@/lib/dateFormat";
import { useBillingStatus } from "@/lib/hooks/useBillingStatus";

const USAGE_LABELS: Record<string, string> = {
  goals_limit: "Savings goals",
  exports_limit: "Exports this month",
  scenarios_limit: "Scenarios today",
};

export default function BillingClient() {
  const { status, loading, isPremium, refresh } = useBillingStatus();
  const [showComparison, setShowComparison] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  async function handleManageBilling() {
    setOpeningPortal(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not open billing portal");
      window.location.href = data.url;
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setOpeningPortal(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/settings" className="text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="font-display text-2xl font-bold text-white">Billing & Premium</h1>
      </div>

      {loading || !status ? (
        <div className="flex items-center justify-center py-16 text-white/40" role="status" aria-live="polite">
          <Loader2 size={20} className="animate-spin mr-2" aria-hidden="true" />
          Loading your plan…
        </div>
      ) : (
        <>
          {/* Current plan card */}
          <div className="card p-5 mb-6">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-white/40 uppercase tracking-wider font-medium">Current plan</p>
              {isPremium && <PremiumBadge />}
            </div>
            <p className="font-display text-xl font-semibold text-white mb-1">{status.entitlements.planName}</p>

            {status.subscription?.cancelAtPeriodEnd && status.subscription.currentPeriodEnd && (
              <p className="text-xs text-amber-300 mb-3">
                Cancels on {formatDateNumeric(status.subscription.currentPeriodEnd)} — you&apos;ll keep Premium until then.
              </p>
            )}
            {status.subscription?.status === "past_due" && (
              <p className="text-xs text-red-400 mb-3">
                Your last payment failed. Update your payment method to keep Premium features.
              </p>
            )}

            {isPremium ? (
              <>
                {portalError && <p role="alert" className="text-sm text-red-400 mb-3">{portalError}</p>}
                <button
                  type="button"
                  onClick={handleManageBilling}
                  disabled={openingPortal}
                  className="btn-primary w-full inline-flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {openingPortal ? "Opening billing portal…" : "Manage subscription"}
                  {!openingPortal && <ExternalLink size={14} aria-hidden="true" />}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowComparison(true)}
                className="btn-primary w-full inline-flex items-center justify-center gap-2"
              >
                <Crown size={16} aria-hidden="true" />
                Upgrade to Premium
              </button>
            )}
          </div>

          {/* Usage this period */}
          <div className="mb-6">
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium mb-3">Your usage</p>
            <div className="card p-4 space-y-4">
              {Object.entries(USAGE_LABELS).map(([key, label]) => {
                const u = status.usage[key];
                if (!u) return null;
                const unlimited = u.limit === null;
                const pct = unlimited ? 0 : Math.min(100, (u.used / Math.max(u.limit ?? 1, 1)) * 100);
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-white/70">{label}</span>
                      <span className="text-white/40">{unlimited ? "Unlimited" : `${u.used} / ${u.limit}`}</span>
                    </div>
                    {!unlimited && (
                      <div
                        role="progressbar"
                        aria-valuenow={u.used}
                        aria-valuemin={0}
                        aria-valuemax={u.limit ?? 0}
                        aria-label={`${label}: ${u.used} of ${u.limit} used`}
                        className="h-1.5 rounded-full bg-white/10 overflow-hidden"
                      >
                        <div
                          className={`h-full rounded-full ${pct >= 100 ? "bg-red-400" : "bg-brand-500"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {!isPremium && (
            <button
              type="button"
              onClick={() => setShowComparison(true)}
              className="text-sm text-white/50 hover:text-white/80 underline underline-offset-2 mb-8"
            >
              Compare Free vs Premium
            </button>
          )}
        </>
      )}

      <PlanComparisonDialog
        open={showComparison}
        onClose={() => setShowComparison(false)}
        onUpgradeStarted={() => refresh()}
      />
    </div>
  );
}
