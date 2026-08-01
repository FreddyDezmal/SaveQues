"use client";

/**
 * components/billing/PlanComparisonDialog.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 10/11: comparison
 * dialogs. Built entirely on components/ui/Modal.tsx (focus trap,
 * Escape-to-close, role="dialog"/aria-modal, focus restore) rather than
 * a new dialog implementation — "everything must match the existing
 * design language" applies to behavior, not just visuals.
 *
 * Feature rows are generated from the SAME /api/billing/status catalogue
 * every other premium UI component reads (via useBillingStatus) — never
 * a separately hardcoded feature list, so a new feature added to
 * migration 069's seed data appears here automatically.
 */

import { Check, X, Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useBillingStatus } from "@/lib/hooks/useBillingStatus";
import { useState } from "react";

interface PlanComparisonDialogProps {
  open: boolean;
  onClose: () => void;
  onUpgradeStarted?: () => void;
}

const FEATURE_LABELS: Record<string, string> = {
  goals_limit: "Savings goals",
  exports_limit: "Data exports",
  scenarios_limit: "What-if scenarios",
  advanced_analytics: "Advanced analytics",
  ai_coaching: "AI coaching",
  unlimited_exports: "Unlimited exports",
  historical_insights: "Full historical insights",
  advanced_forecasting: "Advanced forecasting",
  priority_reminders: "Priority reminders",
};

function formatLimit(limit: number | null, unit?: string): string {
  if (limit === null) return "Unlimited";
  return `${limit}${unit ? ` ${unit}` : ""}`;
}

export default function PlanComparisonDialog({ open, onClose, onUpgradeStarted }: PlanComparisonDialogProps) {
  const { status, loading } = useBillingStatus();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "premium" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Could not start checkout");
      }
      onUpgradeStarted?.();
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStarting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      titleId="plan-comparison-title"
      title="Free vs Premium"
      descriptionId="plan-comparison-description"
      maxWidthClassName="max-w-lg"
    >
      <p id="plan-comparison-description" className="text-sm text-white/50 mb-5">
        Premium unlocks unlimited goals, deeper insights, and AI-powered coaching — everything you already have stays free.
      </p>

      {loading || !status ? (
        <div className="flex items-center justify-center py-10 text-white/40" role="status" aria-live="polite">
          <Loader2 size={20} className="animate-spin mr-2" aria-hidden="true" />
          Loading plans…
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm border-collapse">
            <caption className="sr-only">Feature comparison between the Free and Premium plans</caption>
            <thead>
              <tr className="text-left text-white/40 text-xs uppercase tracking-wide">
                <th scope="col" className="py-2 px-1 font-medium">Feature</th>
                <th scope="col" className="py-2 px-1 font-medium text-center">Free</th>
                <th scope="col" className="py-2 px-1 font-medium text-center">Premium</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(FEATURE_LABELS).map(([key, label]) => {
                const feature = status.entitlements.features[key];
                const isLimit = key.endsWith("_limit");
                return (
                  <tr key={key} className="border-t border-white/5">
                    <th scope="row" className="py-2.5 px-1 font-normal text-white/80 text-left">{label}</th>
                    <td className="py-2.5 px-1 text-center text-white/50">
                      {isLimit ? formatFreeLimit(key) : <X size={15} className="inline text-white/25" aria-label="Not included" />}
                    </td>
                    <td className="py-2.5 px-1 text-center text-emerald-400">
                      {isLimit ? "Unlimited" : <Check size={15} className="inline" aria-label="Included" />}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-white/5">
                <th scope="row" className="py-2.5 px-1 font-normal text-white/80 text-left">Price</th>
                <td className="py-2.5 px-1 text-center text-white/50">$0</td>
                <td className="py-2.5 px-1 text-center text-white font-semibold">
                  {status.plans.find((p) => p.id === "premium")?.priceCents
                    ? `$${(status.plans.find((p) => p.id === "premium")!.priceCents! / 100).toFixed(2)}/mo`
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400 mt-4">{error}</p>
      )}

      <div className="flex justify-end gap-3 mt-6">
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-white/50 hover:text-white/80 px-4 py-2.5 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-lg"
        >
          Maybe later
        </button>
        <button
          type="button"
          onClick={handleUpgrade}
          disabled={starting || status?.entitlements.isPremium}
          className="btn-primary text-sm px-5 py-2.5 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
        >
          {status?.entitlements.isPremium ? "You're on Premium" : starting ? "Starting checkout…" : "Upgrade to Premium"}
        </button>
      </div>
    </Modal>
  );
}

/** Free-tier limit values, hardcoded ONLY as display fallbacks here for
 *  the two plans this dialog compares — the actual enforcement never
 *  reads this map (that's lib/billing/entitlements.ts, reading migration
 *  069's plan_features rows). A future third tier needs a new column in
 *  this table, not a code change to enforcement. */
function formatFreeLimit(key: string): string {
  const FREE_LIMITS: Record<string, string> = {
    goals_limit: "5 goals",
    exports_limit: "5 / month",
    scenarios_limit: "3 / day",
  };
  return FREE_LIMITS[key] ?? "Limited";
}
