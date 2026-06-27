"use client";

/**
 * components/gamification/DailyQuestCard.tsx — SECURITY HARDENED
 *
 * This is the dashboard widget version of the daily quest card.
 * XP is now awarded through POST /api/quest/daily/complete — identical
 * to QuestsClient. No direct Supabase profile writes.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getTodaysDailyQuest } from "@/lib/quests";
import { getXPForAction } from "@/lib/xp";
import CelebrationOverlay from "./CelebrationOverlay";
import { CheckCircle, Zap } from "lucide-react";

interface Props {
  userId: string;
  streakDays: number;
  completedToday: boolean;
  todayQuestId?: string;
}

export default function DailyQuestCard({ userId, streakDays, completedToday: initialCompleted }: Props) {
  const router = useRouter();
  const [completed, setCompleted]     = useState(initialCompleted);
  const [loading, setLoading]         = useState(false);
  const [celebration, setCelebration] = useState({ show: false, xp: 0 });

  // getTodaysDailyQuest uses Date.now() — must be client-only to avoid
  // hydration mismatch when server and client are in different UTC days.
  const [quest, setQuest]       = useState<ReturnType<typeof getTodaysDailyQuest> | null>(null);
  const [xpReward, setXpReward] = useState(0);
  useEffect(() => {
    const q = getTodaysDailyQuest();
    setQuest(q);
    setXpReward(getXPForAction("DAILY_QUEST_COMPLETE", streakDays));
  }, [streakDays]);

  if (!quest) return null; // renders nothing server-side, populated after mount

  async function completeQuest() {
    if (completed || loading) return;
    setLoading(true);

    const res  = await fetch("/api/quest/daily/complete", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ questId: quest.id }),
    });
    const data = await res.json();

    if (!res.ok) {
      console.error("[DailyQuestCard]", data.error);
      setLoading(false);
      return;
    }

    setCompleted(true);
    setLoading(false);
    setCelebration({ show: true, xp: data.xpGained ?? 0 });
    router.refresh();
  }

  if (completed) {
    return (
      <div className="card p-4 border-emerald-500/20">
        <div className="flex items-center gap-3">
          <CheckCircle size={20} className="text-emerald-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-white">Daily Quest Complete!</p>
            <p className="text-xs text-white/40">{quest.title} — come back tomorrow</p>
          </div>
          <div className="ml-auto flex items-center gap-1 text-emerald-400 text-xs font-bold">
            <Zap size={12} />+{xpReward}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card p-4 border-brand-500/20">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-brand-500/15 border border-brand-500/20 flex items-center justify-center text-xl flex-shrink-0">
            {quest.icon}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] text-brand-400 uppercase tracking-wider font-bold">Daily Quest</span>
            </div>
            <p className="font-display font-semibold text-white text-sm">{quest.title}</p>
            <p className="text-xs text-white/50 mt-0.5">{quest.description}</p>
          </div>
          <div className="flex items-center gap-1 bg-brand-500/10 border border-brand-500/20 rounded-full px-2.5 py-1 flex-shrink-0">
            <Zap size={11} className="text-brand-400" />
            <span className="text-brand-400 text-xs font-bold">{xpReward}</span>
          </div>
        </div>
        <button onClick={completeQuest} disabled={loading} className="btn-primary w-full text-sm py-2.5">
          {loading ? "Claiming…" : "Complete Quest ✓"}
        </button>
      </div>

      <CelebrationOverlay
        show={celebration.show}
        type="xp"
        title="Daily Quest Done!"
        subtitle={quest.title}
        xpGained={celebration.xp}
        icon={quest.icon}
        onClose={() => setCelebration({ show: false, xp: 0 })}
      />
    </>
  );
}