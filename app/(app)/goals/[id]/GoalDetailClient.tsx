"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatPercent, getDaysRemaining, GOAL_CATEGORIES } from "@/lib/utils";
import { getXPForAction } from "@/lib/xp";
import { ArrowLeft, Plus } from "lucide-react";
import CelebrationOverlay from "@/components/gamification/CelebrationOverlay";
import type { SavingsGoal, Transaction } from "@/lib/types";
import { format } from "date-fns";

interface Props {
  goal: SavingsGoal;
  transactions: Transaction[];
  streakDays: number;
}

export default function GoalDetailClient({ goal: initialGoal, transactions: initialTxs, streakDays }: Props) {
  const router = useRouter();
  const [goal, setGoal] = useState(initialGoal);
  const [transactions, setTransactions] = useState(initialTxs);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [celebration, setCelebration] = useState<{ show: boolean; title: string; subtitle: string; xpGained: number; icon?: string }>({
    show: false, title: "", subtitle: "", xpGained: 0,
  });

  const category = GOAL_CATEGORIES.find(c => c.id === goal.category) ?? GOAL_CATEGORIES[GOAL_CATEGORIES.length - 1];
  const percent = (Number(goal.current_amount) / Number(goal.target_amount)) * 100;
  const daysLeft = goal.target_date ? getDaysRemaining(goal.target_date) : null;

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return;
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const depositAmount = Number(amount);

    // Insert transaction
    const { data: tx, error: txError } = await supabase
      .from("transactions")
      .insert({ user_id: user.id, goal_id: goal.id, amount: depositAmount, note: note || null })
      .select()
      .single();

    if (txError) { setError(txError.message); setLoading(false); return; }

    // Calculate new amounts
    const newCurrentAmount = Number(goal.current_amount) + depositAmount;
    const isNowComplete = newCurrentAmount >= Number(goal.target_amount);

    // Award XP
    const xpGained = getXPForAction(isNowComplete ? "GOAL_COMPLETE" : "LOG_SAVING", streakDays);
    const { data: profile } = await supabase
      .from("profiles")
      .select("xp_total, current_level")
      .eq("id", user.id)
      .single();

    if (profile) {
      await supabase
        .from("profiles")
        .update({ xp_total: profile.xp_total + xpGained })
        .eq("id", user.id);
    }

    // Update local state
    setGoal(prev => ({ ...prev, current_amount: newCurrentAmount, is_complete: isNowComplete }));
    setTransactions(prev => [tx, ...prev]);
    setAmount("");
    setNote("");

    // Show celebration
    if (isNowComplete) {
      setCelebration({ show: true, title: "Goal Complete! 🎉", subtitle: `You saved ${formatCurrency(Number(goal.target_amount))}!`, xpGained, icon: "🏆" });
    } else {
      setCelebration({ show: true, title: "Saved!", subtitle: `${formatCurrency(depositAmount)} added to your goal`, xpGained, icon: category.icon });
    }

    setLoading(false);
    router.refresh();
  }

  const newPercent = (Number(goal.current_amount) / Number(goal.target_amount)) * 100;

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
              {category.icon}
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

        {/* Progress card */}
        <div className="card p-5 mb-4">
          <div className="flex justify-between items-end mb-3">
            <div>
              <p className="text-white/40 text-xs mb-0.5">Saved</p>
              <p className="font-display text-3xl font-bold text-white">{formatCurrency(Number(goal.current_amount))}</p>
            </div>
            <div className="text-right">
              <p className="text-white/40 text-xs mb-0.5">Target</p>
              <p className="font-display text-xl font-semibold text-white/60">{formatCurrency(Number(goal.target_amount))}</p>
            </div>
          </div>

          <div className="xp-bar-container h-3 mb-2">
            <div
              className="goal-bar-fill h-full"
              style={{ width: `${Math.min(100, newPercent)}%` }}
            />
          </div>

          <div className="flex justify-between">
            <span className="text-sm font-medium text-emerald-400">{formatPercent(newPercent)}</span>
            {daysLeft !== null && (
              <span className={`text-xs ${daysLeft <= 7 ? "text-red-400" : "text-white/30"}`}>
                {daysLeft > 0 ? `${daysLeft} days left` : "Past target date"}
              </span>
            )}
          </div>
        </div>

        {/* Log saving form */}
        {!goal.is_complete && (
          <div className="card p-4 mb-5">
            <h2 className="font-display font-semibold text-white mb-3 text-sm">Log a Saving</h2>
            <form onSubmit={handleDeposit} className="space-y-3">
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-display font-medium">R</span>
                <input
                  type="number"
                  className="input-field pl-8"
                  placeholder="Amount"
                  min="1"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  required
                />
              </div>
              <input
                className="input-field"
                placeholder="Note (optional) — e.g. skipped takeout"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2" disabled={loading}>
                <Plus size={16} />
                {loading ? "Saving…" : "Log Saving"}
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
              <p className="text-white/30 text-sm">No savings logged yet. Make your first deposit!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map(tx => (
                <div key={tx.id} className="card p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm">💰</div>
                    <div>
                      <p className="text-sm text-white font-medium">{formatCurrency(Number(tx.amount))}</p>
                      {tx.note && <p className="text-xs text-white/40">{tx.note}</p>}
                    </div>
                  </div>
                  <span className="text-xs text-white/30">
                    {format(new Date(tx.created_at), "MMM d")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CelebrationOverlay
        show={celebration.show}
        type="xp"
        title={celebration.title}
        subtitle={celebration.subtitle}
        xpGained={celebration.xpGained}
        icon={celebration.icon}
        onClose={() => setCelebration(prev => ({ ...prev, show: false }))}
      />
    </>
  );
}
