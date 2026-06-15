"use client";

import { useEffect, useRef } from "react";
import { format } from "date-fns";
import { X, CheckCircle2, Lock, Sparkles } from "lucide-react";
import { getUnlockCriteria, type Achievement } from "@/lib/achievements";

export interface BadgeDetailData extends Achievement {
  /** ISO timestamp the badge was earned, if applicable */
  earnedAt?: string | null;
  /** Whether the user has earned this badge */
  earned: boolean;
}

interface Props {
  badge: BadgeDetailData;
  onClose: () => void;
}

/**
 * Badge detail panel — Task 2.
 *
 * Mobile-first bottom sheet shown when a user taps any badge (earned or
 * locked). For earned badges it surfaces everything the dashboard summary
 * previously hid: full description, unlock criteria, XP earned, and the
 * unlock date (when available). Locked badges show the criteria needed to
 * unlock them (secret/hidden badges remain mystery-framed).
 *
 * Accessibility:
 *  - role="dialog" + aria-modal="true" + aria-labelledby for screen readers
 *  - Escape key and backdrop click close the panel
 *  - Focus moves to the panel on open and the close button is reachable by
 *    keyboard
 */
export default function BadgeDetailPanel({ badge, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const isSecretLocked = badge.secret && !badge.earned;
  const criteria = getUnlockCriteria(badge);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="badge-detail-title"
        tabIndex={-1}
        className="w-full max-w-md bg-surface-card rounded-t-3xl sm:rounded-3xl p-6 border border-surface-border outline-none"
        style={{ animation: "badgePop 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl border ${
                badge.earned
                  ? "bg-emerald-500/10 border-emerald-500/20"
                  : "bg-surface-elevated border-surface-border"
              }`}
            >
              <span className={badge.earned ? "" : "grayscale opacity-60"}>
                {isSecretLocked ? "🔍" : badge.icon}
              </span>
            </div>
            <div>
              <h2 id="badge-detail-title" className="font-display text-lg font-bold text-white leading-tight">
                {isSecretLocked ? "Secret Badge" : badge.title}
              </h2>
              <span className="text-[10px] text-white/30 uppercase tracking-wider">
                {badge.category === "hidden" ? "Secret" : badge.category}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close badge details"
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-surface-border transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Earned status banner */}
        {badge.earned ? (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            <p className="text-sm font-medium text-emerald-400">
              Earned{badge.earnedAt ? ` · ${format(new Date(badge.earnedAt), "d MMM yyyy")}` : ""}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-xl bg-surface-elevated border border-surface-border">
            <Lock size={14} className="text-white/30 shrink-0" />
            <p className="text-sm font-medium text-white/40">Not yet earned</p>
          </div>
        )}

        {/* Description */}
        <div className="mb-3">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Description</p>
          <p className="text-sm text-white/70 leading-relaxed">
            {isSecretLocked ? "Keep playing to discover this badge." : badge.description}
          </p>
        </div>

        {/* Unlock criteria */}
        <div className="mb-3">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">
            {badge.earned ? "How you earned it" : "How to unlock"}
          </p>
          <p className="text-sm text-white/70 leading-relaxed">
            {isSecretLocked ? "🔍 This is a secret badge — its requirements are hidden until you discover it." : criteria}
          </p>
        </div>

        {/* XP reward */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-surface-elevated border border-surface-border">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-brand-400" />
            <span className="text-xs text-white/50">
              {badge.earned ? "XP earned" : "XP reward"}
            </span>
          </div>
          <span className="text-sm font-bold text-brand-400">+{badge.xpReward} XP</span>
        </div>
      </div>
    </div>
  );
}
