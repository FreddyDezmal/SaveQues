"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { generateReflection, type ReflectionData } from "@/lib/reflection";
import { X } from "lucide-react";

interface Props {
  data: ReflectionData;
  reflectionId: string;
  onClose: () => void;
}

export default function WeeklyReflectionModal({ data, reflectionId, onClose }: Props) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const reflection = generateReflection(data);

  async function handleDismiss() {
    setDismissed(true);
    const supabase = createClient();
    await supabase
      .from("weekly_reflections")
      .update({ viewed_at: new Date().toISOString() })
      .eq("id", reflectionId);
    onClose();
    router.refresh();
  }

  if (dismissed) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleDismiss}
    >
      <div
        className="w-full max-w-lg bg-surface-card rounded-t-3xl p-6 border-t border-surface-border"
        style={{ animation: "badgePop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-xs text-brand-400 font-bold uppercase tracking-wider mb-0.5">
              Weekly Reflection
            </p>
            <h2 className="font-display text-xl font-bold text-white">
              This week, {data.displayName}:
            </h2>
          </div>
          <button
            onClick={handleDismiss}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Achievement lines */}
        {reflection.lines.length > 0 ? (
          <div className="space-y-2 mb-5">
            {reflection.lines.map((line, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-emerald-500/8 border border-emerald-500/15"
              >
                <span className="text-emerald-400 text-sm">{line}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-5 px-4 py-3 rounded-xl bg-surface-elevated border border-surface-border">
            <p className="text-sm text-white/50">
              A quiet week — that's okay. Next week is a fresh start.
            </p>
          </div>
        )}

        {/* Goal progress */}
        <div className="mb-4 px-4 py-3 rounded-xl bg-brand-500/8 border border-brand-500/15">
          <p className="text-sm text-brand-300 leading-relaxed">{reflection.forwardLine}</p>
        </div>

        {/* Behavioural insight */}
        {reflection.insight && (
          <p className="text-xs text-white/40 italic mb-5 px-1">
            💡 {reflection.insight}
          </p>
        )}

        <button onClick={handleDismiss} className="btn-primary w-full">
          Keep going 🚀
        </button>
      </div>
    </div>
  );
}