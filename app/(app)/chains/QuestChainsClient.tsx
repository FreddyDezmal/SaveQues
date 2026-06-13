"use client";

/**
 * app/(app)/chains/QuestChainsClient.tsx — SECURITY HARDENED
 *
 * Changes from original:
 *  • claimStep() now calls POST /api/quest/chain/step — no direct
 *    Supabase profile.xp_total writes from the browser.
 *  • startChain() retains a direct Supabase call (it's XP-free and
 *    quest_chain_progress is RLS-scoped to the user).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { QuestChain } from "@/lib/quests";
import { ChevronRight, Lock, CheckCircle, Zap } from "lucide-react";
import CelebrationOverlay from "@/components/gamification/CelebrationOverlay";

interface Props {
  chains: QuestChain[];
  progress: any[];
  userId: string;
}

export default function QuestChainsClient({ chains, progress, userId }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading]   = useState<string | null>(null);
  const [celebration, setCelebration] = useState({ show: false, title: "", xp: 0, icon: "" });

  const progressMap = new Map(progress.map(p => [p.chain_id, p]));

  // Start is XP-free — direct Supabase upsert is fine.
  async function startChain(chainId: string) {
    setLoading(chainId);
    const supabase = createClient();
    await supabase.from("quest_chain_progress").upsert({
      user_id:      userId,
      chain_id:     chainId,
      current_step: 1,
      status:       "active",
    }, { onConflict: "user_id,chain_id" });
    setLoading(null);
    router.refresh();
  }

  // Claim goes through the server route — complete_chain_step() DB function
  // advances the step atomically and awards XP via award_xp().
  async function claimStep(chain: QuestChain, stepNumber: number) {
    setLoading(chain.id + stepNumber);

    const res  = await fetch("/api/quest/chain/step", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chainId: chain.id, stepNumber }),
    });
    const data = await res.json();

    if (!res.ok) {
      console.error("[claimStep]", data.error);
      setLoading(null);
      return;
    }

    const isLastStep = stepNumber === chain.steps.length;

    setLoading(null);
    setCelebration({
      show:  true,
      title: isLastStep ? `Chain Complete: ${chain.title}! 🎉` : `Step ${stepNumber} Done!`,
      xp:    data.xpGained ?? 0,
      icon:  chain.icon,
    });
    router.refresh();
  }

  return (
    <>
      <div className="max-w-lg mx-auto px-4 pt-6">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-white">Quest Chains</h1>
          <p className="text-white/40 text-sm mt-0.5">Progress through chains to earn massive XP rewards</p>
        </div>

        <div className="space-y-3">
          {chains.map(chain => {
            const prog        = progressMap.get(chain.id);
            const isStarted   = !!prog;
            const isComplete  = prog?.status === "completed";
            const currentStep = prog?.current_step ?? 1;
            const isOpen      = expanded === chain.id;
            const totalChainXP = chain.steps.reduce((s, step) => s + step.xpReward, 0) + chain.completionXP;

            return (
              <div key={chain.id} className={`card overflow-hidden transition-all duration-200 ${
                isComplete ? "border-emerald-500/20" :
                isStarted  ? "border-brand-500/20" : ""
              }`}>
                <button
                  className="w-full p-4 flex items-center gap-3 text-left"
                  onClick={() => setExpanded(isOpen ? null : chain.id)}
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${
                    isComplete ? "bg-emerald-500/15 border border-emerald-500/20" :
                    isStarted  ? "bg-brand-500/15 border border-brand-500/20" :
                    "bg-surface-elevated border border-surface-border"
                  }`}>
                    {chain.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-display font-semibold text-white text-sm truncate">{chain.title}</p>
                      {isComplete && <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />}
                    </div>
                    <p className="text-xs text-white/40 truncate">{chain.description}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      {isStarted && !isComplete && (
                        <>
                          <div className="flex-1 h-1 bg-surface-border rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand-500 rounded-full"
                              style={{ width: `${((currentStep - 1) / chain.steps.length) * 100}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-brand-400 flex-shrink-0">{currentStep - 1}/{chain.steps.length}</span>
                        </>
                      )}
                      {!isStarted  && <span className="text-[10px] text-white/30">{chain.steps.length} steps</span>}
                      {isComplete  && <span className="text-[10px] text-emerald-400">Completed!</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="flex items-center gap-1 text-xs text-white/40">
                      <Zap size={11} />{totalChainXP.toLocaleString()}
                    </div>
                    <ChevronRight size={14} className={`text-white/20 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  </div>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 border-t border-surface-border pt-3 space-y-2">
                    {chain.steps.map(step => {
                      const stepDone   = isStarted && step.stepNumber < currentStep;
                      const stepActive = isStarted && step.stepNumber === currentStep && !isComplete;
                      const stepLocked = !isStarted || step.stepNumber > currentStep;

                      return (
                        <div key={step.stepNumber} className={`flex items-start gap-3 p-3 rounded-xl ${
                          stepActive ? "bg-brand-500/8 border border-brand-500/20" :
                          stepDone   ? "bg-emerald-500/5 border border-emerald-500/10" :
                          "bg-surface-elevated border border-transparent"
                        }`}>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${
                            stepDone   ? "bg-emerald-500/20 text-emerald-400" :
                            stepActive ? "bg-brand-500/20 text-brand-400 border border-brand-500/30" :
                            "bg-surface-border text-white/20"
                          }`}>
                            {stepDone ? "✓" : stepLocked ? <Lock size={10} /> : step.stepNumber}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${stepDone ? "text-white/50 line-through" : stepActive ? "text-white" : "text-white/30"}`}>
                              {step.title}
                            </p>
                            <p className="text-xs text-white/30 mt-0.5">{step.description}</p>
                          </div>
                          <div className="flex items-center gap-1 text-xs flex-shrink-0">
                            <Zap size={10} className={stepDone ? "text-emerald-400" : stepActive ? "text-brand-400" : "text-white/20"} />
                            <span className={stepDone ? "text-emerald-400" : stepActive ? "text-brand-400" : "text-white/20"}>
                              {step.xpReward}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    <div className="flex items-center justify-between p-3 rounded-xl bg-brand-500/5 border border-brand-500/10 mt-1">
                      <span className="text-xs text-brand-400 font-medium">Completion Bonus</span>
                      <div className="flex items-center gap-1 text-brand-400">
                        <Zap size={11} /><span className="text-sm font-bold">+{chain.completionXP}</span>
                      </div>
                    </div>

                    {!isStarted && (
                      <button
                        onClick={() => startChain(chain.id)}
                        disabled={loading === chain.id}
                        className="btn-primary w-full text-sm py-2.5 mt-2"
                      >
                        {loading === chain.id ? "Starting…" : "Start Chain " + chain.icon}
                      </button>
                    )}
                    {isStarted && !isComplete && (
                      <button
                        onClick={() => claimStep(chain, currentStep)}
                        disabled={!!loading}
                        className="btn-primary w-full text-sm py-2.5 mt-2"
                      >
                        {loading ? "Claiming…" : `Claim Step ${currentStep} ✓`}
                      </button>
                    )}
                    {isComplete && (
                      <div className="text-center py-2 text-emerald-400 text-sm font-medium">
                        ✅ Chain Complete!
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <CelebrationOverlay
        show={celebration.show}
        type="badge"
        title={celebration.title}
        xpGained={celebration.xp}
        icon={celebration.icon}
        onClose={() => setCelebration(p => ({ ...p, show: false }))}
      />
    </>
  );
}
