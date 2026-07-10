"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatAmount } from "@/lib/currency";
import { formatPercent, getDaysRemaining, getCategoryById } from "@/lib/utils";
import { getXPForAction } from "@/lib/xp";
import { ArrowLeft, Plus, Minus, ShoppingBag, ChevronRight, Pencil, Trash2, X, Check } from "lucide-react";
import { GOAL_EMOJIS } from "@/lib/utils";
import CelebrationOverlay from "@/components/gamification/CelebrationOverlay";
import TimelineEventRow from "@/components/timeline/TimelineEventRow";
import type { TimelineEventGroup } from "@/lib/types";
import { useOnlineStatus } from "@/lib/hooks/useOnlineStatus";
import { forecastGoal } from "@/lib/forecast";
import { computeGoalHealth } from "@/lib/goalHealth";
import { coachingMessagesForGoal } from "@/lib/coaching";
import { buildCelebrationStats } from "@/lib/celebrationSummary";
import GoalIntelligenceCard from "@/components/goals/GoalIntelligenceCard";

type TxType = "deposit" | "withdrawal" | "goal_purchase";

interface Props {
  goal: any;
  transactions: any[];
  streakDays: number;
  xpTotal?: number;
  currencyCode: string;
  locale: string;
  timelineGroups: TimelineEventGroup[];
}

