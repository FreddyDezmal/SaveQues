"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Zap, CheckCircle, Clock, Trophy } from "lucide-react";
import CelebrationOverlay from "@/components/gamification/CelebrationOverlay";

interface Props {
  allChallenges: any[];
  userChallenges: any[];
  userId: string;
}

export default function QuestsClient({ allChallenges, userChallenges, userId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [celebration, setCelebration] = useState({ show: false, title: "", xpGained: 0 });

  const activeUCs = userChallenges.filter(uc => uc.status === "active");
  const completedUCs = userChallenges.filter(uc => uc.status === "completed");
  const activeIds = new Set(activeUCs.map((uc: any) => uc.challenge_id));
  const completedIds = new Set(completedUCs.map((uc: any) => uc.challenge_id));

  const availableChallenges = allChallenges.filter(c => !activeIds.has(c.id) && !completedIds.has(c.id));

  async function acceptChallenge(challengeId: string, xpReward: number, title: string) {
    setLoading(challengeId);
    const supabase = createClient();
    await supabase.from("user_challenges").insert({
      user_id: userId,
      challenge_id: challengeId,
      status: "active",
      started_at: new Date().toISOString(),
    });
    setLoading(null);
    setCelebration({ show: true, title: `Quest Accepted: ${title}!`, xpGained: xpReward });
    router.refresh();
  }

  async function completeChallenge(ucId: string, xpReward: number, title: string) {
    setLoading(ucId);
    const supabase = createClient();
    await supabase
      .from("user_challenges")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", ucId);

    // Award XP
    const { data: profile } = await supabase.from("profiles").select("xp_total").eq("id", userId).single();
    if (profile) {
      await supabase.from("profiles").update({ xp_total: profile.xp_total + xpReward }).eq("id", userId);
    }

    setLoading(null);
    setCelebration({ show: true, title: `Quest Complete: ${title}! 🎉`, xpGained: xpReward });
    router.refresh();
  }

  return (
    <>
      <div className="max-w-lg mx-auto px-4 pt-6">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-white">Quests</h1>
          <p className="text-white/40 text-sm mt-0.5">Accept challenges. Earn XP. Build habits.</p>
        </div>

        {/* Active quests */}
        {activeUCs.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={14} className="text-brand-400" />
              <h2 className="font-display font-semibold text-white/80 text-xs uppercase tracking-wider">Active</h2>
            </div>
            <div className="space-y-3">
              {activeUCs.map((uc: any) => {
                const ch = uc.challenges;
                if (!ch) return null;
                return (
                  <div key={uc.id} className="card p-4 border-brand-500/20">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="font-display font-semibold text-white text-sm">{ch.title}</h3>
                        <p className="text-xs text-white/40 mt-1">{ch.description}</p>
                      </div>
                      <div className="flex items-center gap-1 bg-brand-500/10 border border-brand-500/20 rounded-full px-2.5 py-1 ml-3">
                        <Zap size={11} className="text-brand-400" />
                        <span className="text-brand-400 text-xs font-bold">{ch.xp_reward}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => completeChallenge(uc.id, ch.xp_reward, ch.title)}
                      disabled={loading === uc.id}
                      className="w-full btn-primary text-sm py-2.5 mt-1"
                    >
                      {loading === uc.id ? "Claiming…" : "Mark Complete ✅"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Available quests */}
        {availableChallenges.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={14} className="text-white/40" />
              <h2 className="font-display font-semibold text-white/60 text-xs uppercase tracking-wider">Available</h2>
            </div>
            <div className="space-y-3">
              {availableChallenges.map((ch: any) => (
                <div key={ch.id} className="card p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-display font-semibold text-white text-sm">{ch.title}</h3>
                      <p className="text-xs text-white/40 mt-1">{ch.description}</p>
                      <p className="text-xs text-white/30 mt-1">⏱ {ch.duration_days} day{ch.duration_days !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="flex items-center gap-1 bg-surface-elevated border border-surface-border rounded-full px-2.5 py-1 ml-3">
                      <Zap size={11} className="text-white/40" />
                      <span className="text-white/50 text-xs font-bold">{ch.xp_reward}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => acceptChallenge(ch.id, ch.xp_reward, ch.title)}
                    disabled={loading === ch.id}
                    className="w-full btn-ghost text-sm py-2.5"
                  >
                    {loading === ch.id ? "Accepting…" : "⚔️ Accept Quest"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed */}
        {completedUCs.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle size={14} className="text-emerald-400" />
              <h2 className="font-display font-semibold text-emerald-400/70 text-xs uppercase tracking-wider">Completed</h2>
            </div>
            <div className="space-y-2 opacity-60">
              {completedUCs.map((uc: any) => {
                const ch = uc.challenges;
                if (!ch) return null;
                return (
                  <div key={uc.id} className="card p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle size={18} className="text-emerald-400 flex-shrink-0" />
                      <p className="text-sm text-white/60">{ch.title}</p>
                    </div>
                    <span className="text-xs text-emerald-400">+{ch.xp_reward} XP</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {availableChallenges.length === 0 && activeUCs.length === 0 && (
          <div className="card p-10 text-center">
            <div className="text-4xl mb-3">⚔️</div>
            <p className="text-white/40 text-sm">All quests complete! New ones coming soon.</p>
          </div>
        )}
      </div>

      <CelebrationOverlay
        show={celebration.show}
        type="challenge"
        title={celebration.title}
        xpGained={celebration.xpGained}
        icon="⚔️"
        onClose={() => setCelebration(prev => ({ ...prev, show: false }))}
      />
    </>
  );
}
