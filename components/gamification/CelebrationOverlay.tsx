"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import ShareButton from "@/components/sharing/ShareButton";
import { useHaptics } from "@/lib/hooks/useHaptics";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

interface Props {
  show: boolean;
  type: "xp" | "levelup" | "badge" | "goal" | "streak" | "achievement";
  title: string;
  subtitle?: string;
  icon?: string;
  xpGained?: number;
  onClose: () => void;
  autoDismissMs?: number; // if set, auto-closes after this many ms
  /**
   * Sprint 20 — Phase 8: optional "share-ready" statistics row (e.g. total
   * saved, level, streak) shown between the subtitle and the XP pill.
   * Purely additive — every existing caller that doesn't pass this still
   * renders exactly as before.
   */
  stats?: { label: string; value: string }[];
}

export default function CelebrationOverlay({ show, type, title, subtitle, icon, xpGained, onClose, autoDismissMs, stats }: Props) {
  const [confetti, setConfetti] = useState<{ x: number; y: number; color: string; delay: number }[]>([]);
  const { vibrate } = useHaptics();
  // Sprint 20 — Phase 8 audit finding: this component previously ran its
  // confetti/pop animations unconditionally for every user. Respecting
  // prefers-reduced-motion means: no confetti particles, and the pop/scale
  // keyframes below are swapped for a plain fade (still functional, no
  // motion-triggered discomfort).
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (show && !reducedMotion) {
      const count = type === "goal" ? 35 : 15;
      const pieces = Array.from({ length: count }, () => ({
        x: Math.random() * 100,
        y: Math.random() * 40,
        color: ["#ffb800", "#10b981", "#8b5cf6", "#ef4444", "#3b82f6"][Math.floor(Math.random() * 5)],
        delay: Math.random() * 0.6,
      }));
      setConfetti(pieces);
      // Sprint 16, Phase 8: goal completion and level-up get the fuller
      // "success" pattern (this is the biggest moment in the app); routine
      // XP pops get nothing at all — an app that buzzes on every small
      // deposit would make the haptic meaningless by the time a real
      // milestone happens. Achievement unlocks sit in between: a light tap.
      if (type === "goal" || type === "levelup") vibrate("success");
      else if (type === "achievement") vibrate("light");
    } else if (show) {
      setConfetti([]); // reduced motion: skip particles entirely
      // Haptics are tactile, not visual-motion — Sprint 20 leaves these on
      // under reduced-motion, matching WCAG's animation-specific scope.
      if (type === "goal" || type === "levelup") vibrate("success");
      else if (type === "achievement") vibrate("light");
    }
  }, [show, type, vibrate, reducedMotion]);

  // Auto-dismiss for achievement overlays (and any caller that sets autoDismissMs)
  useEffect(() => {
    if (!show) return;
    const ms = autoDismissMs ?? (type === "achievement" ? 3000 : undefined);
    if (!ms) return;
    const t = setTimeout(onClose, ms);
    return () => clearTimeout(t);
  }, [show, type, autoDismissMs, onClose]);

  if (!show) return null;

  // Sprint 20: under reduced motion, every one of the badgePop/confettiFall/
  // progressDrain keyframe animations below is skipped — content still
  // appears (via the default opacity/transform), just without motion.
  const anim = (value: string): CSSProperties => (reducedMotion ? {} : { animation: value });

  const isGoalComplete = type === "goal";
  const isAchievement  = type === "achievement";
  // Phase 5: sharing applies to the milestone-y celebration types, not the
  // frequent, low-signal "xp" type — sharing "+15 XP" on every deposit
  // would be noisy rather than a meaningful moment worth a share sheet.
  const isShareable = ["goal", "streak", "achievement", "levelup"].includes(type);

  const defaultIcon =
    type === "levelup"      ? "⬆️" :
    type === "badge"        ? "🏅" :
    type === "goal"         ? "🏆" :
    type === "streak"       ? "🔥" :
    type === "achievement"  ? "🏅" : "⚡";

  const ctaLabel =
    isGoalComplete  ? "Claim Reward! 🎊" :
    type === "streak" ? "Keep it up! 🔥" :
    isAchievement   ? "Nice! 🏅" :
    "Awesome! 🚀";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm mx-4 card p-8 text-center overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={anim("badgePop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards")}
      >
        {/* Confetti */}
        {confetti.map((c, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-sm pointer-events-none"
            style={{
              left: `${c.x}%`,
              top: `${c.y}%`,
              backgroundColor: c.color,
              animation: `confettiFall ${0.8 + Math.random() * 0.6}s ease-out ${c.delay}s forwards`,
            }}
          />
        ))}

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/30 hover:text-white/60 transition-colors"
        >
          <X size={18} />
        </button>

        {/* Achievement label */}
        {isAchievement && (
          <p className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-3">
            🏅 Badge Unlocked
          </p>
        )}

        {/* Icon */}
        <div
          className="text-6xl mb-4"
          style={anim("badgePop 0.5s 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275) both")}
        >
          {icon ?? defaultIcon}
        </div>

        {/* Title */}
        <h2
          className="font-display text-2xl font-bold text-white mb-2"
          style={anim("badgePop 0.4s 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) both")}
        >
          {title}
        </h2>

        {subtitle && (
          <p
            className="text-white/50 text-sm mb-4"
            style={anim("badgePop 0.4s 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) both")}
          >
            {subtitle}
          </p>
        )}

        {/* Sprint 20 — Phase 8: optional stat row (e.g. total saved, level, streak) */}
        {stats && stats.length > 0 && (
          <div
            className="grid grid-cols-2 gap-2 mb-4"
            style={anim("badgePop 0.4s 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275) both")}
          >
            {stats.map((s) => (
              <div key={s.label} className="bg-surface-elevated rounded-xl px-3 py-2 text-center">
                <p className="text-white font-display font-bold text-sm">{s.value}</p>
                <p className="text-white/40 text-[11px] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* XP pill */}
        {!!xpGained && xpGained > 0 && (
          <div
            className="inline-flex items-center gap-1.5 bg-brand-500/15 border border-brand-500/30 rounded-full px-4 py-1.5 mb-5"
            style={anim("badgePop 0.4s 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) both")}
          >
            <span className="text-brand-400 font-display font-bold text-sm">+{xpGained} XP</span>
          </div>
        )}

        {/* Auto-dismiss progress bar for achievements */}
        {isAchievement && (
          <div className="w-full h-0.5 bg-surface-border rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-purple-400 rounded-full"
              style={anim("progressDrain 3s linear forwards")}
            />
          </div>
        )}

        <button
          onClick={onClose}
          className="btn-primary w-full"
          style={anim("badgePop 0.4s 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) both")}
        >
          {ctaLabel}
        </button>

        {isShareable && (
          <div className="mt-2.5" style={anim("badgePop 0.4s 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) both")}>
            <ShareButton
              title="SaveQuest"
              text={`I just ${
                type === "goal" ? `hit my "${title}" savings goal` :
                type === "streak" ? title :
                type === "levelup" ? title :
                `unlocked "${title}"`
              } on SaveQuest! 💪`}
              shareContext={type}
              className="w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}