export default function GoalDetailClient({ goal: initialGoal, transactions: initialTxs, streakDays, xpTotal = 0, currencyCode, locale, timelineGroups: initialGroups }: Props) {
  const router = useRouter();
  const fc = useCallback((n: number) => formatAmount(n, currencyCode, locale), [currencyCode, locale]);

  const [goal, setGoal]                 = useState(initialGoal);
  const [transactions, setTransactions]  = useState(initialTxs);
  const [timelineGroups, setTimelineGroups] = useState(initialGroups);
  const [txType, setTxType]            = useState<TxType>("deposit");
  const [amount, setAmount]            = useState("");
  const [note, setNote]                = useState("");
  const [loading, setLoading]          = useState(false);
  const [error, setError]              = useState("");
  const [showNextGoal, setShowNextGoal] = useState(false);

  // Sprint 14: financial-safety gate. Deposits/withdrawals must never
  // execute (or appear to execute) while offline — see useOnlineStatus.ts
  // for the full reasoning. Read once per render; the button below also
  // subscribes to this so it re-enables automatically on reconnect with no
  // page reload needed.
  const isOnline = useOnlineStatus();

  // ── Sprint 19: Intelligence layer ────────────────────────────────────────
  // Pure client-side derivation from data this component already fetched —
  // no extra network round-trip. Recomputes only when the goal or its
  // transaction list actually changes (e.g. after a deposit).
  const forecast = useMemo(() => forecastGoal(goal, transactions), [goal, transactions]);
  const health   = useMemo(() => computeGoalHealth(goal, transactions), [goal, transactions]);
  const coaching = useMemo(() => coachingMessagesForGoal(goal, transactions), [goal, transactions]);


  // ── Idempotency key (Sprint 10 — Part 1) ────────────────────────
  // Generated lazily via a ref, NOT useState — a ref persists across
  // re-renders without itself causing one, and critically does NOT
  // regenerate on every render the way a useState initializer with an
  // unstable dependency might. The key is created the FIRST time a
  // submission is attempted for the form's current "session" (i.e.
  // since the last successful submit), and explicitly cleared only
  // after a confirmed success — never on error, never on re-render.
  // This means: double-click → same key both times → server-side
  // dedup catches it. Network failure → user clicks "try again" →
  // SAME key is reused → server-side dedup still catches it, even
  // though this is technically a second HTTP request from the
  // browser's point of view. Regenerating on every render or on every
  // keystroke would defeat the entire purpose — the key must outlive
  // the specific user action it represents, not the component render.
  const depositKeyRef = useRef<string | null>(null);
  function getOrCreateIdempotencyKey(): string {
    if (!depositKeyRef.current) {
      depositKeyRef.current = crypto.randomUUID();
    }
    return depositKeyRef.current;
  }
  function clearIdempotencyKey(): void {
    depositKeyRef.current = null;
  }

  // ── Edit goal state ───────────────────────────────────────────
  const [showEdit, setShowEdit]         = useState(false);
  const [editTitle, setEditTitle]       = useState(goal.title);
  const [editEmoji, setEditEmoji]       = useState(goal.goal_emoji || "⭐");
  const [editTarget, setEditTarget]     = useState(String(goal.target_amount));
  const [editLoading, setEditLoading]   = useState(false);
  const [editError, setEditError]       = useState("");

  // ── Delete goal state ─────────────────────────────────────────
  const [showDelete, setShowDelete]     = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError]   = useState("");
  const [celebration, setCelebration]  = useState<{
    show: boolean; title: string; subtitle: string; xpGained: number; icon?: string; type?: any;
  }>({ show: false, title: "", subtitle: "", xpGained: 0 });

  // Sprint 20 — Phase 8: only computed (and only rendered) for the "goal"
  // celebration type — every other celebration type keeps its existing,
  // simpler overlay exactly as before. Must be declared after `celebration`
  // itself (above) since it reads celebration.type.
  const celebrationStats = useMemo(
    () =>
      celebration.type === "goal"
        ? buildCelebrationStats({
            celebrationType: "goal",
            xpTotal,
            streakDays,
            transactions,
            formatAmount: fc,
            completedGoal: { title: goal.title, target_amount: Number(goal.target_amount) },
          })
        : [],
    [celebration.type, streakDays, xpTotal, transactions, goal, fc]
  );

  const category  = getCategoryById(goal.category);
  const percent   = goal.target_amount > 0 ? (Number(goal.current_amount) / Number(goal.target_amount)) * 100 : 0;
  const daysLeft  = goal.target_date ? getDaysRemaining(goal.target_date) : null;

  const TX = {
    deposit:      { label: "Log a Saving",     placeholder: "Amount saved",     icon: <Plus size={14} />,        buttonText: "Log Saving",       hint: "e.g. skipped takeout, payday transfer" },
    withdrawal:   { label: "Log a Withdrawal", placeholder: "Amount withdrawn",  icon: <Minus size={14} />,       buttonText: "Log Withdrawal",   hint: "e.g. car repair, medical bill" },
    goal_purchase:{ label: "Goal Purchase",    placeholder: "Amount spent",      icon: <ShoppingBag size={14} />, buttonText: "Mark as Purchased", hint: "e.g. bought the flights, got the laptop" },
  };

  // Achievement overlay state — shown after deposits when badges unlock
  const [achievementQueue, setAchievementQueue] = useState<{ title: string; icon: string; xpReward: number }[]>([]);
  const [currentAchievement, setCurrentAchievement] = useState<{ title: string; icon: string; xpReward: number } | null>(null);

  function dismissAchievement() {
    setCurrentAchievement(null);
    // Small delay before showing next in queue
    setTimeout(() => {
      setAchievementQueue(prev => {
        if (prev.length === 0) return prev;
        const [next, ...rest] = prev;
        setCurrentAchievement(next);
        return rest;
      });
    }, 400);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Sprint 14: hard safety net, not just a disabled-button convenience.
    // Disabling the submit button alone does NOT stop this handler from
    // firing — pressing Enter inside the amount <input> submits the <form>
    // directly regardless of the button's disabled attribute. This check
    // is what actually guarantees a financial mutation is never attempted
    // offline; the disabled button is the (also necessary) visible half of
    // the same guarantee.
    if (!isOnline) {
      setError("You're offline — reconnect to log this safely.");
      return;
    }

    if (!amount || Number(amount) <= 0) return;
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const depositAmount = Number(amount);

    // Route deposits through /api/transactions for achievement checking.
    // Withdrawals and purchases insert directly (no achievement triggers for those).
    if (txType === "deposit") {
      const res  = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal_id: goal.id,
          amount: depositAmount,
          note: note || null,
          idempotency_key: getOrCreateIdempotencyKey(),
        }),
      });
      const data = await res.json();

      if (!res.ok) { setError(data.error ?? "Failed to log saving"); setLoading(false); return; }

      // Success (including a server-detected duplicate, which is also a
      // safe terminal state) — this logical action is done, so the next
      // submission is a NEW action and gets a NEW key.
      clearIdempotencyKey();

      const newAmount      = Number(goal.current_amount) + depositAmount;
      const isNowComplete  = newAmount >= Number(goal.target_amount);

      setGoal((prev: any) => ({ ...prev, current_amount: newAmount, is_complete: isNowComplete }));
      setTransactions((prev: any[]) => [{ id: Date.now(), goal_id: goal.id, amount: depositAmount, note: note || null, transaction_type: "deposit", created_at: new Date().toISOString() }, ...prev]);
      setAmount(""); setNote(""); setLoading(false);

      // Queue achievement overlays
      if (data.newAchievements?.length > 0) {
        const [first, ...rest] = data.newAchievements as { id: string; title: string; icon: string; xpReward: number }[];
        setCurrentAchievement({ title: first.title, icon: first.icon, xpReward: first.xpReward });
        setAchievementQueue(rest.map((a: any) => ({ title: a.title, icon: a.icon, xpReward: a.xpReward })));
      }

      const prevPct = (Number(goal.current_amount)) / Number(goal.target_amount) * 100;
      const nextPct = newAmount / Number(goal.target_amount) * 100;
      let subtitle = `${fc(depositAmount)} added to your goal`;
      if (prevPct < 25 && nextPct >= 25)  subtitle = "25% there! You're building something real 🎯";
      else if (prevPct < 50 && nextPct >= 50) subtitle = "Halfway there! Keep this momentum 🔥";
      else if (prevPct < 75 && nextPct >= 75) subtitle = "75%! One more push and you're done ⚡";
      else if (isNowComplete) subtitle = "You did it. 🏆";

      setCelebration({ show: true, type: isNowComplete ? "goal" : "xp", title: isNowComplete ? "Goal Complete! 🎉" : "Saved!", subtitle, xpGained: data.xpGained, icon: goal.goal_emoji || category.icon });
      router.refresh();
      return;
    }

    // Withdrawals and purchases — routed through /api/transactions/withdrawal
    // so the server can record activity_log for Day Momentum (no XP for
    // these actions, but the day still counts as "active"). Achievement
    // checks are intentionally skipped for these transaction types, matching
    // prior behaviour.
    const wRes = await fetch("/api/transactions/withdrawal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal_id: goal.id,
        amount: depositAmount,
        note: note || null,
        transaction_type: txType,
        idempotency_key: getOrCreateIdempotencyKey(),
      }),
    });
    const wData = await wRes.json();

    if (!wRes.ok) { setError(wData.error ?? "Failed to log transaction"); setLoading(false); return; }

    // Success (including a server-detected duplicate) — clear so the next
    // submission gets a fresh key.
    clearIdempotencyKey();

    const tx = wData.transaction;
    const newAmount = wData.goal?.current_amount != null
      ? Number(wData.goal.current_amount)
      : Math.max(0, Number(goal.current_amount) - depositAmount);
    const isNowComplete = txType === "goal_purchase" && (wData.goal?.is_complete ?? newAmount <= 0);

    if (txType === "goal_purchase" && isNowComplete) {
      // XP awarded server-side through awardGoalCompleteXP() — no direct browser write.
      const xpRes  = await fetch("/api/goal/purchase-complete", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ goalId: goal.id }),
      });
      const xpData = xpRes.ok ? await xpRes.json() : { xpGained: 0 };
      setCelebration({ show: true, type: "goal", title: `${goal.title} — Done! 🎉`, subtitle: "You followed through. That's everything.", xpGained: xpData.xpGained ?? 0, icon: goal.goal_emoji || "🏆" });
      setShowNextGoal(true);
    } else {
      const newPct = Math.round(newAmount / Number(goal.target_amount) * 100);
      setCelebration({ show: true, type: "xp", title: "Withdrawal logged", subtitle: `Life happens. Your goal is still ${newPct}% complete — keep going when you're ready.`, xpGained: 0, icon: "🛡️" });
    }

    setGoal((prev: any) => ({ ...prev, current_amount: newAmount, is_complete: isNowComplete }));
    setTransactions((prev: any[]) => [{ ...tx, transaction_type: txType }, ...prev]);
    setAmount(""); setNote(""); setLoading(false);
    router.refresh();
  }

  const newPercent = goal.target_amount > 0 ? (Number(goal.current_amount) / Number(goal.target_amount)) * 100 : 0;

  // ── Edit handler ──────────────────────────────────────────────
  async function handleEditSave() {
    const newTarget = Number(editTarget);
    if (!editTitle.trim()) { setEditError("Title cannot be empty."); return; }
    if (!newTarget || newTarget <= 0) { setEditError("Target must be greater than 0."); return; }
    if (newTarget < Number(goal.current_amount)) {
      setEditError(`Target cannot be less than the amount already saved (${fc(Number(goal.current_amount))}).`);
      return;
    }
    setEditLoading(true);
    setEditError("");
    const res  = await fetch("/api/goal/edit", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ goal_id: goal.id, title: editTitle.trim(), goal_emoji: editEmoji, target_amount: newTarget }),
    });
    const data = await res.json();
    if (!res.ok) { setEditError(data.error ?? "Failed to save changes."); setEditLoading(false); return; }
    setGoal((prev: any) => ({ ...prev, title: data.goal.title, goal_emoji: data.goal.goal_emoji, target_amount: data.goal.target_amount }));
    setShowEdit(false);
    setEditLoading(false);
    router.refresh();
  }

  // ── Delete handler ────────────────────────────────────────────
  async function handleDelete() {
    setDeleteLoading(true);
    setDeleteError("");
    const res = await fetch("/api/goal/delete", {
      method:  "DELETE",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ goal_id: goal.id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error ?? "Failed to delete goal. Please try again.");
      setDeleteLoading(false);
      return;
    }
    router.push("/goals");
    router.refresh();
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
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
              style={{ backgroundColor: `${category.color}20` }}>
              {goal.goal_emoji || category.icon}
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
          {!goal.is_complete && (
            <button
              onClick={() => { setEditTitle(goal.title); setEditEmoji(goal.goal_emoji || "⭐"); setEditTarget(String(goal.target_amount)); setEditError(""); setShowEdit(true); }}
              className="p-2 rounded-xl text-white/30 hover:text-white/60 hover:bg-surface-elevated transition-colors"
              aria-label="Edit goal"
            >
              <Pencil size={16} />
            </button>
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

        {!goal.is_complete && (
          <GoalIntelligenceCard forecast={forecast} health={health} coaching={coaching} formatAmount={fc} />
        )}

        {/* Transaction form */}
        {!goal.is_complete && (
          <div className="card p-4 mb-5">
            {/* Type selector */}
            <div className="flex gap-1.5 mb-4 bg-surface-elevated p-1 rounded-xl">
              {(["deposit", "withdrawal", "goal_purchase"] as TxType[]).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setTxType(type); setError(""); }}
                  className={`flex-1 flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[11px] font-medium transition-all duration-200 ${
                    txType === type
                      ? type === "deposit"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : type === "withdrawal"
                        ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                        : "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  {TX[type].icon}
                  <span>{type === "goal_purchase" ? "Purchase" : type === "deposit" ? "Save" : "Withdraw"}</span>
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-display font-medium text-sm">
                  {currencyCode === "ZAR" ? "R" : ""}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  className="input-field pl-8"
                  placeholder={TX[txType].placeholder}
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  required
                  disabled={!isOnline}
                />
              </div>

              <input
                className="input-field"
                placeholder={TX[txType].hint}
                value={note}
                onChange={e => setNote(e.target.value)}
              />

              {txType === "withdrawal" && (
                <div className="px-3 py-2.5 rounded-xl bg-orange-500/8 border border-orange-500/15">
                  <p className="text-xs text-orange-300">
                    Life happens. Your achievements and streak are completely unaffected.
                  </p>
                </div>
              )}

              {txType === "goal_purchase" && (
                <div className="px-3 py-2.5 rounded-xl bg-brand-500/8 border border-brand-500/15">
                  <p className="text-xs text-brand-300">
                    Use this when you&apos;ve spent the money on what you saved for. This celebrates your goal. 🎯
                  </p>
                </div>
              )}

              {!isOnline && (
                <div className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-xs text-white/60">
                    You&apos;re offline. SaveQuest never queues financial actions for
                    later — reconnect to make sure this is recorded correctly.
                  </p>
                </div>
              )}

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <button
                type="submit"
                className="btn-primary w-full flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-brand-500/50"
                disabled={loading || !isOnline}
              >
                {loading ? "Saving…" : !isOnline ? "Reconnect to continue" : TX[txType].buttonText}
              </button>
            </form>
          </div>
        )}

        {/* Danger zone — delete goal */}
        {!goal.is_complete && (
          <div className="mb-5 flex justify-end">
            <button
              onClick={() => setShowDelete(true)}
              className="flex items-center gap-1.5 text-xs text-white/20 hover:text-red-400 transition-colors py-1"
            >
              <Trash2 size={13} /> Delete goal
            </button>
          </div>
        )}

        {/* Goal activity timeline */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-semibold text-white/60 text-xs uppercase tracking-wider">
              Activity ({transactions.length})
            </h2>
            <Link
              href={`/timeline?goalId=${goal.id}`}
              className="text-brand-400 text-xs flex items-center gap-0.5 hover:text-brand-300 transition-colors"
            >
              Full history <ChevronRight size={12} />
            </Link>
          </div>

          {timelineGroups.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-white/30 text-sm">No activity yet. Log your first saving!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {timelineGroups.map((group) => (
                <div key={group.date}>
                  <p className="text-[11px] font-semibold text-white/25 uppercase tracking-widest mb-1 px-1">
                    {group.date}
                  </p>
                  <div className="card px-4 divide-y divide-surface-border">
                    {group.events.map((event) => (
                      <TimelineEventRow
                        key={event.id}
                        event={event}
                        currencyCode={currencyCode}
                        locale={locale}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Edit goal modal ──────────────────────────────────────────── */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowEdit(false)}>
          <div
            className="w-full max-w-lg bg-surface-card rounded-t-3xl p-6 border-t border-surface-border"
            style={{ animation: "badgePop 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg font-bold text-white">Edit Goal</h2>
              <button onClick={() => setShowEdit(false)} className="text-white/30 hover:text-white/60 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Emoji picker */}
              <div>
                <label className="block text-xs text-white/50 uppercase tracking-wider mb-2">Icon</label>
                <div className="flex flex-wrap gap-2">
                  {GOAL_EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setEditEmoji(emoji)}
                      className={`w-9 h-9 rounded-xl text-lg transition-all ${editEmoji === emoji ? "bg-brand-500/20 border border-brand-500/50 scale-110" : "bg-surface-elevated border border-transparent hover:border-surface-border"}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs text-white/50 uppercase tracking-wider mb-1.5">Goal name</label>
                <input
                  className="input-field"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  placeholder="e.g. My Travel Fund"
                  maxLength={60}
                />
              </div>

              {/* Target amount */}
              <div>
                <label className="block text-xs text-white/50 uppercase tracking-wider mb-1.5">Target amount</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-display font-medium text-sm">
                    {currencyCode === "ZAR" ? "R" : ""}
                  </span>
                  <input
                    type="number"
                    className="input-field pl-8"
                    value={editTarget}
                    onChange={e => setEditTarget(e.target.value)}
                    min={Number(goal.current_amount) || 0.01}
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
                {Number(goal.current_amount) > 0 && (
                  <p className="text-xs text-white/30 mt-1.5">
                    Minimum {fc(Number(goal.current_amount))} — cannot be less than what&apos;s already saved.
                  </p>
                )}
              </div>

              {editError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                  {editError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleEditSave}
                  disabled={editLoading}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {editLoading ? "Saving…" : <><Check size={15} /> Save changes</>}
                </button>
                <button onClick={() => setShowEdit(false)} className="btn-ghost flex-1">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete goal modal ─────────────────────────────────────────── */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowDelete(false)}>
          <div
            className="w-full max-w-lg bg-surface-card rounded-t-3xl p-6 border-t border-surface-border"
            style={{ animation: "badgePop 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-bold text-white">Delete Goal?</h2>
              <button onClick={() => setShowDelete(false)} className="text-white/30 hover:text-white/60 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-4 mb-5 space-y-2">
              <p className="font-medium text-white text-sm">{goal.goal_emoji} {goal.title}</p>
              {transactions.length > 0 && (
                <p className="text-xs text-red-300">
                  {transactions.length} savings log{transactions.length !== 1 ? "s" : ""} · {fc(transactions.filter((t: any) => t.transaction_type === "deposit").reduce((s: number, t: any) => s + Number(t.amount), 0))} total deposited
                </p>
              )}
            </div>

            <p className="text-sm text-white/60 mb-5">
              This permanently deletes the goal and all associated savings history. This action cannot be undone.
            </p>

            {deleteError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
                {deleteError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="flex-1 py-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-sm font-medium disabled:opacity-40 hover:bg-red-500/25 transition-colors"
              >
                {deleteLoading ? "Deleting…" : "Delete permanently"}
              </button>
              <button
                onClick={() => { setShowDelete(false); setDeleteError(""); }}
                className="flex-1 btn-ghost text-sm py-3"
              >
                Keep goal
              </button>
            </div>
          </div>
        </div>
      )}

      <CelebrationOverlay
        show={celebration.show}
        type={celebration.type ?? "xp"}
        title={celebration.title}
        subtitle={celebration.subtitle}
        xpGained={celebration.xpGained}
        icon={celebration.icon}
        stats={celebrationStats}
        onClose={() => setCelebration(prev => ({ ...prev, show: false }))}
      />

      {/* Achievement overlays — queued, auto-dismiss 3s */}
      <CelebrationOverlay
        show={!!currentAchievement && !celebration.show}
        type="achievement"
        title={currentAchievement?.title ?? ""}
        subtitle="Badge unlocked!"
        xpGained={currentAchievement?.xpReward}
        icon={currentAchievement?.icon}
        onClose={dismissAchievement}
        autoDismissMs={3000}
      />

      {/* Next goal prompt — after goal purchase completion */}
      {showNextGoal && !celebration.show && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
          <div
            className="w-full max-w-lg bg-surface-card rounded-t-3xl p-6 border-t border-surface-border"
            style={{ animation: "badgePop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards" }}
          >
            <div className="text-center mb-5">
              <div className="text-5xl mb-3">🚀</div>
              <h2 className="font-display text-xl font-bold text-white">What&apos;s next for you?</h2>
              <p className="text-white/50 text-sm mt-1">
                You proved you can follow through. Keep that momentum going.
              </p>
            </div>
            <div className="space-y-2">
              <Link
                href="/goals/new"
                className="btn-primary w-full flex items-center justify-center gap-2"
                onClick={() => setShowNextGoal(false)}
              >
                <Plus size={16} /> Start a New Goal
              </Link>
              <Link
                href="/goals/history"
                className="btn-ghost w-full flex items-center justify-center gap-2"
                onClick={() => setShowNextGoal(false)}
              >
                <ChevronRight size={16} /> See My Goal History
              </Link>
              <button
                onClick={() => setShowNextGoal(false)}
                className="w-full py-3 text-white/30 text-sm hover:text-white/50 transition-colors"
              >
                I&apos;ll decide later
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
