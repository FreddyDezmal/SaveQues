"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getXPForAction } from "@/lib/xp";
import type { QuestTemplate } from "@/lib/quests";
import CelebrationOverlay from "@/components/gamification/CelebrationOverlay";
import { Zap, CheckCircle, Clock, Trophy, Calendar, Sparkles } from "lucide-react";
import { getQuestAvailability, isQuestAcceptable } from "@/lib/questAvailability";

interface Props {
  allChallenges: any[];
  userChallenges: any[];
  userId: string;
  profile: { streak_days: number; xp_total: number; daily_quests_completed: number; weekly_quests_completed: number };
  todaysDailyQuest: QuestTemplate;
  thisWeeksQuest: QuestTemplate;
  dailyCompletedToday: boolean;
  weeklyQuestState: {
    id: string;
    status: "active" | "completed" | "expired";
    accepted_at: string;
    completed_at: string | null;
    quest_id: string;
    xp_earned: number | null;
  } | null;
  currentWeekStart: string;
}

type QuestTab = "daily" | "weekly" | "challenges";

export default function QuestsClient({
  allChallenges, userChallenges, userId, profile,
  todaysDailyQuest, thisWeeksQuest, dailyCompletedToday, weeklyQuestState, currentWeekStart
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<QuestTab>("daily");
  const [loading, setLoading] = useState<string | null>(null);
  const [celebration, setCelebration] = useState({ show: false, title: "", xp: 0, icon: "" });

  const activeUCs = userChallenges.filter(uc => uc.status === "active");
  const completedUCs = userChallenges.filter(uc => uc.status === "completed");
  const activeIds = new Set(activeUCs.map(uc => uc.challenge_id));
  const completedIds = new Set(completedUCs.map(uc => uc.challenge_id));

  const availableChallenges = allChallenges
    .filter(c => !activeIds.has(c.id) && !completedIds.has(c.id))
    .map(c => ({
      ...c,
      window: getQuestAvailability({
        quest_type: c.quest_type ?? "evergreen",
        start_date: c.start_date ?? null,
        end_date: c.end_date ?? null,
        year_agnostic: c.year_agnostic ?? false,
        preview_days: c.preview_days ?? 3,
      }),
    }))
    .filter(c => c.window.availability !== "expired" ||
                 c.window.availability === "upcoming")
    .sort((a, b) => {
      // Active first, then upcoming, then evergreen
      const order: Record<string, number> = {
        available: 0,
        always_on: 1,
        upcoming: 2,
        expired: 99,
        completed: 99,
      };
      return (order[a.window.availability as string] ?? 99) - (order[b.window.availability as string] ?? 99);
    });

  async function completeDailyQuest() {
    if (dailyCompletedToday) return;
    setLoading("daily");
    const supabase = createClient();
    const today = new Date().toISOString().split("T")[0];
    const xp = getXPForAction("DAILY_QUEST_COMPLETE", profile.streak_days);

    await supabase.from("daily_quest_logs").upsert({
      user_id: userId, quest_id: todaysDailyQuest.id, quest_date: today, xp_earned: xp,
    }, { onConflict: "user_id,quest_date" });

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

  async function acceptWeeklyQuest() {
    setLoading("weekly_current");
    const supabase = createClient();
    const { error } = await supabase.from("user_weekly_quests").insert({
      user_id: userId,
      quest_id: thisWeeksQuest.id,
      week_start: currentWeekStart,
      status: "active",
      accepted_at: new Date().toISOString(),
    });
    setLoading(null);
    if (!error) {
      setCelebration({
        show: true,
        title: "Quest Accepted!",
        xp: 0,
        icon: thisWeeksQuest.icon,
      });
    }
    router.refresh();
  }

  async function completeWeeklyQuest() {
    if (!weeklyQuestState) return;
    setLoading("weekly_complete");
    const supabase = createClient();
    const xp = thisWeeksQuest.xpReward;
    await supabase.from("user_weekly_quests").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      xp_earned: xp,
    }).eq("id", weeklyQuestState.id);

    const { data: p } = await supabase.from("profiles").select("xp_total, weekly_quests_completed").eq("id", userId).single();
    if (p) {
      await supabase.from("profiles").update({
        xp_total: p.xp_total + xp,
        weekly_quests_completed: (p.weekly_quests_completed ?? 0) + 1,
      }).eq("id", userId);
    }
    await supabase.rpc("log_activity", { p_user_id: userId, p_xp: xp });
    setLoading(null);
    setCelebration({ show: true, title: `Quest Complete! 🎉`, xp, icon: thisWeeksQuest.icon });
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

  const TABS: { id: QuestTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "daily",      label: "Daily",      icon: <Calendar size={13} />, badge: dailyCompletedToday ? 0 : 1 },
    { id: "weekly",     label: "Weekly",     icon: <Sparkles size={13} /> },
    { id: "challenges", label: "Challenges", icon: <Trophy size={13} />, badge: activeUCs.length },
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
                    <span className="text-xs text-white/30">
                      {profile.streak_days >= 7 && "⚡ streak bonus applied"}
                    </span>
                  </div>
                </div>
              </div>

              {dailyCompletedToday ? (
                <div className="flex items-center gap-2 py-3 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle size={16} className="text-emerald-400" />
                  <span className="text-emerald-400 text-sm font-medium">Completed! Come back tomorrow 🎉</span>
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

            {/* Stats */}
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
                    <span className="text-xs text-white/30">
                      ⏱ {thisWeeksQuest.type === "weekly" ? "7 days" : "Duration varies"}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => acceptWeeklyQuest()}
                disabled={loading === "weekly_current"}
                className="btn-primary w-full"
              >
                {loading === "weekly_current" ? "Accepting…" : "⚔️ Accept This Quest"}
              </button>
            </div>

            <div className="card p-4 text-center">
              <p className="font-display font-bold text-white text-2xl">{profile.weekly_quests_completed}</p>
              <p className="text-xs text-white/40 mt-0.5">Weekly quests completed total</p>
            </div>
          </div>
        )}

        {/* ── CHALLENGES TAB ─────────────────────────────── */}
        {activeTab === "weekly" && (
  <div className="space-y-4">
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={14} className="text-brand-400" />
        <span className="text-xs text-brand-400 font-bold uppercase tracking-wider">
          This Week's Quest
        </span>
        <span className="ml-auto text-xs text-white/30">Resets Monday</span>
      </div>

      <div className="flex items-start gap-3 mb-4">
        <div className="w-12 h-12 rounded-2xl bg-brand-500/15 border border-brand-500/20 flex items-center justify-center text-2xl flex-shrink-0">
          {thisWeeksQuest.icon}
        </div>
        <div className="flex-1">
          <h3 className="font-display font-bold text-white">{thisWeeksQuest.title}</h3>
          <p className="text-sm text-white/50 mt-0.5">{thisWeeksQuest.description}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <div className="flex items-center gap-1 bg-brand-500/10 border border-brand-500/20 rounded-full px-2.5 py-1">
              <Zap size={11} className="text-brand-400" />
              <span className="text-brand-400 text-xs font-bold">
                +{thisWeeksQuest.xpReward} XP
              </span>
            </div>
            <span className="text-xs text-white/30">⏱ 7 days</span>
          </div>
        </div>
      </div>

      {/* State-aware action area */}
      {!weeklyQuestState && (
        <button
          onClick={acceptWeeklyQuest}
          disabled={loading === "weekly_current"}
          className="btn-primary w-full"
        >
          {loading === "weekly_current" ? "Accepting…" : "⚔️ Accept This Quest"}
        </button>
      )}

      {weeklyQuestState?.status === "active" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-brand-500/8 border border-brand-500/20">
            <Clock size={14} className="text-brand-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-white">Quest in progress</p>
              <p className="text-xs text-white/40 mt-0.5">
                Accepted {new Date(weeklyQuestState.accepted_at).toLocaleDateString()} — mark complete when done
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

      {weeklyQuestState?.status === "completed" && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-emerald-400">Quest complete this week!</p>
            <p className="text-xs text-white/40 mt-0.5">
              +{weeklyQuestState.xp_earned} XP earned · New quest unlocks Monday
            </p>
          </div>
        </div>
      )}
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div className="card p-4 text-center">
        <p className="font-display font-bold text-white text-2xl">
          {profile.weekly_quests_completed}
        </p>
        <p className="text-xs text-white/40 mt-0.5">Weekly quests done</p>
      </div>
      <div className="card p-4 text-center">
        <p className="font-display font-bold text-white text-2xl">
          {profile.streak_days}
        </p>
        <p className="text-xs text-white/40 mt-0.5">Day streak</p>
      </div>
    </div>
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
