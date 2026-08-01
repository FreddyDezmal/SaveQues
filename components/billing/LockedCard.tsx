"use client";

/**
 * components/billing/LockedCard.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 10/11: "locked cards"
 * from the brief. Two uses:
 *
 *   1. Wraps a piece of premium UI (`children`) and blurs/dims it with a
 *      lock overlay + upgrade CTA when the viewer isn't entitled —
 *      lets the free user see THAT the feature exists (a card-shaped
 *      preview, not literally hidden) without being able to use it.
 *      This is "tasteful," per the brief, specifically because it shows
 *      real UI, not a blank space — the difference between "this exists,
 *      upgrade to use it" and "you can't see this."
 *   2. Used standalone (no children) as its own empty-state-shaped card,
 *      matching components/ui/EmptyState.tsx's exact layout, for a page
 *      that's entirely gated (e.g. a future /coaching page).
 *
 * NEVER A DARK PATTERN (Phase 11): the lock is always labeled "Premium"
 * with a crown icon (never disguised as a bug/error), the CTA always
 * says exactly what it does ("Upgrade to Premium"), and dismissing it
 * (there's nothing to dismiss — it's not a popup) never nags again this
 * session beyond the one static card in place of the feature.
 */

import { ReactNode } from "react";
import { Lock } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

interface LockedCardProps {
  title: string;
  description: string;
  onUpgradeClick: () => void;
  children?: ReactNode;
  className?: string;
}

export default function LockedCard({ title, description, onUpgradeClick, children, className = "" }: LockedCardProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className={`relative card p-6 overflow-hidden ${className}`}>
      {children && (
        <div
          aria-hidden="true"
          className={`pointer-events-none select-none opacity-40 blur-[2px] ${reducedMotion ? "" : "transition-opacity"}`}
        >
          {children}
        </div>
      )}

      <div className={children ? "absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-surface-base/80 backdrop-blur-[1px]" : "text-center"}>
        <div className="w-11 h-11 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-3">
          <Lock size={18} className="text-amber-300" aria-hidden="true" />
        </div>
        <h3 className="font-display text-base font-semibold text-white mb-1">{title}</h3>
        <p className="text-white/50 text-sm mb-4 max-w-xs leading-relaxed">{description}</p>
        <button
          type="button"
          onClick={onUpgradeClick}
          className="btn-primary inline-flex items-center gap-2 text-sm px-5 py-2.5 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
        >
          Upgrade to Premium
        </button>
      </div>
    </div>
  );
}
