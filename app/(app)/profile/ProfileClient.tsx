"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { formatCurrency } from "@/lib/utils";
import { LEVELS, TIER_COLORS, TIER_LABELS, type LevelTier } from "@/lib/xp";
import { LogOut, ChevronDown, ChevronUp, Lock } from "lucide-react";

interface Props {
  profile: any;
  levelInfo: any;
  earnedIds: string[];
  totalSaved: number;
  totalTransactions: number;
  completedChains: number;
}

const AVATAR_OPTIONS = ["🌱", "💰", "🚀", "⚡", "🏆", "🔥", "💎", "👑", "🦅", "🧠", "🎯", "✨", "🌟", "⚔️", "🛡️"];
type ProfileTab = "badges" | "levels" | "stats";

export default function ProfileClient({ profile, levelInfo, earnedIds, totalSaved, totalTransactions, completedChains }: Props) {
  const router = useRouter();
  const [selectedAvatar, setSelectedAvatar] = useState(profile.avatar_emoji);
  const [activeTab, setActiveTab] = useState<ProfileTab>("badges");
  const [badgeFilter, setBadgeFilter] = useState<"all" | "streak" | "savings" | "quest" | "hidden">("all");
  const [showAllLevels, setShowAllLevels] = useState(false);

  const earnedSet = new Set(earnedIds);
  const tierColor = TIER_COLORS[levelInfo.tier as LevelTier];
  const tierLabel = TIER_LABELS[levelInfo.tier as LevelTier];

  const filteredAchievements = ACHIEVEMENTS.filter(a => {
    if (badgeFilter === "all") return true;
    if (badgeFilter === "hidden") return a.category === "hidden";
    return a.category === badgeFilter;
  });
  const earnedFiltered = filteredAchievements.filter(a => earnedSet.has(a.id));
  const lockedFiltered = filteredAchievements.filter(a => !earnedSet.has(a.id) && !a.secret);

  async function updateAvatar(emoji: string) {
    setSelectedAvatar(emoji);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.from("profiles").update({ avatar_emoji: emoji }).eq("id", user.id);
    router.refresh();
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  const displayedLevels = showAllLevels ? LEVELS : LEVELS.slice(0, 15);

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-display text-2xl font-bold text-white">Profile</h1>
        <button onClick={handleLogout} className="flex items-center gap-1.5 text-white/30 hover:text-red-400 transition-colors text-sm">
          <LogOut size={15} /> Sign out
        </button>
      </div>

      {/* Profile card */}
      <div className="card p-5 mb-4 text-center">
        <div className="text-6xl mb-3">{selectedAvatar}</div>
        <h2 className="font-display text-xl font-bold text-white">{profile.display_name}</h2>
        <div className="flex items-center justify-center gap-2 mt-1.5">
          <span
            className="text-xs font-bold rounded-full px-3 py-1 border"
            style={{ color: tierColor, borderColor: `${tierColor}40`, backgroundColor: `${tierColor}12` }}
          >
            {tierLabel} · Level {levelInfo.level}
          </span>
          <span className="text-xs text-white/40">{levelInfo.title}</span>
        </div>

        {/* XP bar */}
        <div className="mt-4 mb-1">
          <div className="xp-bar-container">
            <div className="xp-bar-fill" style={{ width: `${levelInfo.progressPercent}%` }} />
          </div>
        </div>
        <div className="flex justify-between text-xs text-white/30">
          <span>Lv {levelInfo.level}</span>
          <span className="text-brand-400 font-bold">{profile.xp_total.toLocaleString()} XP</span>
          {levelInfo.level < 50 && <span>Lv {levelInfo.level + 1}</span>}
        </div>

        {/* Streak shields */}
        {(profile.streak_shields ?? 2) > 0 && (
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {Array.from({ length: profile.streak_shields ?? 2 }).map((_, i) => (
              <span key={i} className="text-base">🛡️</span>
            ))}
            <span className="text-xs text-white/40">{profile.streak_shields} shield{profile.streak_shields !== 1 ? "s" : ""}</span>
          </div>
        )}

        {/* Avatar picker */}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {AVATAR_OPTIONS.map(emoji => (
            <button
              key={emoji}
              onClick={() => updateAvatar(emoji)}
              className={`w-10 h-10 rounded-xl text-xl transition-all duration-200 ${
                selectedAvatar === emoji
                  ? "bg-brand-500/20 border-2 border-brand-500/60 scale-110"
                  : "bg-surface-elevated border border-surface-border hover:border-white/20"
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4 bg-surface-elevated p-1 rounded-2xl">
        {(["badges", "levels", "stats"] as ProfileTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 capitalize ${
              activeTab === tab ? "bg-brand-500 text-black" : "text-white/40 hover:text-white/70"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── BADGES TAB ──────────────────────────── */}
      {activeTab === "badges" && (
        <div className="mb-6">
          {/* Filter chips */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {(["all", "streak", "savings", "quest", "hidden"] as const).map(f => (
              <button
                key={f}
                onClick={() => setBadgeFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-all ${
                  badgeFilter === f ? "bg-brand-500 text-black" : "bg-surface-elevated border border-surface-border text-white/50"
                }`}
              >
                {f === "hidden" ? "🔍 Secret" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {earnedFiltered.length > 0 && (
            <>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">
                Earned ({earnedFiltered.length})
              </p>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {earnedFiltered.map(a => (
                  <div key={a.id} className="card p-3 flex flex-col items-center gap-2 border-emerald-500/10">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-2xl animate-badge-pop">
                      {a.icon}
                    </div>
                    <span className="text-[11px] text-white/70 text-center leading-tight font-medium">{a.title}</span>
                    <span className="text-[10px] text-emerald-400">+{a.xpReward} XP</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {lockedFiltered.length > 0 && (
            <>
              <p className="text-xs text-white/30 uppercase tracking-wider mb-3">Locked ({lockedFiltered.length})</p>
              <div className="grid grid-cols-3 gap-3">
                {lockedFiltered.map(a => (
                  <div key={a.id} className="card p-3 flex flex-col items-center gap-2 opacity-35">
                    <div className="w-12 h-12 rounded-2xl bg-surface-elevated border border-surface-border flex items-center justify-center text-2xl grayscale">
                      {a.icon}
                    </div>
                    <span className="text-[11px] text-white/40 text-center leading-tight">{a.title}</span>
                    <span className="text-[10px] text-white/20 text-center leading-tight">{a.description}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {badgeFilter === "hidden" && (
            <div className="card p-4 text-center mt-3">
              <p className="text-white/30 text-sm">🔍 Secret badges are hidden until discovered!</p>
              <p className="text-white/20 text-xs mt-1">Keep saving and exploring to find them.</p>
            </div>
          )}
        </div>
      )}

      {/* ── LEVELS TAB ──────────────────────────── */}
      {activeTab === "levels" && (
        <div className="mb-6 space-y-1.5">
          {displayedLevels.map(lv => {
            const unlocked = profile.xp_total >= lv.xpRequired;
            const isCurrent = lv.level === levelInfo.level;
            const color = TIER_COLORS[lv.tier as LevelTier];

            return (
              <div
                key={lv.level}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  isCurrent
                    ? "border-brand-500/40 bg-brand-500/8"
                    : unlocked
                    ? "border-surface-border/50 bg-surface-card"
                    : "border-surface-border/30 bg-surface-card opacity-40"
                }`}
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold border flex-shrink-0"
                  style={unlocked
                    ? { color, borderColor: `${color}40`, backgroundColor: `${color}15` }
                    : { color: "#4b5563", borderColor: "#374151", backgroundColor: "#1f2937" }
                  }
                >
                  {unlocked ? lv.level : <Lock size={12} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isCurrent ? "text-white" : unlocked ? "text-white/70" : "text-white/30"}`}>
                    {lv.title}
                  </p>
                  <p className="text-[11px] text-white/30" style={unlocked ? { color: `${color}80` } : {}}>
                    {TIER_LABELS[lv.tier as LevelTier]}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  {isCurrent && <span className="text-brand-400 text-xs font-bold">← You</span>}
                  {!isCurrent && !unlocked && (
                    <span className="text-white/20 text-xs">{lv.xpRequired.toLocaleString()} XP</span>
                  )}
                  {!isCurrent && unlocked && (
                    <span className="text-emerald-400 text-xs">✓</span>
                  )}
                </div>
              </div>
            );
          })}

          <button
            onClick={() => setShowAllLevels(!showAllLevels)}
            className="w-full flex items-center justify-center gap-2 py-3 text-sm text-white/40 hover:text-white/60 transition-colors"
          >
            {showAllLevels ? <><ChevronUp size={14} /> Show less</> : <><ChevronDown size={14} /> Show all 50 levels</>}
          </button>
        </div>
      )}

      {/* ── STATS TAB ───────────────────────────── */}
      {activeTab === "stats" && (
        <div className="mb-6 space-y-2">
          <StatRow icon="💰" label="Total Saved" value={formatCurrency(totalSaved)} />
          <StatRow icon="🔥" label="Current Streak" value={`${profile.streak_days} days`} />
          <StatRow icon="🏆" label="Longest Streak" value={`${profile.longest_streak ?? 0} days`} />
          <StatRow icon="🛡️" label="Shields Used" value={String(profile.total_shields_used ?? 0)} />
          <StatRow icon="📝" label="Savings Logged" value={String(totalTransactions)} />
          <StatRow icon="⚡" label="Total XP" value={`${profile.xp_total.toLocaleString()} XP`} />
          <StatRow icon="📅" label="Daily Quests Done" value={String(profile.daily_quests_completed ?? 0)} />
          <StatRow icon="🗓️" label="Weekly Quests Done" value={String(profile.weekly_quests_completed ?? 0)} />
          <StatRow icon="🔗" label="Chains Complete" value={String(completedChains)} />
          <StatRow icon="🏅" label="Badges Earned" value={String(earnedIds.length)} />
          <StatRow icon="⭐" label="Current Level" value={`Lv ${levelInfo.level} — ${levelInfo.title}`} />
        </div>
      )}

      {/* Admin link */}
      {profile.is_admin && (
        <div className="mb-6">
          <a href="/admin" className="btn-ghost w-full flex items-center justify-center gap-2 text-sm">
            🛡️ Admin Dashboard
          </a>
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
      <span className="font-display font-bold text-white text-sm text-right max-w-32 truncate">{value}</span>
    </div>
  );
}
