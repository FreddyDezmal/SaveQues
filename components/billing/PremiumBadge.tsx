/**
 * components/billing/PremiumBadge.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform, Phase 10: Premium UI.
 * Deliberately built as a plain server component matching
 * components/ui/StatusBadge.tsx's exact shape (icon + text, never color
 * alone, same pill/border/size classes) rather than inventing a new
 * badge style — "everything must match the existing design language."
 */

import { Crown } from "lucide-react";

interface PremiumBadgeProps {
  className?: string;
  /** "full" shows "Premium"; "icon" shows just the crown (for tight
   *  spaces like a nav item or list row). */
  variant?: "full" | "icon";
}

export default function PremiumBadge({ className = "", variant = "full" }: PremiumBadgeProps) {
  if (variant === "icon") {
    return (
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 ${className}`}
        title="Premium"
      >
        <Crown size={11} aria-hidden="true" />
        <span className="sr-only">Premium</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border bg-amber-500/15 text-amber-300 border-amber-500/30 ${className}`}
    >
      <Crown size={11} aria-hidden="true" />
      Premium
    </span>
  );
}
