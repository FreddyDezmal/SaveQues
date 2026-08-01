"use client";

/**
 * components/billing/UpgradePrompt.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 11: the inline banner
 * shown when a usage limit is hit (e.g. "You've used all 5 of your goals
 * this plan allows") or a boolean feature is gated inline in a form/flow.
 * Distinct from LockedCard: this is a slim banner meant to sit ABOVE or
 * BELOW existing UI (e.g. under a disabled "Add goal" button), not
 * replace a whole card.
 *
 * Honest framing only (Phase 11 — "never mislead users"): always states
 * the actual current usage/limit when provided, never a vague "upgrade
 * now!" with no reason.
 */

import { Sparkles } from "lucide-react";

interface UpgradePromptProps {
  message: string;
  /** e.g. "3 of 5 goals used" — omit if not usage-limit-related. */
  usageDetail?: string;
  onUpgradeClick: () => void;
  className?: string;
}

export default function UpgradePrompt({ message, usageDetail, onUpgradeClick, className = "" }: UpgradePromptProps) {
  return (
    <div
      role="status"
      className={`flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 ${className}`}
    >
      <Sparkles size={18} className="text-amber-300 flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/80">{message}</p>
        {usageDetail && <p className="text-xs text-white/40 mt-0.5">{usageDetail}</p>}
      </div>
      <button
        type="button"
        onClick={onUpgradeClick}
        className="flex-shrink-0 text-sm font-medium text-amber-300 hover:text-amber-200 underline underline-offset-2 min-h-[44px] px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 rounded"
      >
        Upgrade
      </button>
    </div>
  );
}
