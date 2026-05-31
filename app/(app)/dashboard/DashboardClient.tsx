"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { getStreakMessage } from "@/lib/streaks";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { getStreakMultiplierLabel, TIER_COLORS, TIER_LABELS } from "@/lib/xp";
import GoalCard from "@/components/goals/GoalCard";
import XPProgressBar from "@/components/gamification/XPProgressBar";
import StreakBadge from "@/components/gamification/StreakBadge";
import MomentumHeatmap from "@/components/gamification/MomentumHeatmap";
import DailyQuestCard from "@/components/gamification/DailyQuestCard";
import { ChevronRight, Plus, Link2 } from "lucide-react";

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
}

export default function DashboardClient({
  profile, levelInfo, totalSaved, activeGoals, completedGoals,
  activeChallenges, recentAchievements, activityLog,
  dailyQuestCompletedToday, todayQuestId,
}: Props) {
  const greeting = getGreeting();
  const streakMsg = getStreakMessage(profile.streak_days);
  const multiplierLabel = getStreakMultiplierLabel(profile.streak_days);
  const tierColor = TIER_COLORS[levelInfo.tier as keyof typeof TIER_COLORS];
  const tierLabel = TIER_LABELS[levelInfo.tier as keyof typeof TIER_LABELS];

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4 bg-mesh min-h-screen">

      {/* ── Header ─────────────────────────────── */}
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
        <StreakBadge streak={profile.streak_days} />
      </div>

      {/* ── XP Bar ─────────────────────────────── */}
      <div className="card p-4 mb-3">
        <XPProgressBar levelInfo={levelInfo} xpTotal={profile.xp_total} />
        {multiplierLabel && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-brand-400 bg-brand-500/10 border border-brand-500/20 rounded-full px-2.5 py-0.5">
              ⚡ {multiplierLabel}
            </span>
          </div>
        )}
      </div>

      {/* ── Streak motivation ──────────────────── */}
      {streakMsg && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-surface-elevated border border-surface-border text-xs text-white/50">
          {streakMsg}
        </div>
      )}

      {/* ── Daily quest ────────────────────────── */}
      <div className="mb-4">
        <DailyQuestCard
          userId={profile.id}
          streakDays={profile.streak_days}
          completedToday={dailyQuestCompletedToday}
          todayQuestId={todayQuestId}
        />
      </div>

      {/* ── Stats row ──────────────────────────── */}
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        <StatCard label="Total Saved" value={formatCurrency(totalSaved)} icon="💰" />
        <StatCard label="Goals" value={String(activeGoals.length)} icon="🎯" />
        <StatCard label="Streak" value={`${profile.streak_days}d`} icon="🔥" />
      </div>

      {/* ── Streak shields ─────────────────────── */}
      {(profile.streak_shields ?? 2) > 0 && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-elevated border border-surface-border">
          <span className="text-base">🛡️</span>
          <span className="text-xs text-white/50">
            <span className="text-white/80 font-medium">{profile.streak_shields ?? 2} streak shield{(profile.streak_shields ?? 2) !== 1 ? "s" : ""}</span> available — auto-protect if you miss a day
          </span>
        </div>
      )}

      {/* ── Momentum heatmap ───────────────────── */}
      <div className="mb-4">
        <MomentumHeatmap activityLog={activityLog} />
      </div>

      {/* ── Active quests ──────────────────────── */}
      {activeChallenges.length > 0 && (
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

      {/* ── Quest chains CTA ───────────────────── */}
      <Link href="/chains" className="block mb-4">
        <div className="card p-4 flex items-center gap-3 hover:border-white/10 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-brand-500/15 border border-brand-500/20 flex items-center justify-center text-xl">🔗</div>
          <div className="flex-1">
            <p className="font-display font-semibold text-white text-sm">Quest Chains</p>
            <p className="text-xs text-white/40">Progressive challenges with big XP rewards</p>
          </div>
          <ChevronRight size={16} className="text-white/20" />
        </div>
      </Link>

      {/* ── Savings goals ──────────────────────── */}
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
            {activeGoals.slice(0, 3).map(goal => <GoalCard key={goal.id} goal={goal} />)}
            {activeGoals.length > 3 && (
              <Link href="/goals" className="block text-center text-brand-400 text-sm py-2 hover:text-brand-300">
                +{activeGoals.length - 3} more goals →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* ── Recent badges ──────────────────────── */}
      {recentAchievements.length > 0 && (
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
