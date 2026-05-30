"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { formatCurrency } from "@/lib/utils";
import { LEVELS } from "@/lib/xp";
import { LogOut } from "lucide-react";

interface Props {
  profile: any;
  levelInfo: any;
  earnedIds: string[];
  totalSaved: number;
  completedGoals: number;
  totalTransactions: number;
}

const AVATAR_OPTIONS = ["🌱", "💰", "🚀", "⚡", "🏆", "🔥", "💎", "👑", "🦅", "🧠"];

export default function ProfileClient({ profile, levelInfo, earnedIds, totalSaved, completedGoals, totalTransactions }: Props) {
  const router = useRouter();
  const [selectedAvatar, setSelectedAvatar] = useState(profile.avatar_emoji);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [activeTab, setActiveTab] = useState<"badges" | "stats">("badges");

  const earnedSet = new Set(earnedIds);
  const earnedAchievements = ACHIEVEMENTS.filter(a => earnedSet.has(a.id));
  const lockedAchievements = ACHIEVEMENTS.filter(a => !earnedSet.has(a.id) && !a.secret);

  async function updateAvatar(emoji: string) {
    setSelectedAvatar(emoji);
    setSavingAvatar(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({ avatar_emoji: emoji }).eq("id", user.id);
    }
    setSavingAvatar(false);
    router.refresh();
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-bold text-white">Profile</h1>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-white/30 hover:text-red-400 transition-colors text-sm"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>

      {/* Profile card */}
      <div className="card p-5 mb-4 text-center">
        <div className="text-6xl mb-3">{selectedAvatar}</div>
        <h2 className="font-display text-xl font-bold text-white">{profile.display_name}</h2>
        <div className="flex items-center justify-center gap-2 mt-1">
          <span className="text-xs bg-brand-500/10 border border-brand-500/20 text-brand-400 rounded-full px-2.5 py-0.5">
            Level {levelInfo.level}
          </span>
          <span className="text-xs text-white/40">{levelInfo.title}</span>
        </div>

        {/* Avatar picker */}
        <div className="flex justify-center gap-2 mt-4 flex-wrap">
          {AVATAR_OPTIONS.map(emoji => (
            <button
              key={emoji}
              onClick={() => updateAvatar(emoji)}
              className={`w-10 h-10 rounded-xl text-xl transition-all duration-200 ${
                selectedAvatar === emoji
                  ? "bg-brand-500/20 border-2 border-brand-500/60 scale-110"
                  : "bg-surface-elevated border border-surface-border hover:border-surface-border/80"
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-white/20 mt-2">Tap to change avatar</p>
      </div>

      {/* XP breakdown */}
      <div className="card p-4 mb-4">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-medium text-white/60">XP Progress</span>
          <span className="text-brand-400 font-display font-bold text-sm">{profile.xp_total.toLocaleString()} XP</span>
        </div>
        <div className="xp-bar-container mb-2">
          <div className="xp-bar-fill" style={{ width: `${levelInfo.progressPercent}%` }} />
        </div>
        <div className="flex justify-between text-xs text-white/30">
          <span>Lv {levelInfo.level}</span>
          {levelInfo.level < 10 && <span>{(levelInfo.nextLevelXP - profile.xp_total).toLocaleString()} XP to Lv {levelInfo.level + 1}</span>}
        </div>

        {/* Level roadmap */}
        <div className="mt-3 space-y-1">
          {LEVELS.slice(0, 6).map(lv => (
            <div key={lv.level} className={`flex items-center gap-2 text-xs ${profile.xp_total >= lv.xpRequired ? "text-white/60" : "text-white/20"}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                lv.level === levelInfo.level ? "border-brand-500 bg-brand-500/20 text-brand-400" :
                profile.xp_total >= lv.xpRequired ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" :
                "border-surface-border bg-surface-elevated text-white/20"
              }`}>{lv.level}</span>
              <span>{lv.title}</span>
              {lv.level > levelInfo.level && <span className="ml-auto">{lv.xpRequired.toLocaleString()} XP</span>}
              {lv.level === levelInfo.level && <span className="ml-auto text-brand-400">← You</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(["badges", "stats"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 capitalize ${
              activeTab === tab ? "bg-brand-500 text-black" : "bg-surface-elevated text-white/50 hover:text-white/70"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "badges" ? (
        <div className="mb-6">
          {earnedAchievements.length > 0 && (
            <>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Earned ({earnedAchievements.length})</p>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {earnedAchievements.map(a => (
                  <div key={a.id} className="card p-3 flex flex-col items-center gap-2 border-emerald-500/10">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-2xl">
                      {a.icon}
                    </div>
                    <span className="text-[11px] text-white/70 text-center leading-tight font-medium">{a.title}</span>
                    <span className="text-[10px] text-emerald-400">+{a.xpReward} XP</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {lockedAchievements.length > 0 && (
            <>
              <p className="text-xs text-white/30 uppercase tracking-wider mb-3">Locked ({lockedAchievements.length})</p>
              <div className="grid grid-cols-3 gap-3">
                {lockedAchievements.map(a => (
                  <div key={a.id} className="card p-3 flex flex-col items-center gap-2 opacity-40">
                    <div className="w-12 h-12 rounded-2xl bg-surface-elevated border border-surface-border flex items-center justify-center text-2xl grayscale">
                      {a.icon}
                    </div>
                    <span className="text-[11px] text-white/40 text-center leading-tight">{a.title}</span>
                    <span className="text-[10px] text-white/20">{a.description}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {earnedAchievements.length === 0 && (
            <div className="card p-8 text-center">
              <div className="text-4xl mb-3">🏅</div>
              <p className="text-white/40 text-sm">Start saving to earn your first badge!</p>
            </div>
          )}
        </div>
      ) : (
        <div className="mb-6 space-y-3">
          <StatRow icon="💰" label="Total Saved" value={formatCurrency(totalSaved)} />
          <StatRow icon="🔥" label="Current Streak" value={`${profile.streak_days} days`} />
          <StatRow icon="✅" label="Goals Completed" value={String(completedGoals)} />
          <StatRow icon="📝" label="Savings Logged" value={String(totalTransactions)} />
          <StatRow icon="⚡" label="Total XP" value={`${profile.xp_total.toLocaleString()} XP`} />
          <StatRow icon="🏅" label="Badges Earned" value={String(earnedAchievements.length)} />
        </div>
      )}
    </div>
  );
}

function StatRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="card p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <span className="text-sm text-white/60">{label}</span>
      </div>
      <span className="font-display font-bold text-white text-sm">{value}</span>
    </div>
  );
}
