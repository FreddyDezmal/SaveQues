"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatAmount } from "@/lib/currency";
import { formatPercent, getDaysRemaining, getCategoryById } from "@/lib/utils";
import { getXPForAction } from "@/lib/xp";
import { ArrowLeft, Plus, Minus, ShoppingBag, ChevronRight } from "lucide-react";
import CelebrationOverlay from "@/components/gamification/CelebrationOverlay";
import type { SavingsGoal, Transaction } from "@/lib/types";
import { format } from "date-fns";

type TransactionType = "deposit" | "withdrawal" | "goal_purchase";

interface Props {
  goal: SavingsGoal;
  transactions: Transaction[];
  streakDays: number;
  currencyCode: string;
  locale: string;
}

export default function GoalDetailClient({ goal: initialGoal, transactions: initialTxs, streakDays, currencyCode, locale }: Props) {
  const router = useRouter();
  const fc = (amount: number) => formatAmount(amount, currencyCode, locale);

  const [goal, setGoal] = useState(initialGoal);
  const [transactions, setTransactions] = useState(initialTxs);
  const [txType, setTxType] = useState<TransactionType>("deposit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showNextGoalPrompt, setShowNextGoalPrompt] = useState(false);
  const [celebration, setCelebration] = useState<{
    show: boolean; title: string; subtitle: string; xpGained: number; icon?: string; type?: any;
  }>({ show: false, title: "", subtitle: "", xpGained: 0 });

  const category = getCategoryById(goal.category);
  const percent = goal.target_amount > 0
    ? (Number(goal.current_amount) / Number(goal.target_amount)) * 100
    : 0;
  const daysLeft = goal.target_date ? getDaysRemaining(goal.target_date) : null;

  const TX_CONFIG = {
    deposit: {
      label: "Log a Saving",
      placeholder: "Amount saved",
      icon: <Plus size={14} />,
      color: "emerald",
      buttonText: "Log Saving",
      noteHint: "e.g. skipped takeout, payday deposit",
    },
    withdrawal: {
      label: "Log a Withdrawal",
      placeholder: "Amount withdrawn",
      icon: <Minus size={14} />,
      color: "orange",
      buttonText: "Log Withdrawal",
      noteHint: "e.g. car repair, medical emergency",
    },
    goal_purchase: {
      label: "Goal Purchase",
      placeholder: "Amount spent",
      icon: <ShoppingBag size={14} />,
      color: "brand",
      buttonText: "Mark as Purchased",
      noteHint: "e.g. bought the flights, purchased the laptop",
    },
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return;
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const depositAmount = Number(amount);

    const { data: tx, error: txError } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        goal_id: goal.id,
        amount: depositAmount,
        note: note || null,
        transaction_type: txType,
      })
      .select()
      .single();

    if (txError) { setError(txError.message); setLoading(false); return; }

    // Recalculate local balance
    let newCurrentAmount = Number(goal.current_amount);
    if (txType === "deposit") {
      newCurrentAmount += depositAmount;
    } else {
      newCurrentAmount = Math.max(0, newCurrentAmount - depositAmount);
    }

    const isNowComplete = txType === "goal_purchase" && newCurrentAmount >= Number(goal.target_amount);

    // Award XP for deposits only
    if (txType === "deposit") {
      const xpGained = getXPForAction(
        isNowComplete ? "GOAL_COMPLETE" : "LOG_SAVING",
        streakDays
      );
      const { data: p } = await supabase.from("profiles").select("xp_total").eq("id", user.id).single();
      if (p) {
        await supabase.from("profiles").update({ xp_total: p.xp_total + xpGained }).eq("id", user.id);
      }
      await supabase.rpc("log_activity", { p_user_id: user.id, p_xp: xpGained });
    }

    setGoal(prev => ({ ...prev, current_amount: newCurrentAmount, is_complete: isNowComplete }));
    setTransactions(prev => [{ ...tx, transaction_type: txType } as any, ...prev]);
    setAmount("");
    setNote("");
    setLoading(false);

    // Celebration messaging per transaction type
    if (txType === "goal_purchase" && isNowComplete) {
      const xpGained = getXPForAction("GOAL_COMPLETE", streakDays);
      setCelebration({
        show: true,
        type: "goal",
        title: `${goal.title} — Done! 🎉`,
        subtitle: `You followed through. That's everything.`,
        xpGained,
        icon: (goal as any).goal_emoji || "🏆",
      });
      setShowNextGoalPrompt(true);
    } else if (txType === "withdrawal") {
      const newPercent = newCurrentAmount / Number(goal.target_amount) * 100;
      setCelebration({
        show: true,
        type: "xp",
        title: "Withdrawal logged",
        subtitle: `Life happens. Your goal is still ${Math.round(newPercent)}% complete — keep going when you're ready.`,
        xpGained: 0,
        icon: "🛡️",
      });
    } else if (txType === "deposit") {
      const xpGained = getXPForAction("LOG_SAVING", streakDays);
      const prevPercent = (Number(goal.current_amount) - depositAmount) / Number(goal.target_amount) * 100;
      const nextPercent = newCurrentAmount / Number(goal.target_amount) * 100;
      let subtitle = `${fc(depositAmount)} added to your goal`;
      if (prevPercent < 25 && nextPercent >= 25) subtitle = "25% there! You're building something real 🎯";
      else if (prevPercent < 50 && nextPercent >= 50) subtitle = "Halfway there! Keep this momentum 🔥";
      else if (prevPercent < 75 && nextPercent >= 75) subtitle = "75%! One more push and you're done ⚡";
      setCelebration({ show: true, type: "xp", title: "Saved!", subtitle, xpGained, icon: (goal as any).goal_emoji || category.icon });
    }

    router.refresh();
  }

  const newPercent = (Number(goal.current_amount) / Number(goal.target_amount)) * 100;

  function getTxIcon(type: string) {
    if (type === "deposit") return "💰";
    if (type === "withdrawal") return "🛡️";
    if (type === "goal_purchase") return "🎯";
    return "📝";
  }

  function getTxLabel(type: string) {
    if (type === "deposit") return "Deposit";
    if (type === "withdrawal") return "Withdrawal";
    if (type === "goal_purchase") return "Goal Purchase";
    return "Adjustment";
  }

  return (
    <>
      <div className="max-w-lg mx-auto px-4 pt-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <Link href="/goals" className="text-white/40 hover:text-white/70 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-3 flex-1">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
              style={{ backgroundColor: `${category.color}20` }}
            >
              {(goal as any).goal_emoji || category.icon}
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-white leading-tight">{goal.title}</h1>
              <p className="text-white/40 text-xs">{category.label}</p>
            </div>
          </div>
          {goal.is_complete && (
            <span className="text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 rounded-full px-3 py-1">
              Complete ✅
            </span>
          )}
        </div>

        {/* Progress */}
        <div className="card p-5 mb-4">
          <div className="flex justify-between items-end mb-3">
            <div>
              <p className="text-white/40 text-xs mb-0.5">Saved</p>
              <p className="font-display text-3xl font-bold text-white">{fc(Number(goal.current_amount))}</p>
            </div>
            <div className="text-right">
              <p className="text-white/40 text-xs mb-0.5">Target</p>
              <p className="font-display text-xl font-semibold text-white/60">{fc(Number(goal.target_amount))}</p>
            </div>
          </div>
          <div className="xp-bar-container h-3 mb-2">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${goal.is_complete ? "bg-emerald-500" : "goal-bar-fill"}`}
              style={{ width: `${Math.min(100, newPercent)}%` }}
            />
          </div>
          <div className="flex justify-between">
            <span className="text-sm font-medium text-emerald-400">{formatPercent(newPercent)}</span>
            {daysLeft !== null && !goal.is_complete && (
              <span className={`text-xs ${daysLeft <= 7 ? "text-red-400" : "text-white/30"}`}>
                {daysLeft > 0 ? `${daysLeft} days left` : "Past target date"}
              </span>
            )}
          </div>
        </div>

        {/* Transaction form */}
        {!goal.is_complete && (
          <div className="card p-4 mb-5">
            {/* Type selector */}
            <div className="flex gap-1.5 mb-4 bg-surface-elevated p-1 rounded-xl">
              {(["deposit", "withdrawal", "goal_purchase"] as TransactionType[]).map(type => {
                const cfg = TX_CONFIG[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => { setTxType(type); setError(""); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg text-xs font-medium transition-all duration-200 ${
                      txType === type
                        ? type === "deposit"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : type === "withdrawal"
                          ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                          : "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                        : "text-white/40 hover:text-white/60"
                    }`}
                  >
                    {cfg.icon}
                    <span className="hidden sm:inline">{type === "goal_purchase" ? "Purchase" : cfg.label.split(" ")[1]}</span>
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-white/50 mb-1.5">{TX_CONFIG[txType].label}</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-display font-medium text-sm">
                    {currencyCode === "ZAR" ? "R" : ""}
                  </span>
                  <input
                    type="number"
                    className="input-field pl-8"
                    placeholder={TX_CONFIG[txType].placeholder}
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    required
                  />
                </div>
              </div>

              <input
                className="input-field"
                placeholder={TX_CONFIG[txType].noteHint}
                value={note}
                onChange={e => setNote(e.target.value)}
              />

              {/* Contextual copy per transaction type */}
              {txType === "withdrawal" && (
                <div className="px-3 py-2.5 rounded-xl bg-orange-500/8 border border-orange-500/15">
                  <p className="text-xs text-orange-300">
                    Life happens. Withdrawals are tracked but your achievements and streak are safe.
                  </p>
                </div>
              )}

              {txType === "goal_purchase" && (
                <div className="px-3 py-2.5 rounded-xl bg-brand-500/8 border border-brand-500/15">
                  <p className="text-xs text-brand-300">
                    Mark this when you've spent the money on what you saved for. This completes your goal. 🎯
                  </p>
                </div>
              )}

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2" disabled={loading}>
                {loading ? "Saving…" : TX_CONFIG[txType].buttonText}
              </button>
            </form>
          </div>
        )}

        {/* Transaction history */}
        <div className="mb-6">
          <h2 className="font-display font-semibold text-white/60 text-xs uppercase tracking-wider mb-3">
            History ({transactions.length})
          </h2>
          {transactions.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-white/30 text-sm">No transactions yet. Log your first saving!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx: any) => {
                const isNegative = ["withdrawal", "goal_purchase", "adjustment"].includes(tx.transaction_type);
                return (
                  <div key={tx.id} className="card p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
                        isNegative ? "bg-orange-500/10" : "bg-emerald-500/10"
                      }`}>
                        {getTxIcon(tx.transaction_type)}
                      </div>
                      <div>
                        <p className="text-sm text-white font-medium">
                          {isNegative ? "-" : "+"}{fc(Number(tx.amount))}
                        </p>
                        {tx.note && <p className="text-xs text-white/40">{tx.note}</p>}
                        <p className="text-[10px] text-white/25">{getTxLabel(tx.transaction_type)}</p>
                      </div>
                    </div>
                    <span className="text-xs text-white/30">{format(new Date(tx.created_at), "MMM d")}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Celebrations */}
      <CelebrationOverlay
        show={celebration.show}
        type={celebration.type ?? "xp"}
        title={celebration.title}
        subtitle={celebration.subtitle}
        xpGained={celebration.xpGained}
        icon={celebration.icon}
        onClose={() => setCelebration(prev => ({ ...prev, show: false }))}
      />

      {/* Next goal prompt after goal_purchase completion */}
      {showNextGoalPrompt && !celebration.show && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
          <div
            className="w-full max-w-lg bg-surface-card rounded-t-3xl p-6 border-t border-surface-border"
            style={{ animation: "badgePop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards" }}
          >
            <div className="text-center mb-5">
              <div className="text-5xl mb-3">🚀</div>
              <h2 className="font-display text-xl font-bold text-white">What's next for you?</h2>
              <p className="text-white/50 text-sm mt-1">
                You proved you can follow through. Keep that momentum going.
              </p>
            </div>
            <div className="space-y-2">
              <Link
                href="/goals/new"
                className="btn-primary w-full flex items-center justify-center gap-2"
                onClick={() => setShowNextGoalPrompt(false)}
              >
                <Plus size={16} /> Start a New Goal
              </Link>
              <Link
                href="/goals"
                className="btn-ghost w-full flex items-center justify-center gap-2"
                onClick={() => setShowNextGoalPrompt(false)}
              >
                <ChevronRight size={16} /> See My Goal History
              </Link>
              <button
                onClick={() => setShowNextGoalPrompt(false)}
                className="w-full py-3 text-white/30 text-sm hover:text-white/50 transition-colors"
              >
                I'll decide later
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}