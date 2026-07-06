"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { QuestTemplate } from "@/lib/quests";
import { getXPForAction } from "@/lib/xp";
import CelebrationOverlay from "@/components/gamification/CelebrationOverlay";
import Link from "next/link";
import { Zap, CheckCircle, Clock, Trophy, Calendar, Sparkles, Timer } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";

interface Props {
  allChallenges: any[];
  userChallenges: any[];
  userId: string;
  profile: { streak_days: number; xp_total: number; daily_quests_completed: number; weekly_quests_completed: number };
  todaysDailyQuest: QuestTemplate;
  thisWeeksQuest: QuestTemplate;
  dailyCompletedToday: boolean;
  weeklyQuestState: any | null;
  currentWeekStart: string;
  weekEndDate: string;
}

type QuestTab = "daily" | "weekly" | "seasonal";

function getDaysRemainingInWeek(weekEndDate: string): number {
  const end = new Date(weekEndDate).getTime() + 86400000;
  const now  = Date.now();
  return Math.max(0, Math.ceil((end - now) / 86400000));
}

function formatTimeRemaining(weekEndDate: string): string {
  const end = new Date(weekEndDate).getTime() + 86400000;
  const ms  = end - Date.now();
  if (ms <= 0) return "Expired";
  const days  = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h remaining`;
  return `${hours}h remaining`;
}

export default function QuestsClient({
  allChallenges, userChallenges, userId, profile,
  todaysDailyQuest, thisWeeksQuest, dailyCompletedToday,
  weeklyQuestState, currentWeekStart, weekEndDate,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab]     = useState<QuestTab>("daily");
  const [loading, setLoading]         = useState<string | null>(null);
  const [celebration, setCelebration] = useState({ show: false, title: "", xp: 0, icon: "" });
  const [achievementQueue, setAchievementQueue] = useState<{ title: string; icon: string; xpReward: number }[]>([]);
  const [currentAchievement, setCurrentAchievement] = useState<{ title: string; icon: string; xpReward: number } | null>(null);

  // Optimistic set of user_challenge IDs completed this session — prevents
  // "Mark Complete" button persisting after completion before router.refresh()
  const [localCompleted, setLocalCompleted] = useState<Set<string>>(new Set());

  // Monthly limit tracking — max 2 seasonal quests per calendar month
  const monthStart       = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthlyAccepted  = userChallenges.filter(uc => new Date(uc.started_at) >= monthStart).length;
  const monthlyRemaining = Math.max(0, 2 - monthlyAccepted);

  function dismissAchievement() {
    setCurrentAchievement(null);
    setTimeout(() => {
      setAchievementQueue(prev => {
        if (prev.length === 0) return prev;
        const [next, ...rest] = prev;
        setCurrentAchievement(next);
        return rest;
      });
    }, 400);
  }

  function queueAchievements(achievements: { title: string; icon: string; xpReward: number }[]) {
    if (achievements.length === 0) return;
    const [first, ...rest] = achievements;
    setCurrentAchievement(first);
    setAchievementQueue(rest);
  }

  // Derived state
  const activeUCs        = userChallenges.filter(uc => uc.status === "active" && !localCompleted.has(uc.id));
  const completedUCs     = [
    ...userChallenges.filter(uc => uc.status === "completed"),
    ...userChallenges.filter(uc => uc.status === "active" && localCompleted.has(uc.id)),
  ];
  const activeIds        = new Set(activeUCs.map(uc => uc.challenge_id));
  const completedIds     = new Set(completedUCs.map(uc => uc.challenge_id));
  const availableChallenges = allChallenges.filter(c => !activeIds.has(c.id) && !completedIds.has(c.id));

  const weeklyStatus   = weeklyQuestState?.status ?? "none";
  const weeklyAccepted = weeklyStatus !== "none";
  const weeklyDone     = weeklyStatus === "completed";

  // ── DAILY ──────────────────────────────────────────────────────────────────
  // All XP logic moved to POST /api/quest/daily/complete — no direct Supabase
  async function completeDailyQuest() {
    if (dailyCompletedToday || loading) return;
    setLoading("daily");

    const res  = await fetch("/api/quest/daily/complete", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ questId: todaysDailyQuest.id }),
    });
    const data = await res.json();

    if (!res.ok) {
      console.error("[completeDailyQuest]", data.error);
      setLoading(null);
      return;
    }

    if (!data.alreadyAwarded && data.newAchievements?.length > 0) {
      queueAchievements(data.newAchievements);
    }

    setLoading(null);
    setCelebration({
      show:  true,
      title: data.alreadyAwarded ? "Already done today! 🎉" : "Daily Quest Done! 🎉",
      xp:    data.xpGained ?? 0,
      icon:  todaysDailyQuest.icon,
    });
    router.refresh();
  }

  // ── WEEKLY: Accept ─────────────────────────────────────────────────────────
  // Accept is non-XP — still a direct Supabase call but it only writes
  // user_weekly_quests (which is correctly RLS-scoped and XP-free).
  async function acceptWeeklyQuest() {
    if (weeklyAccepted || loading) return;
    setLoading("weekly_accept");

    const res = await fetch("/api/quest/weekly/accept", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ questId: thisWeeksQuest.id, weekStart: currentWeekStart }),
    });

    if (!res.ok) {
      console.error("[acceptWeeklyQuest]", await res.text());
    }

    setLoading(null);
    setCelebration({ show: true, title: "Weekly Quest Accepted! ⚔️", xp: 0, icon: thisWeeksQuest.icon });
    router.refresh();
  }

  // ── WEEKLY: Complete ───────────────────────────────────────────────────────
  async function completeWeeklyQuest() {
    if (!weeklyAccepted || weeklyDone || loading) return;
    setLoading("weekly_complete");

    const res  = await fetch("/api/quest/weekly/complete", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        questId:   thisWeeksQuest.id,
        weekStart: currentWeekStart,
        xpReward:  thisWeeksQuest.xpReward,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      console.error("[completeWeeklyQuest]", data.error);
      setLoading(null);
      return;
    }

    if (!data.alreadyAwarded && data.newAchievements?.length > 0) {
      queueAchievements(data.newAchievements);
    }

    setLoading(null);
    setCelebration({
      show:  true,
      title: `Weekly Quest Complete! 🏆`,
      xp:    data.xpGained ?? 0,
      icon:  thisWeeksQuest.icon,
    });
    router.refresh();
  }

  // ── SEASONAL: Accept ───────────────────────────────────────────────────────
  async function acceptChallenge(challengeId: string, title: string) {
    if (loading) return;
    setLoading(challengeId);

    const res  = await fetch("/api/quest/challenge/accept", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ challengeId }),
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.limitReached) {
        setCelebration({ show: true, title: `Monthly limit reached — come back next month!`, xp: 0, icon: "⚠️" });
      } else {
        console.error("[acceptChallenge]", data.error);
      }
      setLoading(null);
      return;
    }

    setLoading(null);
    setCelebration({ show: true, title: `Quest Accepted: ${title}!`, xp: 0, icon: "⚔️" });
    router.refresh();
  }

  // ── SEASONAL: Complete ─────────────────────────────────────────────────────
  async function completeChallenge(ucId: string, title: string) {
    if (loading) return;
    setLoading(ucId);

    const res  = await fetch("/api/quest/challenge/complete", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ userChallengeId: ucId }),
    });
    const data = await res.json();

    if (!res.ok) {
      console.error("[completeChallenge]", data.error);
      setLoading(null);
      return;
    }

    // Optimistic update — move to completed immediately without waiting for
    // router.refresh() to re-render the server component
    setLocalCompleted(prev => new Set(prev).add(ucId));

    if (!data.alreadyAwarded && data.newAchievements?.length > 0) {
      queueAchievements(data.newAchievements);
    }

    setLoading(null);
    setCelebration({
      show:  true,
      title: `Quest Complete: ${title}! 🎉`,
      xp:    data.xpGained ?? 0,
      icon:  "⚔️",
    });
    router.refresh();
  }

  const TABS: { id: QuestTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "daily",    label: "Daily",    icon: <Calendar size={13} />, badge: dailyCompletedToday ? 0 : 1 },
    { id: "weekly",   label: "Weekly",   icon: <Sparkles size={13} />, badge: weeklyAccepted && !weeklyDone ? 1 : 0 },
    { id: "seasonal", label: "Seasonal", icon: <Trophy size={13} />,   badge: activeUCs.length },
  ];

  return (
    <>
      <div className="max-w-lg mx-auto px-4 pt-6">
        <div className="mb-5">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-2xl font-bold text-white">Quests</h1>
            <Link href="/chains" className="text-brand-400 text-xs hover:text-brand-300 transition-colors flex items-center gap-1">
              🔗 Quest Chains
            </Link>
          </div>
          <p className="text-white/40 text-sm mt-0.5">
            {profile.daily_quests_completed} daily · {profile.weekly_quests_completed} weekly completed
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1.5 mb-5 bg-surface-elevated p-1 rounded-2xl">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 relative ${
                activeTab === t.id ? "bg-brand-500 text-black" : "text-white/40 hover:text-white/70"
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.badge && t.badge > 0 ? (
                <span className={`absolute top-1 right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${
                  activeTab === t.id ? "bg-black/20 text-black" : "bg-brand-500 text-black"
                }`}>{t.badge}</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* ── DAILY TAB ──────────────────────────────────────── */}
        {activeTab === "daily" && (
          <div className="space-y-4">
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Calendar size={14} className="text-brand-400" />
                <span className="text-xs text-brand-400 font-bold uppercase tracking-wider">Today's Quest</span>
                <span className="ml-auto text-xs text-white/30">Resets at midnight</span>
              </div>
              <div className="flex items-start gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-brand-500/15 border border-brand-500/20 flex items-center justify-center text-2xl flex-shrink-0">
                  {todaysDailyQuest.icon}
                </div>
                <div className="flex-1">
                  <h3 className="font-display font-bold text-white">{todaysDailyQuest.title}</h3>
                  <p className="text-sm text-white/50 mt-0.5">{todaysDailyQuest.description}</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <div className="flex items-center gap-1 bg-brand-500/10 border border-brand-500/20 rounded-full px-2.5 py-1">
                      <Zap size={11} className="text-brand-400" />
                      <span className="text-brand-400 text-xs font-bold">
                        +{getXPForAction("DAILY_QUEST_COMPLETE", profile.streak_days)} XP
                      </span>
                    </div>
                    {profile.streak_days >= 7 && (
                      <span className="text-xs text-white/30">⚡ streak bonus applied</span>
                    )}
                  </div>
                </div>
              </div>
              {dailyCompletedToday ? (
                <div className="flex items-center gap-2 py-3 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle size={16} className="text-emerald-400" />
                  <span className="text-emerald-400 text-sm font-medium">Completed! Come back tomorrow 🎉</span>
                </div>
              ) : (
                <button onClick={completeDailyQuest} disabled={loading === "daily"} className="btn-primary w-full">
                  {loading === "daily" ? "Claiming…" : "Complete Quest ✓"}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-4 text-center">
                <p className="font-display font-bold text-white text-2xl">{profile.daily_quests_completed}</p>
                <p className="text-xs text-white/40 mt-0.5">Daily quests done</p>
              </div>
              <div className="card p-4 text-center">
                <p className="font-display font-bold text-white text-2xl">{profile.streak_days}</p>
                <p className="text-xs text-white/40 mt-0.5">Day streak</p>
              </div>
            </div>
          </div>
        )}

        {/* ── WEEKLY TAB ─────────────────────────────────────── */}
        {activeTab === "weekly" && (
          <div className="space-y-4">
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={14} className="text-brand-400" />
                <span className="text-xs text-brand-400 font-bold uppercase tracking-wider">This Week's Quest</span>
                <span className="ml-auto text-xs text-white/30">Resets Monday</span>
              </div>
              <div className="flex items-start gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-brand-500/15 border border-brand-500/20 flex items-center justify-center text-2xl flex-shrink-0">
                  {thisWeeksQuest.icon}
                </div>
                <div className="flex-1">
                  <h3 className="font-display font-bold text-white">{thisWeeksQuest.title}</h3>
                  <p className="text-sm text-white/50 mt-0.5">{thisWeeksQuest.description}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <div className="flex items-center gap-1 bg-brand-500/10 border border-brand-500/20 rounded-full px-2.5 py-1">
                      <Zap size={11} className="text-brand-400" />
                      <span className="text-brand-400 text-xs font-bold">+{thisWeeksQuest.xpReward} XP</span>
                    </div>
                    {weeklyAccepted && (
                      <div className="flex items-center gap-1 bg-surface-elevated border border-surface-border rounded-full px-2.5 py-1">
                        <Timer size={11} className="text-white/40" />
                        <span className="text-white/40 text-xs">{formatTimeRemaining(weekEndDate)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {weeklyDone ? (
                <div className="flex items-center gap-2 py-3 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle size={16} className="text-emerald-400" />
                  <div>
                    <p className="text-emerald-400 text-sm font-medium">Quest Complete! 🏆</p>
                    <p className="text-emerald-400/60 text-xs">+{weeklyQuestState?.xp_earned ?? thisWeeksQuest.xpReward} XP earned</p>
                  </div>
                </div>
              ) : weeklyAccepted ? (
                <div className="space-y-2">
                  <div className="px-4 py-3 rounded-xl bg-brand-500/5 border border-brand-500/15">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-brand-400 font-medium">In Progress</span>
                      <span className="text-xs text-white/30">{getDaysRemainingInWeek(weekEndDate)}d left</span>
                    </div>
                    <p className="text-xs text-white/40">{thisWeeksQuest.description}</p>
                  </div>
                  <button
                    onClick={completeWeeklyQuest}
                    disabled={loading === "weekly_complete"}
                    className="btn-primary w-full"
                  >
                    {loading === "weekly_complete" ? "Claiming…" : "Complete Quest ✓"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={acceptWeeklyQuest}
                  disabled={loading === "weekly_accept"}
                  className="btn-primary w-full"
                >
                  {loading === "weekly_accept" ? "Accepting…" : "⚔️ Accept This Quest"}
                </button>
              )}
            </div>
            <div className="card p-4 text-center">
              <p className="font-display font-bold text-white text-2xl">{profile.weekly_quests_completed}</p>
              <p className="text-xs text-white/40 mt-0.5">Weekly quests completed</p>
            </div>
          </div>
        )}

        {/* ── SEASONAL TAB ───────────────────────────────────── */}
        {activeTab === "seasonal" && (
          <div className="space-y-4">

            {/* Monthly limit indicator */}
            <div className={`card p-3 flex items-center justify-between ${monthlyRemaining === 0 ? "border-amber-500/20" : "border-surface-border"}`}>
              <div className="flex items-center gap-2">
                <Calendar size={14} className={monthlyRemaining === 0 ? "text-amber-400" : "text-white/40"} />
                <span className="text-xs text-white/50">Monthly quest slots</span>
              </div>
              <div className="flex items-center gap-1">
                {[0, 1].map(i => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full border ${
                      i < (2 - monthlyRemaining)
                        ? "bg-brand-500 border-brand-400"
                        : "bg-surface-elevated border-surface-border"
                    }`}
                  />
                ))}
                <span className={`text-xs ml-1 ${monthlyRemaining === 0 ? "text-amber-400" : "text-white/40"}`}>
                  {monthlyRemaining === 0 ? "Full this month" : `${monthlyRemaining} left`}
                </span>
              </div>
            </div>

            {/* In Progress */}
            {activeUCs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Clock size={13} className="text-brand-400" />
                  <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider">In Progress</h2>
                </div>
                <div className="space-y-2">
                  {activeUCs.map(uc => {
                    const ch         = uc.challenges;
                    const isOptimistic = localCompleted.has(uc.id);
                    if (!ch) return null;
                    return (
                      <div key={uc.id} className={`card p-4 ${isOptimistic ? "border-emerald-500/20 opacity-75" : "border-brand-500/20"}`}>
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <h3 className="font-display font-semibold text-white text-sm">{ch.title}</h3>
                            <p className="text-xs text-white/40 mt-0.5">{ch.description}</p>
                            {ch.end_date && (
                              <p className="text-xs text-white/30 mt-1">
                                🍂 Ends {new Date(ch.end_date).toLocaleDateString("en", { day: "numeric", month: "short" })}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 bg-brand-500/10 border border-brand-500/20 rounded-full px-2.5 py-1 ml-3">
                            <Zap size={11} className="text-brand-400" />
                            <span className="text-brand-400 text-xs font-bold">{ch.xp_reward}</span>
                          </div>
                        </div>
                        {isOptimistic ? (
                          <div className="w-full py-2.5 text-sm text-center text-emerald-400 font-semibold flex items-center justify-center gap-2">
                            <CheckCircle size={15} />
                            Completed
                          </div>
                        ) : (
                          <button
                            onClick={() => completeChallenge(uc.id, ch.title)}
                            disabled={loading === uc.id}
                            className="btn-primary w-full text-sm py-2.5"
                          >
                            {loading === uc.id ? "Claiming…" : "Mark Complete ✅"}
                          </button>
                        )}
                      </div>
                    );
                  })}\n                </div>
              </div>
            )}

            {/* Available */}
            {availableChallenges.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Trophy size={13} className="text-white/40" />
                  <h2 className="text-xs font-bold text-white/40 uppercase tracking-wider">Available</h2>
                </div>
                <div className="space-y-2">
                  {availableChallenges.map(ch => (
                    <div key={ch.id} className={`card p-4 ${monthlyRemaining === 0 ? "opacity-50" : ""}`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="font-display font-semibold text-white text-sm">{ch.title}</h3>
                            {ch.type === "seasonal" && (
                              <span className="text-[10px] bg-purple-500/15 text-purple-400 border border-purple-500/20 rounded-full px-2 py-0.5">Seasonal</span>
                            )}
                          </div>
                          <p className="text-xs text-white/40">{ch.description}</p>
                          {ch.end_date && (
                            <p className="text-xs text-white/30 mt-1">
                              🍂 Ends {new Date(ch.end_date).toLocaleDateString("en", { day: "numeric", month: "short" })}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 bg-surface-elevated border border-surface-border rounded-full px-2.5 py-1 ml-3">
                          <Zap size={11} className="text-white/40" />
                          <span className="text-white/50 text-xs font-bold">{ch.xp_reward}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => acceptChallenge(ch.id, ch.title)}
                        disabled={loading === ch.id || monthlyRemaining === 0}
                        className="btn-ghost w-full text-sm py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {loading === ch.id
                          ? "Accepting…"
                          : monthlyRemaining === 0
                          ? "Monthly limit reached"
                          : "⚔️ Accept Quest"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Completed */}
            {completedUCs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={13} className="text-emerald-400" />
                  <h2 className="text-xs font-bold text-emerald-400/60 uppercase tracking-wider">
                    Completed ({completedUCs.length})
                  </h2>
                </div>
                <div className="space-y-2 opacity-60">
                  {completedUCs.map(uc => {
                    const ch = uc.challenges;
                    if (!ch) return null;
                    return (
                      <div key={uc.id} className="card p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
                          <p className="text-sm text-white/60">{ch.title}</p>
                        </div>
                        <span className="text-xs text-emerald-400">+{ch.xp_reward} XP</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {availableChallenges.length === 0 && activeUCs.length === 0 && completedUCs.length === 0 && (
              <EmptyState
                emoji="🌸"
                title="No seasonal quests right now"
                description="Check back soon — new seasonal challenges are added throughout the year."
              />
            )}
          </div>
        )}
      </div>

      <CelebrationOverlay
        show={celebration.show}
        type="xp"
        title={celebration.title}
        xpGained={celebration.xp}
        icon={celebration.icon || "⚔️"}
        onClose={() => setCelebration(p => ({ ...p, show: false }))}
      />

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
    </>
  );
}