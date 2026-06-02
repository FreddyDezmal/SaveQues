"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getXPForAction } from "@/lib/xp";
import type { QuestTemplate } from "@/lib/quests";
import CelebrationOverlay from "@/components/gamification/CelebrationOverlay";
import { Zap, CheckCircle, Clock, Trophy, Calendar, Sparkles } from "lucide-react";

interface WeeklyQuestState {
  id: string;
  status: "active" | "completed" | "expired";
  accepted_at: string;
  completed_at: string | null;
  quest_id: string;
  xp_earned: number | null;
}

interface Props {
  allChallenges: any[];
  userChallenges: any[];
  userId: string;
  profile: { streak_days: number; xp_total: number; daily_quests_completed: number; weekly_quests_completed: number };
  todaysDailyQuest: QuestTemplate;
  thisWeeksQuest: QuestTemplate;
  dailyCompletedToday: boolean;
  weeklyQuestState: WeeklyQuestState | null;
  currentWeekStart: string;
}

type QuestTab = "daily" | "weekly" | "challenges";

export default function QuestsClient({
  allChallenges, userChallenges, userId, profile,
  todaysDailyQuest, thisWeeksQuest, dailyCompletedToday,
  weeklyQuestState: initialWeeklyState, currentWeekStart,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<QuestTab>("daily");
  const [loading, setLoading] = useState<string | null>(null);
  const [celebration, setCelebration] = useState({ show: false, title: "", xp: 0, icon: "" });
  // Local weekly state so UI updates instantly without waiting for router.refresh()
  const [weeklyState, setWeeklyState] = useState<WeeklyQuestState | null>(initialWeeklyState);

  const activeUCs    = userChallenges.filter(uc => uc.status === "active");
  const completedUCs = userChallenges.filter(uc => uc.status === "completed");
  const activeIds    = new Set(activeUCs.map(uc => uc.challenge_id));
  const completedIds = new Set(completedUCs.map(uc => uc.challenge_id));
  const availableChallenges = allChallenges.filter(c => !activeIds.has(c.id) && !completedIds.has(c.id));

  // ── Daily quest ────────────────────────────────────────────
  async function completeDailyQuest() {
    if (dailyCompletedToday) return;
    setLoading("daily");
    const supabase = createClient();
    const today = new Date().toISOString().split("T")[0];
    const xp = getXPForAction("DAILY_QUEST_COMPLETE", profile.streak_days);
    await supabase.from("daily_quest_logs").upsert(
      { user_id: userId, quest_id: todaysDailyQuest.id, quest_date: today, xp_earned: xp },
      { onConflict: "user_id,quest_date" }
    );
    const { data: p } = await supabase.from("profiles").select("xp_total, daily_quests_completed").eq("id", userId).single();
    if (p) {
      await supabase.from("profiles").update({
        xp_total: p.xp_total + xp,
        daily_quests_completed: (p.daily_quests_completed ?? 0) + 1,
      }).eq("id", userId);
    }
    await supabase.rpc("log_activity", { p_user_id: userId, p_xp: xp });
    setLoading(null);
    setCelebration({ show: true, title: "Daily Quest Done! 🎉", xp, icon: todaysDailyQuest.icon });
    router.refresh();
  }

  // ── Weekly quest ───────────────────────────────────────────
  async function acceptWeeklyQuest() {
    setLoading("weekly_accept");
    const supabase = createClient();
    const { data, error } = await supabase
      .from("user_weekly_quests")
      .insert({
        user_id:     userId,
        quest_id:    thisWeeksQuest.id,
        week_start:  currentWeekStart,
        status:      "active",
        accepted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (!error && data) {
      // Update local state immediately — no flicker
      setWeeklyState(data as WeeklyQuestState);
      setCelebration({
        show:  true,
        title: `You're on it — ${thisWeeksQuest.title}!`,
        xp:    0,
        icon:  thisWeeksQuest.icon,
      });
    }
    setLoading(null);
    router.refresh();
  }

  async function completeWeeklyQuest() {
    if (!weeklyState) return;
    setLoading("weekly_complete");
    const supabase  = createClient();
    const xp        = thisWeeksQuest.xpReward;
    const now       = new Date().toISOString();

    await supabase
      .from("user_weekly_quests")
      .update({ status: "completed", completed_at: now, xp_earned: xp })
      .eq("id", weeklyState.id);

    const { data: p } = await supabase
      .from("profiles")
      .select("xp_total, weekly_quests_completed")
      .eq("id", userId)
      .single();

    if (p) {
      await supabase.from("profiles").update({
        xp_total:                p.xp_total + xp,
        weekly_quests_completed: (p.weekly_quests_completed ?? 0) + 1,
      }).eq("id", userId);
    }
    await supabase.rpc("log_activity", { p_user_id: userId, p_xp: xp });

    // Update local state immediately
    setWeeklyState(prev => prev ? { ...prev, status: "completed", completed_at: now, xp_earned: xp } : prev);
    setLoading(null);
    setCelebration({ show: true, title: `Quest Complete! 🎉`, xp, icon: thisWeeksQuest.icon });
    router.refresh();
  }

  // ── Challenge quests ───────────────────────────────────────
  async function acceptChallenge(challengeId: string, xpReward: number, title: string) {
    setLoading(challengeId);
    const supabase = createClient();
    await supabase.from("user_challenges").insert({
      user_id: userId, challenge_id: challengeId, status: "active",
      started_at: new Date().toISOString(),
    });
    setLoading(null);
    setCelebration({ show: true, title: "Quest Accepted!", xp: 0, icon: "⚔️" });
    router.refresh();
  }

  async function completeChallenge(ucId: string, xpReward: number, title: string) {
    setLoading(ucId);
    const supabase = createClient();
    await supabase.from("user_challenges").update({
      status: "completed", completed_at: new Date().toISOString(),
    }).eq("id", ucId);
    const { data: p } = await supabase.from("profiles").select("xp_total, weekly_quests_completed").eq("id", userId).single();
    if (p) {
      await supabase.from("profiles").update({
        xp_total: p.xp_total + xpReward,
        weekly_quests_completed: (p.weekly_quests_completed ?? 0) + 1,
      }).eq("id", userId);
    }
    await supabase.rpc("log_activity", { p_user_id: userId, p_xp: xpReward });
    setLoading(null);
    setCelebration({ show: true, title: `Quest Complete: ${title}! 🎉`, xp: xpReward, icon: "⚔️" });
    router.refresh();
  }

  const weeklyBadge = weeklyState?.status === "active" ? 1 : 0;

  const TABS: { id: QuestTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "daily",      label: "Daily",      icon: <Calendar size={13} />, badge: dailyCompletedToday ? 0 : 1 },
    { id: "weekly",     label: "Weekly",     icon: <Sparkles size={13} />, badge: weeklyBadge },
    { id: "challenges", label: "Challenges", icon: <Trophy size={13} />,   badge: activeUCs.length },
  ];

  return (
    <>
      <div className="max-w-lg mx-auto px-4 pt-6">
        <div className="mb-5">
          <h1 className="font-display text-2xl font-bold text-white">Quests</h1>
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

        {/* ── DAILY TAB ──────────────────────────────────── */}
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
                  <span className="text-emerald-400 text-sm font-medium">Done for today! Come back tomorrow 🎉</span>
                </div>
              ) : (
                <button
                  onClick={completeDailyQuest}
                  disabled={loading === "daily"}
                  className="btn-primary w-full"
                >
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

        {/* ── WEEKLY TAB ─────────────────────────────────── */}
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
                  <div className="flex items-center gap-1.5 mt-2">
                    <div className="flex items-center gap-1 bg-brand-500/10 border border-brand-500/20 rounded-full px-2.5 py-1">
                      <Zap size={11} className="text-brand-400" />
                      <span className="text-brand-400 text-xs font-bold">+{thisWeeksQuest.xpReward} XP</span>
                    </div>
                    <span className="text-xs text-white/30">⏱ 7 days</span>
                  </div>
                </div>
              </div>

              {/* State machine UI */}
              {!weeklyState && (
                <button
                  onClick={acceptWeeklyQuest}
                  disabled={loading === "weekly_accept"}
                  className="btn-primary w-full"
                >
                  {loading === "weekly_accept" ? "Accepting…" : "⚔️ Accept This Quest"}
                </button>
              )}

              {weeklyState?.status === "active" && (
                <div className="space-y-3">
                  {/* Active state banner */}
                  <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-brand-500/8 border border-brand-500/20">
                    <Clock size={14} className="text-brand-400 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-white">Quest in progress</p>
                      <p className="text-xs text-white/40 mt-0.5">
                        You're taking on {thisWeeksQuest.title}. Mark complete when you're done.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={completeWeeklyQuest}
                    disabled={loading === "weekly_complete"}
                    className="btn-primary w-full"
                  >
                    {loading === "weekly_complete" ? "Claiming…" : "Mark Complete ✅"}
                  </button>
                </div>
              )}

              {weeklyState?.status === "completed" && (
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-400">Quest complete this week!</p>
                    <p className="text-xs text-white/40 mt-0.5">
                      +{weeklyState.xp_earned} XP earned · New quest unlocks Monday
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="card p-4 text-center">
                <p className="font-display font-bold text-white text-2xl">{profile.weekly_quests_completed}</p>
                <p className="text-xs text-white/40 mt-0.5">Weekly quests done</p>
              </div>
              <div className="card p-4 text-center">
                <p className="font-display font-bold text-white text-2xl">{profile.streak_days}</p>
                <p className="text-xs text-white/40 mt-0.5">Day streak</p>
              </div>
            </div>
          </div>
        )}

        {/* ── CHALLENGES TAB ─────────────────────────────── */}
        {activeTab === "challenges" && (
          <div className="space-y-4">
            {activeUCs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Clock size={13} className="text-brand-400" />
                  <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider">Active</h2>
                </div>
                <div className="space-y-2">
                  {activeUCs.map(uc => {
                    const ch = uc.challenges;
                    if (!ch) return null;
                    return (
                      <div key={uc.id} className="card p-4 border-brand-500/20">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <h3 className="font-display font-semibold text-white text-sm">{ch.title}</h3>
                            <p className="text-xs text-white/40 mt-0.5">{ch.description}</p>
                          </div>
                          <div className="flex items-center gap-1 bg-brand-500/10 border border-brand-500/20 rounded-full px-2.5 py-1 ml-3">
                            <Zap size={11} className="text-brand-400" />
                            <span className="text-brand-400 text-xs font-bold">{ch.xp_reward}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => completeChallenge(uc.id, ch.xp_reward, ch.title)}
                          disabled={loading === uc.id}
                          className="btn-primary w-full text-sm py-2.5"
                        >
                          {loading === uc.id ? "Claiming…" : "Mark Complete ✅"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {availableChallenges.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Trophy size={13} className="text-white/40" />
                  <h2 className="text-xs font-bold text-white/40 uppercase tracking-wider">Available</h2>
                </div>
                <div className="space-y-2">
                  {availableChallenges.map(ch => (
                    <div key={ch.id} className="card p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="font-display font-semibold text-white text-sm">{ch.title}</h3>
                            {ch.type === "seasonal" && (
                              <span className="text-[10px] bg-purple-500/15 text-purple-400 border border-purple-500/20 rounded-full px-2 py-0.5">Seasonal</span>
                            )}
                          </div>
                          <p className="text-xs text-white/40">{ch.description}</p>
                          <p className="text-xs text-white/30 mt-1">⏱ {ch.duration_days}d</p>
                        </div>
                        <div className="flex items-center gap-1 bg-surface-elevated border border-surface-border rounded-full px-2.5 py-1 ml-3">
                          <Zap size={11} className="text-white/40" />
                          <span className="text-white/50 text-xs font-bold">{ch.xp_reward}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => acceptChallenge(ch.id, ch.xp_reward, ch.title)}
                        disabled={loading === ch.id}
                        className="btn-ghost w-full text-sm py-2.5"
                      >
                        {loading === ch.id ? "Accepting…" : "⚔️ Accept Quest"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

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

            {availableChallenges.length === 0 && activeUCs.length === 0 && (
              <div className="card p-10 text-center">
                <div className="text-4xl mb-3">⚔️</div>
                <p className="text-white/40 text-sm">All quests complete! New ones coming soon.</p>
              </div>
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
    </>
  );
}