"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { getStreakMessage } from "@/lib/streaks";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { getStreakMultiplierLabel, TIER_COLORS, TIER_LABELS } from "@/lib/xp";
import { QUEST_CHAINS } from "@/lib/quests";
import GoalCard from "@/components/goals/GoalCard";
import XPProgressBar from "@/components/gamification/XPProgressBar";
import StreakBadge from "@/components/gamification/StreakBadge";
import MomentumHeatmap from "@/components/gamification/MomentumHeatmap";
import DailyQuestCard from "@/components/gamification/DailyQuestCard";
import { ChevronRight, Plus, PauseCircle, PlayCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  profile: any;
  levelInfo: any;
  totalSaved: number;
  activeGoals: any[];
  completedGoals: any[];
  activeChallenges: any[];
  recentAchievements: string[];
  activityLog: any[];
  dailyQuestCompletedToday: boolean;
  todayQuestId?: string;
  almostMessages: { message: string; icon: string }[];
  activeChain: { chain_id: string; current_step: number } | null;
  streakBroken: boolean;
  userStage: "new" | "building" | "established";
  streakPaused: boolean;
  streakPausedUntil: string | null;
}

export default function DashboardClient({
  profile, levelInfo, totalSaved, activeGoals, completedGoals,
  activeChallenges, recentAchievements, activityLog,
  dailyQuestCompletedToday, todayQuestId,
  almostMessages, activeChain, streakBroken,
  userStage, streakPaused, streakPausedUntil,
}: Props) {
  const router = useRouter();
  const [pauseLoading, setPauseLoading] = useState(false);
  const [pauseConfirm, setPauseConfirm] = useState(false);

  const greeting = getGreeting();
  const streakMsg = getStreakMessage(profile.streak_days, streakPaused);
  const multiplierLabel = getStreakMultiplierLabel(profile.streak_days);
  const tierColor = TIER_COLORS[levelInfo.tier as keyof typeof TIER_COLORS];
  const tierLabel = TIER_LABELS[levelInfo.tier as keyof typeof TIER_LABELS];
  const chainDef = activeChain ? QUEST_CHAINS.find(c => c.id === activeChain.chain_id) : null;

  const showHeatmap      = userStage !== "new";
  const showAlmost       = userStage !== "new" && almostMessages.length > 0;
  const showChainNudge   = userStage !== "new";
  const showActiveQuests = activeChallenges.length > 0;
  const showRecentBadges = userStage !== "new" && recentAchievements.length > 0;
  const showXPDetails    = userStage !== "new";

  async function handlePauseStreak() {
    setPauseLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const pauseUntil = new Date();
    pauseUntil.setDate(pauseUntil.getDate() + 7);
    await supabase
      .from("profiles")
      .update({ streak_paused_until: pauseUntil.toISOString().split("T")[0] })
      .eq("id", user.id);
    setPauseLoading(false);
    setPauseConfirm(false);
    router.refresh();
  }

  async function handleResumeStreak() {
    setPauseLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("profiles")
      .update({ streak_paused_until: null })
      .eq("id", user.id);
    setPauseLoading(false);
    router.refresh();
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4 bg-mesh min-h-screen">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-white/40 text-sm">{greeting}</p>
          <h1 className="font-display text-2xl font-bold text-white mt-0.5">
            {profile.display_name} <span>{profile.avatar_emoji}</span>
          </h1>
          <p className="text-xs mt-0.5" style={{ color: tierColor }}>
            {tierLabel} · Level {levelInfo.level}
          </p>
        </div>
        <StreakBadge streak={profile.streak_days} paused={streakPaused} />
      </div>

      {/* XP bar */}
      <div className="card p-4 mb-3">
        <XPProgressBar levelInfo={levelInfo} xpTotal={profile.xp_total} />
        {showXPDetails && multiplierLabel && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-brand-400 bg-brand-500/10 border border-brand-500/20 rounded-full px-2.5 py-0.5">
              ⚡ {multiplierLabel}
            </span>
          </div>
        )}
      </div>

      {/* Streak paused banner */}
      {streakPaused && (
        <div className="mb-3 px-4 py-3 rounded-xl bg-surface-elevated border border-brand-500/20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <PauseCircle size={18} className="text-brand-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-white">Streak paused</p>
              <p className="text-xs text-white/40">Resumes {streakPausedUntil} — no pressure</p>
            </div>
          </div>
          <button
            onClick={handleResumeStreak}
            disabled={pauseLoading}
            className="flex items-center gap-1 text-brand-400 text-xs hover:text-brand-300 transition-colors flex-shrink-0"
          >
            <PlayCircle size={14} /> Resume
          </button>
        </div>
      )}

      {/* Comeback banner */}
      {streakBroken && !streakPaused && (
        <div className="mb-3 px-4 py-3 rounded-xl bg-surface-elevated border border-orange-500/20 flex items-center gap-3">
          <span className="text-xl">💪</span>
          <div>
            <p className="text-sm font-medium text-white">Day 1 again. You know what to do.</p>
            <p className="text-xs text-white/40 mt-0.5">
              Your best was {profile.longest_streak} days — that record is yours to beat.
            </p>
          </div>
        </div>
      )}

      {/* Streak motivation */}
      {streakMsg && !streakBroken && !streakPaused && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-surface-elevated border border-surface-border text-xs text-white/50">
          {streakMsg}
        </div>
      )}

      {/* Daily quest */}
      <div className="mb-4">
        <DailyQuestCard
          userId={profile.id}
          streakDays={profile.streak_days}
          completedToday={dailyQuestCompletedToday}
          todayQuestId={todayQuestId}
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        <StatCard label="Total Saved" value={formatCurrency(totalSaved)} icon="💰" />
        <StatCard label="Goals" value={String(activeGoals.length)} icon="🎯" />
        <StatCard label="Streak" value={streakPaused ? "⏸" : `${profile.streak_days}d`} icon="🔥" />
      </div>

      {/* Grace days + pause control */}
      {userStage !== "new" && (
        <div className="mb-4 space-y-2">
          {(profile.streak_shields ?? 2) > 0 && !streakPaused && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-elevated border border-surface-border">
              <span className="text-base">🛡️</span>
              <span className="text-xs text-white/50">
                <span className="text-white/80 font-medium">
                  {profile.streak_shields ?? 2} grace day{(profile.streak_shields ?? 2) !== 1 ? "s" : ""}
                </span>{" "}
                available — auto-used if you miss a day
              </span>
            </div>
          )}

          {!streakPaused && profile.streak_days >= 3 && (
            <>
              {pauseConfirm ? (
                <div className="px-4 py-3 rounded-xl bg-surface-elevated border border-surface-border">
                  <p className="text-xs text-white/60 mb-2.5">
                    Pause your streak for 7 days? It will not break while paused. Use this if you're travelling, busy, or just need a rest.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handlePauseStreak}
                      disabled={pauseLoading}
                      className="flex-1 btn-ghost text-xs py-2"
                    >
                      {pauseLoading ? "Pausing…" : "Yes, pause it"}
                    </button>
                    <button
                      onClick={() => setPauseConfirm(false)}
                      className="flex-1 text-xs text-white/40 hover:text-white/60 transition-colors py-2"
                    >
                      Never mind
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setPauseConfirm(true)}
                  className="flex items-center gap-1.5 text-xs text-white/25 hover:text-white/50 transition-colors px-1"
                >
                  <PauseCircle size={12} /> Need a break? Pause your streak
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* "Almost" messages */}
      {showAlmost && (
        <div className="mb-4 space-y-2">
          {almostMessages.map((m, i) => (
            <div key={i} className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-brand-500/8 border border-brand-500/15">
              <span className="text-base">{m.icon}</span>
              <p className="text-xs text-brand-300">{m.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Momentum heatmap */}
      {showHeatmap && (
        <div className="mb-4">
          <MomentumHeatmap activityLog={activityLog} userStage={userStage} />
        </div>
      )}

      {/* Active quests */}
      {showActiveQuests && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display font-semibold text-white text-sm">Active Quests</h2>
            <Link href="/quests" className="text-brand-400 text-xs flex items-center gap-0.5">
              See all <ChevronRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {activeChallenges.slice(0, 2).map((uc: any) => {
              const ch = uc.challenges;
              if (!ch) return null;
              return (
                <div key={uc.id} className="card p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-base">⚔️</div>
                    <div>
                      <p className="text-sm font-medium text-white">{ch.title}</p>
                      <p className="text-xs text-white/40">+{ch.xp_reward} XP</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quest chain nudge */}
      {showChainNudge && (
        <Link href="/chains" className="block mb-4">
          <div className="card p-4 flex items-center gap-3 hover:border-white/10 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-brand-500/15 border border-brand-500/20 flex items-center justify-center text-xl flex-shrink-0">
              {chainDef ? chainDef.icon : "🔗"}
            </div>
            <div className="flex-1 min-w-0">
              {chainDef ? (
                <>
                  <p className="font-display font-semibold text-white text-sm">{chainDef.title}</p>
                  <p className="text-xs text-white/40">
                    Step {activeChain!.current_step} of {chainDef.steps.length} — keep going
                  </p>
                  <div className="mt-1.5 h-1 bg-surface-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full transition-all"
                      style={{ width: `${((activeChain!.current_step - 1) / chainDef.steps.length) * 100}%` }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <p className="font-display font-semibold text-white text-sm">Quest Chains</p>
                  <p className="text-xs text-white/40">Progressive challenges with big XP rewards</p>
                </>
              )}
            </div>
            <ChevronRight size={16} className="text-white/20 flex-shrink-0" />
          </div>
        </Link>
      )}

      {/* Savings goals */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display font-semibold text-white text-sm">Savings Goals</h2>
          <Link href="/goals/new" className="flex items-center gap-1 text-brand-400 text-xs hover:text-brand-300">
            <Plus size={13} /> New
          </Link>
        </div>

        {activeGoals.length === 0 ? (
          <div className="card p-7 text-center">
            <div className="text-4xl mb-3">🎯</div>
            <p className="text-white/50 text-sm mb-4">No goals yet — start your first savings quest!</p>
            <Link href="/goals/new" className="btn-primary inline-flex items-center gap-2 text-sm">
              <Plus size={15} /> Create Goal
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {activeGoals.slice(0, userStage === "new" ? 2 : 3).map((goal: any) => (
              <GoalCard key={goal.id} goal={goal} />
            ))}
            {activeGoals.length > (userStage === "new" ? 2 : 3) && (
              <Link href="/goals" className="block text-center text-brand-400 text-sm py-2 hover:text-brand-300">
                +{activeGoals.length - (userStage === "new" ? 2 : 3)} more goals →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Recent badges */}
      {showRecentBadges && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display font-semibold text-white text-sm">Recent Badges</h2>
            <Link href="/profile" className="text-brand-400 text-xs flex items-center gap-0.5">
              See all <ChevronRight size={12} />
            </Link>
          </div>
          <div className="flex gap-3">
            {recentAchievements.slice(0, 5).map(id => {
              const def = ACHIEVEMENTS.find(a => a.id === id);
              if (!def) return null;
              return (
                <div key={id} className="flex flex-col items-center gap-1.5">
                  <div className="w-12 h-12 rounded-2xl bg-surface-elevated border border-surface-border flex items-center justify-center text-2xl">
                    {def.icon}
                  </div>
                  <span className="text-[10px] text-white/40 text-center leading-tight w-12">{def.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* New user onboarding nudge */}
      {userStage === "new" && (
        <div className="mb-4 card p-4 border-brand-500/20">
          <p className="text-xs text-brand-400 font-bold uppercase tracking-wider mb-1">Getting started</p>
          <p className="text-sm text-white/60">
            Complete your daily quest and log a saving to start building your streak. More features unlock as you progress.
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="card p-3 text-center">
      <div className="text-xl mb-1">{icon}</div>
      <div className="font-display font-bold text-white text-base leading-tight">{value}</div>
      <div className="text-[10px] text-white/40 mt-0.5">{label}</div>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning ☀️";
  if (h < 17) return "Good afternoon ⚡";
  return "Good evening 🌙";
}
