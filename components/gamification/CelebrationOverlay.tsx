"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface Props {
  show: boolean;
  type: "xp" | "levelup" | "badge" | "goal" | "streak";
  title: string;
  subtitle?: string;
  icon?: string;
  xpGained?: number;
  onClose: () => void;
}

export default function CelebrationOverlay({ show, type, title, subtitle, icon, xpGained, onClose }: Props) {
  const [confetti, setConfetti] = useState<{ x: number; y: number; color: string; delay: number }[]>([]);

  useEffect(() => {
      if (show) {
        const count = type === "goal" ? 35 : 15;
        const pieces = Array.from({ length: count }, () => ({
          x: Math.random() * 100,
          y: Math.random() * 40,
          color: ["#ffb800", "#10b981", "#8b5cf6", "#ef4444", "#3b82f6"][Math.floor(Math.random() * 5)],
          delay: Math.random() * 0.6,
        }));
        setConfetti(pieces);
      }
    }, [show, type]);

  if (!show) return null;

const isGoalComplete = type === "goal";
  const confettiCount = isGoalComplete ? 35 : 15;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm mx-4 card p-8 text-center overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ animation: "badgePop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards" }}
      >
        {/* Confetti — more pieces for goal completions */}
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

        {/* Icon — pops in with slight delay for stagger feel */}
        <div
          className="text-6xl mb-4"
          style={{ animation: "badgePop 0.5s 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275) both" }}
        >
          {icon ?? (type === "levelup" ? "⬆️" : type === "badge" ? "🏅" : type === "goal" ? "🏆" : type === "streak" ? "🔥" : "⚡")}
        </div>

        {/* Title */}
        <h2
          className="font-display text-2xl font-bold text-white mb-2"
          style={{ animation: "badgePop 0.4s 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) both" }}
        >
          {title}
        </h2>

        {subtitle && (
          <p
            className="text-white/50 text-sm mb-4"
            style={{ animation: "badgePop 0.4s 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) both" }}
          >
            {subtitle}
          </p>
        )}

        {/* XP pill — animates in last for stagger */}
        {xpGained && (
          <div
            className="inline-flex items-center gap-1.5 bg-brand-500/15 border border-brand-500/30 rounded-full px-4 py-1.5 mb-5"
            style={{ animation: "badgePop 0.4s 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) both" }}
          >
            <span className="text-brand-400 font-display font-bold text-sm">+{xpGained} XP</span>
          </div>
        )}

        <button
          onClick={onClose}
          className="btn-primary w-full"
          style={{ animation: "badgePop 0.4s 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) both" }}
        >
          {isGoalComplete ? "Claim Reward! 🎊" : type === "streak" ? "Keep it up! 🔥" : "Awesome! 🚀"}
        </button>
      </div>
    </div>
  );
}
