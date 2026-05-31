"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { getLevelFromXP, TIER_COLORS } from "@/lib/xp";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { format, subDays } from "date-fns";
import {
  Users, Target, Zap, TrendingUp, Plus, Edit2,
  ToggleLeft, ToggleRight, ShieldCheck, ChevronDown, ChevronUp, Check
} from "lucide-react";

interface Props {
  users: any[];
  goals: any[];
  transactions: any[];
  challenges: any[];
  userChallenges: any[];
  userAchievements: any[];
  activityLog: any[];
  adminName: string;
}

type Tab = "overview" | "users" | "challenges" | "activity";

export default function AdminClient({
  users, goals, transactions, challenges,
  userChallenges, userAchievements, activityLog, adminName,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [editingChallenge, setEditingChallenge] = useState<any | null>(null);
  const [newChallenge, setNewChallenge] = useState(false);
  const [challengeForm, setChallengeForm] = useState({
    title: "", description: "", type: "manual", xp_reward: 200, duration_days: 7, is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  // ── Platform stats ──────────────────────────────────────
  const totalUsers = users.length;
  const totalSaved = transactions.reduce((s, t) => s + Number(t.amount), 0);
  const totalGoals = goals.length;
  const completedGoals = goals.filter(g => g.is_complete).length;
  const activeStreaks = users.filter(u => (u.streak_days ?? 0) >= 3).length;
  const totalXPAwarded = users.reduce((s, u) => s + (u.xp_total ?? 0), 0);

  // Active users in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const recentlyActive = users.filter(u => u.last_active_date && u.last_active_date >= sevenDaysAgo).length;

  // Activity by date (last 30 days)
  const activityByDate = new Map<string, number>();
  for (const a of activityLog) {
    activityByDate.set(a.activity_date, (activityByDate.get(a.activity_date) ?? 0) + a.actions_count);
  }

  // ── Challenge CRUD ──────────────────────────────────────
  function startEdit(ch: any) {
    setEditingChallenge(ch);
    setChallengeForm({
      title: ch.title, description: ch.description, type: ch.type,
      xp_reward: ch.xp_reward, duration_days: ch.duration_days, is_active: ch.is_active,
    });
    setNewChallenge(false);
  }

  function startNew() {
    setEditingChallenge(null);
    setChallengeForm({ title: "", description: "", type: "manual", xp_reward: 200, duration_days: 7, is_active: true });
    setNewChallenge(true);
  }

  async function saveChallenge() {
    setSaving(true);
    const supabase = createClient();
    if (newChallenge) {
      await supabase.from("challenges").insert(challengeForm);
    } else if (editingChallenge) {
      await supabase.from("challenges").update(challengeForm).eq("id", editingChallenge.id);
    }
    setSaving(false);
    setEditingChallenge(null);
    setNewChallenge(false);
    router.refresh();
  }

  async function toggleChallenge(id: string, current: boolean) {
    const supabase = createClient();
    await supabase.from("challenges").update({ is_active: !current }).eq("id", id);
    router.refresh();
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview",   label: "Overview",   icon: <TrendingUp size={14} /> },
    { id: "users",      label: "Users",      icon: <Users size={14} /> },
    { id: "challenges", label: "Challenges", icon: <Zap size={14} /> },
    { id: "activity",   label: "Activity",   icon: <Target size={14} /> },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <ShieldCheck size={16} className="text-brand-400" />
            <span className="text-brand-400 text-xs font-bold uppercase tracking-wider">Admin</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-white/40 text-sm">Welcome, {adminName}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-6 bg-surface-elevated p-1 rounded-2xl">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-medium transition-all duration-200 ${
              tab === t.id ? "bg-brand-500 text-black" : "text-white/40 hover:text-white/70"
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-4">
          {/* KPI grid */}
          <div className="grid grid-cols-2 gap-3">
            <KPICard icon="👥" label="Total Users" value={String(totalUsers)} sub={`${recentlyActive} active last 7d`} />
            <KPICard icon="💰" label="Platform Saved" value={formatCurrency(totalSaved)} sub={`${transactions.length} transactions`} />
            <KPICard icon="🎯" label="Goals" value={String(totalGoals)} sub={`${completedGoals} completed`} />
            <KPICard icon="🔥" label="Active Streaks" value={String(activeStreaks)} sub="3+ day streaks" />
            <KPICard icon="⚡" label="XP Awarded" value={totalXPAwarded.toLocaleString()} sub="across all users" />
            <KPICard icon="⚔️" label="Challenges Live" value={String(challenges.filter(c => c.is_active).length)} sub={`of ${challenges.length} total`} />
          </div>

          {/* Top savers */}
          <div className="card p-4">
            <h3 className="font-display font-semibold text-white text-sm mb-3">Top Savers by XP</h3>
            <div className="space-y-2">
              {[...users]
                .sort((a, b) => (b.xp_total ?? 0) - (a.xp_total ?? 0))
                .slice(0, 5)
                .map((u, i) => {
                  const lv = getLevelFromXP(u.xp_total ?? 0);
                  return (
                    <div key={u.id} className="flex items-center gap-3">
                      <span className="text-white/30 text-xs w-4">{i + 1}</span>
                      <span className="text-lg">{u.avatar_emoji ?? "🌱"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{u.display_name}</p>
                        <p className="text-xs" style={{ color: TIER_COLORS[lv.tier] }}>Lv {lv.level} · {lv.title}</p>
                      </div>
                      <span className="text-brand-400 text-xs font-bold">{(u.xp_total ?? 0).toLocaleString()} XP</span>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Category breakdown */}
          <div className="card p-4">
            <h3 className="font-display font-semibold text-white text-sm mb-3">Goals by Category</h3>
            {(() => {
              const cats = new Map<string, number>();
              for (const g of goals) cats.set(g.category, (cats.get(g.category) ?? 0) + 1);
              const sorted = Array.from(cats.entries()).sort((a, b) => b[1] - a[1]);
              const max = sorted[0]?.[1] ?? 1;
              return (
                <div className="space-y-2">
                  {sorted.map(([cat, count]) => (
                    <div key={cat} className="flex items-center gap-3">
                      <span className="text-xs text-white/50 w-20 truncate capitalize">{cat}</span>
                      <div className="flex-1 h-1.5 bg-surface-border rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${(count / max) * 100}%` }} />
                      </div>
                      <span className="text-xs text-white/40 w-6 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── USERS TAB ────────────────────────────────────── */}
      {tab === "users" && (
        <div className="space-y-2">
          {users.map(u => {
            const lv = getLevelFromXP(u.xp_total ?? 0);
            const userGoals = goals.filter(g => g.user_id === u.id);
            const userTx = transactions.filter(t => t.user_id === u.id);
            const userSaved = userTx.reduce((s, t) => s + Number(t.amount), 0);
            const userBadges = userAchievements.filter(a => a.user_id === u.id).length;
            const isExpanded = expandedUser === u.id;

            return (
              <div key={u.id} className="card overflow-hidden">
                <button
                  className="w-full p-4 flex items-center gap-3 text-left"
                  onClick={() => setExpandedUser(isExpanded ? null : u.id)}
                >
                  <span className="text-2xl">{u.avatar_emoji ?? "🌱"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white text-sm truncate">{u.display_name}</p>
                    <p className="text-xs" style={{ color: TIER_COLORS[lv.tier] }}>
                      Lv {lv.level} {lv.title}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-white/40">
                    <span className={`px-2 py-0.5 rounded-full ${(u.streak_days ?? 0) >= 7 ? "bg-orange-500/10 text-orange-400" : "bg-surface-elevated"}`}>
                      🔥 {u.streak_days ?? 0}d
                    </span>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-surface-border pt-3">
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <MiniStat label="Saved" value={formatCurrency(userSaved)} />
                      <MiniStat label="Goals" value={String(userGoals.length)} />
                      <MiniStat label="Badges" value={String(userBadges)} />
                      <MiniStat label="XP" value={(u.xp_total ?? 0).toLocaleString()} />
                      <MiniStat label="Streak" value={`${u.streak_days ?? 0}d`} />
                      <MiniStat label="Shields" value={String(u.streak_shields ?? 2)} />
                    </div>
                    <div className="text-xs text-white/30 space-y-0.5">
                      <p>Joined: {u.created_at ? format(new Date(u.created_at), "d MMM yyyy") : "—"}</p>
                      <p>Last active: {u.last_active_date ?? "Never"}</p>
                      <p>Longest streak: {u.longest_streak ?? 0} days</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {users.length === 0 && (
            <div className="card p-10 text-center text-white/40 text-sm">No users yet.</div>
          )}
        </div>
      )}

      {/* ── CHALLENGES TAB ───────────────────────────────── */}
      {tab === "challenges" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-white/40 text-sm">{challenges.length} challenges</p>
            <button onClick={startNew} className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2">
              <Plus size={14} /> New Challenge
            </button>
          </div>

          {/* Challenge form */}
          {(newChallenge || editingChallenge) && (
            <div className="card p-4 mb-4 border-brand-500/30">
              <h3 className="font-display font-semibold text-white text-sm mb-3">
                {newChallenge ? "New Challenge" : "Edit Challenge"}
              </h3>
              <div className="space-y-3">
                <input
                  className="input-field"
                  placeholder="Title"
                  value={challengeForm.title}
                  onChange={e => setChallengeForm(f => ({ ...f, title: e.target.value }))}
                />
                <textarea
                  className="input-field resize-none"
                  rows={2}
                  placeholder="Description"
                  value={challengeForm.description}
                  onChange={e => setChallengeForm(f => ({ ...f, description: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/40 mb-1">XP Reward</label>
                    <input
                      type="number"
                      className="input-field"
                      value={challengeForm.xp_reward}
                      onChange={e => setChallengeForm(f => ({ ...f, xp_reward: Number(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Duration (days)</label>
                    <input
                      type="number"
                      className="input-field"
                      value={challengeForm.duration_days}
                      onChange={e => setChallengeForm(f => ({ ...f, duration_days: Number(e.target.value) }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Type</label>
                  <select
                    className="input-field"
                    value={challengeForm.type}
                    onChange={e => setChallengeForm(f => ({ ...f, type: e.target.value }))}
                  >
                    <option value="manual">Manual</option>
                    <option value="seasonal">Seasonal</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveChallenge} disabled={saving} className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2.5">
                    <Check size={14} /> {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => { setEditingChallenge(null); setNewChallenge(false); }}
                    className="btn-ghost text-sm px-4 py-2.5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {challenges.map(ch => {
              const completions = userChallenges.filter(uc => uc.challenge_id === ch.id && uc.status === "completed").length;
              const active = userChallenges.filter(uc => uc.challenge_id === ch.id && uc.status === "active").length;

              return (
                <div key={ch.id} className={`card p-4 ${!ch.is_active ? "opacity-50" : ""}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-medium text-white text-sm truncate">{ch.title}</p>
                        <span className="text-[10px] text-white/30 border border-surface-border rounded-full px-1.5 py-0.5">{ch.type}</span>
                      </div>
                      <p className="text-xs text-white/40 mb-2">{ch.description}</p>
                      <div className="flex items-center gap-3 text-xs text-white/30">
                        <span className="text-brand-400">⚡ {ch.xp_reward} XP</span>
                        <span>⏱ {ch.duration_days}d</span>
                        <span>✅ {completions} completed</span>
                        <span>🔄 {active} active</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => startEdit(ch)}
                        className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-white/70 transition-colors"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => toggleChallenge(ch.id, ch.is_active)}
                        className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center transition-colors hover:border-brand-500/40"
                      >
                        {ch.is_active
                          ? <ToggleRight size={16} className="text-brand-400" />
                          : <ToggleLeft size={16} className="text-white/30" />
                        }
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ACTIVITY TAB ─────────────────────────────────── */}
      {tab === "activity" && (
        <div className="space-y-4">
          {/* 30-day activity chart */}
          <div className="card p-4">
            <h3 className="font-display font-semibold text-white text-sm mb-3">Platform Activity — Last 30 Days</h3>
            <div className="grid grid-cols-10 gap-1 mb-2">
              {Array.from({ length: 30 }, (_, i) => {
                const d = subDays(new Date(), 29 - i);
                const dateStr = format(d, "yyyy-MM-dd");
                const count = activityByDate.get(dateStr) ?? 0;
                const intensity = count === 0 ? "bg-surface-border"
                  : count < 3  ? "bg-brand-900/40"
                  : count < 8  ? "bg-brand-700/60"
                  : count < 15 ? "bg-brand-500/70"
                  : "bg-brand-400";
                return (
                  <div key={i} title={`${dateStr}: ${count} actions`}
                    className={`aspect-square rounded-md ${intensity}`} />
                );
              })}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-white/30">
              <span>Less</span>
              {["bg-surface-border","bg-brand-900/40","bg-brand-700/60","bg-brand-500/70","bg-brand-400"].map(c => (
                <div key={c} className={`w-3 h-3 rounded-sm ${c}`} />
              ))}
              <span>More</span>
            </div>
          </div>

          {/* Achievement distribution */}
          <div className="card p-4">
            <h3 className="font-display font-semibold text-white text-sm mb-3">Most Earned Badges</h3>
            {(() => {
              const counts = new Map<string, number>();
              for (const a of userAchievements) counts.set(a.achievement_id, (counts.get(a.achievement_id) ?? 0) + 1);
              const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
              const max = sorted[0]?.[1] ?? 1;
              return (
                <div className="space-y-2">
                  {sorted.map(([id, count]) => {
                    const def = ACHIEVEMENTS.find(a => a.id === id);
                    if (!def) return null;
                    return (
                      <div key={id} className="flex items-center gap-3">
                        <span className="text-base">{def.icon}</span>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs text-white/60">{def.title}</span>
                            <span className="text-xs text-white/30">{count} users</span>
                          </div>
                          <div className="h-1 bg-surface-border rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${(count / max) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {sorted.length === 0 && <p className="text-white/30 text-sm text-center py-4">No badges earned yet.</p>}
                </div>
              );
            })()}
          </div>

          {/* Recent transactions */}
          <div className="card p-4">
            <h3 className="font-display font-semibold text-white text-sm mb-3">Recent Transactions</h3>
            <div className="space-y-2">
              {[...transactions]
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .slice(0, 10)
                .map(tx => {
                  const u = users.find(u => u.id === tx.user_id);
                  return (
                    <div key={tx.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{u?.avatar_emoji ?? "🌱"}</span>
                        <span className="text-white/60 truncate max-w-28">{u?.display_name ?? "User"}</span>
                      </div>
                      <span className="text-emerald-400 font-medium">{formatCurrency(Number(tx.amount))}</span>
                      <span className="text-white/30 text-xs">{format(new Date(tx.created_at), "d MMM")}</span>
                    </div>
                  );
                })}
              {transactions.length === 0 && <p className="text-white/30 text-sm text-center py-4">No transactions yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KPICard({ icon, label, value, sub }: { icon: string; label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <div className="text-xl mb-1.5">{icon}</div>
      <div className="font-display font-bold text-white text-xl leading-tight">{value}</div>
      <div className="text-xs text-white/50 mt-0.5">{label}</div>
      <div className="text-[10px] text-white/30 mt-0.5">{sub}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-elevated rounded-xl p-2 text-center">
      <p className="font-display font-bold text-white text-sm">{value}</p>
      <p className="text-[10px] text-white/40">{label}</p>
    </div>
  );
}
