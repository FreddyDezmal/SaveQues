"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface Props {
  show: boolean;
  type: "xp" | "levelup" | "badge" | "goal" | "streak" | "challenge";
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
      const pieces = Array.from({ length: 20 }, () => ({
        x: Math.random() * 100,
        y: Math.random() * 40,
        color: ["#ffb800", "#10b981", "#8b5cf6", "#ef4444", "#3b82f6"][Math.floor(Math.random() * 5)],
        delay: Math.random() * 0.5,
      }));
      setConfetti(pieces);
    }
  }, [show]);

  if (!show) return null;

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
        {/* Confetti */}
        {confetti.map((c, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-sm"
            style={{
              left: `${c.x}%`,
              top: `${c.y}%`,
              backgroundColor: c.color,
              animation: `confettiFall 1s ease-out ${c.delay}s forwards`,
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

        {/* Icon */}
        <div className="text-6xl mb-4" style={{ animation: "badgePop 0.5s 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275) both" }}>
          {
            icon ??
            (
              type === "levelup" ? "⬆️" :
              type === "badge" ? "🏅" :
              type === "goal" ? "🎉" :
              type === "streak" ? "🔥" :
              type === "challenge" ? "⚔️" :
              "⚡"
            )
          }
        </div>

        <h2 className="font-display text-2xl font-bold text-white mb-2">{title}</h2>
        {subtitle && <p className="text-white/50 text-sm mb-4">{subtitle}</p>}

        {xpGained && (
          <div className="inline-flex items-center gap-1.5 bg-brand-500/15 border border-brand-500/30 rounded-full px-4 py-1.5 mb-5">
            <span className="text-brand-400 font-display font-bold text-sm">+{xpGained} XP</span>
          </div>
        )}

        <button onClick={onClose} className="btn-primary w-full">
          {type === "goal" ? "Claim Reward! 🎊" : "Awesome! 🚀"}
        </button>
      </div>
    </div>
  );
}
