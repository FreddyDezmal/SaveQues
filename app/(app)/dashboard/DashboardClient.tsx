"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import GoalCard from "@/components/goals/GoalCard";
import XPProgressBar from "@/components/gamification/XPProgressBar";
import StreakBadge from "@/components/gamification/StreakBadge";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { ChevronRight, Plus, Zap } from "lucide-react";

interface Props {
  profile: any;
  levelInfo: any;
  totalSaved: number;
  activeGoals: any[];
  completedGoals: any[];
  activeChallenges: any[];
  recentAchievements: any[];
}

export default function DashboardClient({
  profile,
  levelInfo,
  totalSaved,
  activeGoals,
  completedGoals,
  activeChallenges,
  recentAchievements,
}: Props) {
  const greeting = getGreeting();

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4 bg-mesh min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-white/40 text-sm">{greeting}</p>
          <h1 className="font-display text-2xl font-bold text-white mt-0.5">
            {profile.display_name} <span className="text-brand-500">{profile.avatar_emoji}</span>
          </h1>
        </div>
        <StreakBadge streak={profile.streak_days} />
      </div>

      {/* XP bar */}
      <div className="card p-4 mb-4">
        <XPProgressBar levelInfo={levelInfo} xpTotal={profile.xp_total} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="Total Saved" value={formatCurrency(totalSaved)} icon="💰" color="emerald" />
        <StatCard label="Active Goals" value={String(activeGoals.length)} icon="🎯" color="brand" />
        <StatCard label="Completed" value={String(completedGoals.length)} icon="✅" color="purple" />
      </div>

      {/* Active challenges strip */}
      {activeChallenges.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-semibold text-white">Active Quests</h2>
            <Link href="/quests" className="text-brand-400 text-xs flex items-center gap-0.5 hover:text-brand-300">
              See all <ChevronRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {activeChallenges.slice(0, 2).map((uc: any) => (
              <ActiveChallengeRow key={uc.id} uc={uc} />
            ))}
          </div>
        </div>
      )}

      {/* Goals section */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold text-white">Savings Goals</h2>
          <Link
            href="/goals/new"
            className="flex items-center gap-1 text-brand-400 text-xs hover:text-brand-300 transition-colors"
          >
            <Plus size={14} /> New Goal
          </Link>
        </div>

        {activeGoals.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-3">🎯</div>
            <p className="text-white/60 text-sm mb-4">No goals yet. Start your first savings quest!</p>
            <Link href="/goals/new" className="btn-primary inline-flex items-center gap-2">
              <Plus size={16} /> Create Goal
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {activeGoals.slice(0, 3).map(goal => (
              <GoalCard key={goal.id} goal={goal} />
            ))}
            {activeGoals.length > 3 && (
              <Link
                href="/goals"
                className="block text-center text-brand-400 text-sm py-2 hover:text-brand-300 transition-colors"
              >
                +{activeGoals.length - 3} more goals →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Recent achievements */}
      {recentAchievements.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-semibold text-white">Recent Badges</h2>
            <Link href="/profile" className="text-brand-400 text-xs flex items-center gap-0.5 hover:text-brand-300">
              See all <ChevronRight size={12} />
            </Link>
          </div>
          <div className="flex gap-3">
            {recentAchievements.slice(0, 5).map((ua: any) => {
              const def = ACHIEVEMENTS.find(a => a.id === ua.achievement_id);
              if (!def) return null;
              return (
                <div key={ua.id} className="flex flex-col items-center gap-1.5">
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

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <div className="card p-3 text-center">
      <div className="text-xl mb-1">{icon}</div>
      <div className="font-display font-bold text-white text-lg leading-tight">{value}</div>
      <div className="text-[10px] text-white/40 mt-0.5">{label}</div>
    </div>
  );
}

function ActiveChallengeRow({ uc }: { uc: any }) {
  const ch = uc.challenges;
  if (!ch) return null;
  const daysLeft = ch.duration_days;
  return (
    <div className="card p-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-lg">
          ⚔️
        </div>
        <div>
          <p className="text-sm font-medium text-white">{ch.title}</p>
          <p className="text-xs text-white/40">{ch.xp_reward} XP reward</p>
        </div>
      </div>
      <div className="flex items-center gap-1 text-brand-400 text-xs">
        <Zap size={12} />
        <span>{daysLeft}d</span>
      </div>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning ☀️";
  if (h < 17) return "Good afternoon ⚡";
  return "Good evening 🌙";
}
