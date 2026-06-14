"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { getLevelFromXP, TIER_COLORS } from "@/lib/xp";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { format, subDays } from "date-fns";
import {
  Users, Target, Zap, TrendingUp, Plus, Edit2, Trash2,
  ToggleLeft, ToggleRight, ShieldCheck, Check, AlertTriangle,
  Calendar, CheckCircle, XCircle, BarChart2, Bell, ChevronRight,
} from "lucide-react";
import UserActivityDrawer from "@/components/admin/UserActivityDrawer";

// Simple toast component
function Toast({ message, type, onDone }: { message: string; type: "success" | "error"; onDone: () => void }) {
  return (
    <div
      className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-lg text-sm font-medium max-w-xs text-center ${
        type === "success" ? "bg-emerald-500 text-black" : "bg-red-500 text-white"
      }`}
      style={{ animation: "badgePop 0.3s ease forwards" }}
    >
      {type === "success" ? <CheckCircle size={16} /> : <XCircle size={16} />}
      <span>{message}</span>
    </div>
  );
}

interface Props {
  users: any[];
  goals: any[];
  transactions: any[];
  challenges: any[];
  userChallenges: any[];
  userAchievements: any[];
  activityLog: any[];
  adminName: string;
  dbEvents: any[];
  // Analytics data (Step 7)
  engagementStatuses: { status: string; count: number }[];
  dailyActivity: { date: string; user_id: string; deposit_count: number; xp_gained: number; quests_completed: number }[];
}

type Tab = "overview" | "users" | "seasonal" | "events" | "activity" | "analytics" | "notifications";

const BLANK_CHALLENGE = { title: "", description: "", type: "manual", xp_reward: 200, duration_days: 7, is_active: true };
const BLANK_EVENT = { slug: "", title: "", description: "", emoji: "⚡", event_type: "savequest", xp_reward: 300, available_from: "", available_until: "", is_annual: false, preview_days: 5, is_active: true };

export default function AdminClient({
  users, goals, transactions, challenges,
  userChallenges, userAchievements, activityLog, adminName, dbEvents,
  engagementStatuses, dailyActivity,
}: Props) {
  const router = useRouter();
  const [tab, setTab]           = useState<Tab>("overview");
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState<{ message: string; type: "success" | "error" } | null>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Seasonal (challenge) form state ──────────────────────────
  const [editingCh,  setEditingCh]  = useState<any | null>(null);
  const [newCh,      setNewCh]      = useState(false);
  const [chForm,     setChForm]     = useState({ ...BLANK_CHALLENGE });

  // ── Events form state ─────────────────────────────────────────
  const [editingEv,  setEditingEv]  = useState<any | null>(null);
  const [newEv,      setNewEv]      = useState(false);
  const [evForm,     setEvForm]     = useState({ ...BLANK_EVENT });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedUser, setSelectedUser]     = useState<typeof users[0] | null>(null);
  const [notifMetrics, setNotifMetrics]     = useState<any | null>(null);
  const [notifLoading, setNotifLoading]     = useState(false);

  // ── Platform stats ────────────────────────────────────────────
  const totalUsers     = users.length;
  const totalSaved     = transactions.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const totalGoals     = goals.length;
  const completedGoals = goals.filter(g => g.is_complete).length;
  const activeStreaks  = users.filter(u => (u.streak_days ?? 0) >= 3).length;
  const totalXP        = users.reduce((s, u) => s + (u.xp_total ?? 0), 0);
  const sevenDaysAgo   = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const recentlyActive = users.filter(u => u.last_active_date && u.last_active_date >= sevenDaysAgo).length;

  const activityByDate = new Map<string, number>();
  for (const a of activityLog) {
    activityByDate.set(a.activity_date, (activityByDate.get(a.activity_date) ?? 0) + (a.actions_count ?? 1));
  }

  // ── Seasonal CRUD ─────────────────────────────────────────────
  function startEditCh(ch: any) {
    setEditingCh(ch);
    setChForm({ title: ch.title, description: ch.description, type: ch.type, xp_reward: ch.xp_reward, duration_days: ch.duration_days, is_active: ch.is_active });
    setNewCh(false);
  }
  function startNewCh() {
    setEditingCh(null);
    setChForm({ ...BLANK_CHALLENGE });
    setNewCh(true);
  }
  async function saveCh() {
    setSaving(true);
    const supabase = createClient();
    if (newCh) await supabase.from("challenges").insert(chForm);
    else if (editingCh) await supabase.from("challenges").update(chForm).eq("id", editingCh.id);
    setSaving(false); setEditingCh(null); setNewCh(false); router.refresh();
  }
  async function toggleCh(id: string, current: boolean) {
    const supabase = createClient();
    await supabase.from("challenges").update({ is_active: !current }).eq("id", id);
    router.refresh();
  }

  // ── Events CRUD via server API (service role) ─────────────────
  function startEditEv(ev: any) {
    setEditingEv(ev);
    setEvForm({
      slug: ev.slug, title: ev.title, description: ev.description, emoji: ev.emoji,
      event_type: ev.event_type, xp_reward: ev.xp_reward,
      available_from: ev.available_from ?? "", available_until: ev.available_until ?? "",
      is_annual: ev.is_annual, preview_days: ev.preview_days, is_active: ev.is_active,
    });
    setNewEv(false);
  }
  function startNewEv() {
    setEditingEv(null);
    setEvForm({ ...BLANK_EVENT, slug: `evt_${Date.now()}` });
    setNewEv(true);
  }

  async function saveEv() {
    if (!evForm.title.trim() || !evForm.slug.trim()) {
      showToast("Title and slug are required.", "error"); return;
    }
    setSaving(true);
    const payload = {
      ...evForm,
      available_from:  evForm.available_from  || null,
      available_until: evForm.available_until || null,
    };

    try {
      const res = await fetch("/api/admin/events", {
        method: newEv ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newEv ? payload : { id: editingEv.id, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      showToast(newEv ? "Event created!" : "Event updated!", "success");
      setEditingEv(null); setNewEv(false);
      router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(ev: any) {
    try {
      const res = await fetch("/api/admin/events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ev.id, slug: ev.slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Delete failed", "error");
        setDeleteConfirm(null); return;
      }
      showToast("Event deleted.", "success");
      setDeleteConfirm(null); router.refresh();
    } catch {
      showToast("Network error — try again", "error");
      setDeleteConfirm(null);
    }
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview",  label: "Overview",  icon: <TrendingUp size={14} /> },
    { id: "users",     label: "Users",     icon: <Users size={14} /> },
    { id: "seasonal",  label: "Seasonal",  icon: <Zap size={14} /> },
    { id: "events",    label: "Events",    icon: <Calendar size={14} /> },
    { id: "activity",  label: "Activity",  icon: <Target size={14} /> },
    { id: "analytics", label: "Analytics", icon: <BarChart2 size={14} /> },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-8">
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <ShieldCheck size={16} className="text-brand-400" />
            <span className="text-brand-400 text-xs font-bold uppercase tracking-wider">Admin</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-white/40 text-sm">Welcome, {adminName} · {totalUsers} users</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface-elevated p-1 rounded-2xl overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-medium transition-all duration-200 whitespace-nowrap min-w-[60px] ${
              tab === t.id ? "bg-brand-500 text-black" : "text-white/40 hover:text-white/70"
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ─────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <KPICard icon="👥" label="Total Users"     value={String(totalUsers)}             sub={`${recentlyActive} active last 7d`} />
            <KPICard icon="💰" label="Platform Saved"  value={formatCurrency(totalSaved)}     sub={`${transactions.filter(t=>Number(t.amount)>0).length} deposits`} />
            <KPICard icon="🎯" label="Goals"           value={String(totalGoals)}             sub={`${completedGoals} completed`} />
            <KPICard icon="🔥" label="Active Streaks"  value={String(activeStreaks)}           sub="3+ day streaks" />
            <KPICard icon="⚡" label="XP Awarded"      value={totalXP.toLocaleString()}        sub="across all users" />
            <KPICard icon="⚔️" label="Seasonal Live"   value={String(challenges.filter(c => c.is_active).length)} sub={`of ${challenges.length} total`} />
          </div>

          {/* Top savers */}
          <div className="card p-4">
            <h3 className="font-display font-semibold text-white text-sm mb-3">Top Savers by XP</h3>
            <div className="space-y-2">
              {[...users].sort((a, b) => (b.xp_total ?? 0) - (a.xp_total ?? 0)).slice(0, 5).map((u, i) => {
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
              {users.length === 0 && <p className="text-white/30 text-sm text-center py-4">No users yet.</p>}
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
                  {sorted.length === 0 && <p className="text-white/30 text-sm text-center py-2">No goals yet.</p>}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── USERS ────────────────────────────────────── */}
      {tab === "users" && (
        <div className="space-y-3">
          <div className="card p-3 flex items-center gap-3 text-xs text-white/30 font-medium uppercase tracking-wider">
            <span className="w-8"></span>
            <span className="flex-1">User</span>
            <span className="w-16 text-right">Level</span>
            <span className="w-16 text-right">XP</span>
            <span className="w-12 text-right">Streak</span>
          </div>
          {users.length === 0 && (
            <div className="card p-8 text-center">
              <p className="text-white/30 text-sm">No users found. Check SUPABASE_SERVICE_ROLE_KEY env var.</p>
            </div>
          )}
          {users.map(u => {
            const lv = getLevelFromXP(u.xp_total ?? 0);
            return (
              <div key={u.id} className="card p-3 cursor-pointer hover:border-white/10 transition-colors active:opacity-80" onClick={() => setSelectedUser(u)}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl w-8">{u.avatar_emoji ?? "🌱"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-white truncate">{u.display_name}</p>
                      {u.is_admin && <span className="text-[10px] bg-brand-500/20 text-brand-400 border border-brand-500/30 rounded px-1">admin</span>}
                    </div>
                    <p className="text-xs text-white/30 truncate">{u.email || "—"}</p>
                    <p className="text-[10px] text-white/20 mt-0.5">
                      Joined {u.created_at ? format(new Date(u.created_at), "d MMM yyyy") : "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold" style={{ color: TIER_COLORS[lv.tier] }}>Lv {lv.level}</p>
                    <p className="text-[10px] text-white/40 mt-0.5">{(u.xp_total ?? 0).toLocaleString()} XP</p>
                  </div>
                  <div className="text-right w-12">
                    <p className="text-xs text-orange-400 font-bold">{u.streak_days ?? 0}🔥</p>
                    <p className="text-[10px] text-white/20">{u.last_active_date ? format(new Date(u.last_active_date), "d MMM") : "—"}</p>
                  </div>
                  <ChevronRight size={14} className="text-white/20 shrink-0" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SEASONAL (challenges) ────────────────────── */}
      {tab === "seasonal" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-white">Seasonal Quests</h2>
            <button onClick={startNewCh} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
              <Plus size={14} /> New Quest
            </button>
          </div>

          {/* Form */}
          {(newCh || editingCh) && (
            <div className="card p-4 border-brand-500/30">
              <h3 className="font-display font-semibold text-white text-sm mb-4">
                {newCh ? "Create Seasonal Quest" : "Edit Quest"}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-white/40 mb-1">Title</label>
                  <input className="input-field" value={chForm.title} onChange={e => setChForm(f => ({ ...f, title: e.target.value }))} placeholder="Quest title" />
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Description</label>
                  <input className="input-field" value={chForm.description} onChange={e => setChForm(f => ({ ...f, description: e.target.value }))} placeholder="What the user needs to do" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/40 mb-1">XP Reward</label>
                    <input type="number" className="input-field" value={chForm.xp_reward} onChange={e => setChForm(f => ({ ...f, xp_reward: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Duration (days)</label>
                    <input type="number" className="input-field" value={chForm.duration_days} onChange={e => setChForm(f => ({ ...f, duration_days: Number(e.target.value) }))} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Type</label>
                  <select className="input-field" value={chForm.type} onChange={e => setChForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="manual">Manual</option>
                    <option value="seasonal">Seasonal</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveCh} disabled={saving} className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2.5">
                    <Check size={14} /> {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => { setEditingCh(null); setNewCh(false); }} className="btn-ghost text-sm px-4 py-2.5">Cancel</button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {challenges.map(ch => {
              const completions = userChallenges.filter(uc => uc.challenge_id === ch.id && uc.status === "completed").length;
              const active      = userChallenges.filter(uc => uc.challenge_id === ch.id && uc.status === "active").length;
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
                      <button onClick={() => startEditCh(ch)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-white/70 transition-colors">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => toggleCh(ch.id, ch.is_active)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center transition-colors hover:border-brand-500/40">
                        {ch.is_active ? <ToggleRight size={16} className="text-brand-400" /> : <ToggleLeft size={16} className="text-white/30" />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {challenges.length === 0 && <p className="text-white/30 text-sm text-center py-8">No seasonal quests yet.</p>}
          </div>
        </div>
      )}

      {/* ── EVENTS ───────────────────────────────────── */}
      {tab === "events" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-white">Events</h2>
            <button onClick={startNewEv} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
              <Plus size={14} /> New Event
            </button>
          </div>

          {/* Event form */}
          {(newEv || editingEv) && (
            <div className="card p-4 border-brand-500/30">
              <h3 className="font-display font-semibold text-white text-sm mb-4">
                {newEv ? "Create Event" : "Edit Event"}
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1">
                    <label className="block text-xs text-white/40 mb-1">Emoji</label>
                    <input className="input-field text-center" value={evForm.emoji} onChange={e => setEvForm(f => ({ ...f, emoji: e.target.value }))} />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-xs text-white/40 mb-1">Title</label>
                    <input className="input-field" value={evForm.title} onChange={e => setEvForm(f => ({ ...f, title: e.target.value }))} placeholder="Event title" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Description</label>
                  <input className="input-field" value={evForm.description} onChange={e => setEvForm(f => ({ ...f, description: e.target.value }))} placeholder="What participants need to do" />
                </div>
                {newEv && (
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Slug (unique ID)</label>
                    <input className="input-field font-mono text-xs" value={evForm.slug} onChange={e => setEvForm(f => ({ ...f, slug: e.target.value }))} placeholder="evt_my_event" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/40 mb-1">XP Reward</label>
                    <input type="number" className="input-field" value={evForm.xp_reward} onChange={e => setEvForm(f => ({ ...f, xp_reward: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Type</label>
                    <select className="input-field" value={evForm.event_type} onChange={e => setEvForm(f => ({ ...f, event_type: e.target.value }))}>
                      <option value="savequest">SaveQuest Campaign</option>
                      <option value="seasonal">Seasonal</option>
                      <option value="calendar">Calendar</option>
                      <option value="evergreen">Evergreen</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Available From (optional)</label>
                    <input type="date" className="input-field" value={evForm.available_from} onChange={e => setEvForm(f => ({ ...f, available_from: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Available Until (optional)</label>
                    <input type="date" className="input-field" value={evForm.available_until} onChange={e => setEvForm(f => ({ ...f, available_until: e.target.value }))} />
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-2 text-white/60 cursor-pointer">
                    <input type="checkbox" checked={evForm.is_annual} onChange={e => setEvForm(f => ({ ...f, is_annual: e.target.checked }))} className="rounded" />
                    Annual (repeats yearly)
                  </label>
                  <label className="flex items-center gap-2 text-white/60 cursor-pointer">
                    <input type="checkbox" checked={evForm.is_active} onChange={e => setEvForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
                    Active
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEv} disabled={saving} className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2.5">
                    <Check size={14} /> {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => { setEditingEv(null); setNewEv(false); }} className="btn-ghost text-sm px-4 py-2.5">Cancel</button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {dbEvents.map(ev => {
              const regions: string[] = (ev.event_regions ?? []).map((r: any) => r.region);
              const isConfirming = deleteConfirm === ev.id;
              return (
                <div key={ev.id} className={`card p-4 ${!ev.is_active ? "opacity-50" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{ev.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="font-medium text-white text-sm">{ev.title}</p>
                        <span className="text-[10px] text-white/30 border border-surface-border rounded-full px-1.5 py-0.5">{ev.event_type}</span>
                        {!ev.is_active && <span className="text-[10px] text-orange-400 border border-orange-400/30 rounded-full px-1.5 py-0.5">inactive</span>}
                      </div>
                      <p className="text-xs text-white/40 mb-1">{ev.description}</p>
                      <div className="flex items-center gap-2 text-xs text-white/30 flex-wrap">
                        <span className="text-brand-400">⚡ {ev.xp_reward} XP</span>
                        {ev.available_from && <span>From {ev.available_from}</span>}
                        {ev.available_until && <span>Until {ev.available_until}</span>}
                        {!ev.available_from && !ev.available_until && <span>Evergreen</span>}
                        {regions.length > 0 && <span>🌍 {regions.join(", ")}</span>}
                      </div>

                      {isConfirming && (
                        <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                          <AlertTriangle size={13} className="text-red-400" />
                          <p className="text-xs text-red-400">Delete this event? This cannot be undone.</p>
                          <button onClick={() => deleteEvent(ev)} className="ml-auto text-xs text-red-400 font-bold hover:text-red-300">Confirm</button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-xs text-white/30 hover:text-white/60">Cancel</button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => startEditEv(ev)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-white/70 transition-colors">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => setDeleteConfirm(isConfirming ? null : ev.id)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-red-400 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {dbEvents.length === 0 && <p className="text-white/30 text-sm text-center py-8">No events in database yet. Create one above.</p>}
          </div>
        </div>
      )}

      {/* ── ACTIVITY ─────────────────────────────────── */}
      {tab === "activity" && (
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="font-display font-semibold text-white text-sm mb-3">Platform Activity — Last 30 Days</h3>
            <div className="grid grid-cols-10 gap-1 mb-2">
              {Array.from({ length: 30 }, (_, i) => {
                const d = subDays(new Date(), 29 - i);
                const dateStr = format(d, "yyyy-MM-dd");
                const count = activityByDate.get(dateStr) ?? 0;
                const intensity = count === 0 ? "bg-surface-border" : count < 3 ? "bg-brand-900/40" : count < 8 ? "bg-brand-700/60" : count < 15 ? "bg-brand-500/70" : "bg-brand-400";
                return <div key={i} title={`${dateStr}: ${count} actions`} className={`aspect-square rounded-md ${intensity}`} />;
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

          <div className="card p-4">
            <h3 className="font-display font-semibold text-white text-sm mb-3">Recent Transactions</h3>
            <div className="space-y-2">
              {[...transactions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 10).map(tx => {
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

      {/* ── ANALYTICS ────────────────────────────────── */}
      {tab === "analytics" && (() => {
        // ── Compute metrics from props ──────────────────────────────
        const totalUsers   = users.length;
        const deposits     = transactions.filter(t => Number(t.amount) > 0);
        const today        = new Date();

        // Engagement status counts
        const statusMap = Object.fromEntries(engagementStatuses.map(s => [s.status, s.count]));
        const activeUsers  = statusMap["active"]  ?? 0;
        const atRiskUsers  = statusMap["at_risk"]  ?? 0;
        const churnedUsers = statusMap["churned"]  ?? 0;

        // Fallback: compute from users array if engagement table not yet populated
        const sevenDaysAgo   = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
        const recentlyActive = users.filter(u => u.last_active_date && u.last_active_date >= sevenDaysAgo).length;
        const displayActive  = engagementStatuses.length > 0 ? activeUsers : recentlyActive;

        // Activation funnel
        const usersWithGoals    = new Set(goals.map(g => g.user_id)).size;
        const usersWithDeposits = new Set(deposits.map(t => t.user_id)).size;
        const usersWithAchieves = new Set(userAchievements.map(a => a.user_id)).size;
        const signupToGoalPct   = totalUsers > 0 ? ((usersWithGoals    / totalUsers)    * 100).toFixed(1) : "0";
        const goalToDepositPct  = usersWithGoals > 0 ? ((usersWithDeposits / usersWithGoals) * 100).toFixed(1) : "0";
        const depositToAchPct   = usersWithDeposits > 0 ? ((usersWithAchieves / usersWithDeposits) * 100).toFixed(1) : "0";

        // Retention — D1 / D7 / D30
        // For each cohort day, check what % came back on day N
        function retentionRate(cohortDays: number, returnDays: number): string {
          const cohortDate = new Date(Date.now() - cohortDays * 86400000).toISOString().split("T")[0];
          const returnDate = new Date(Date.now() - returnDays * 86400000).toISOString().split("T")[0];
          const cohortUsers = new Set(
            dailyActivity.filter(a => a.date === cohortDate).map(a => a.user_id)
          );
          if (cohortUsers.size === 0) return "—";
          const returned = dailyActivity.filter(a => a.date === returnDate && cohortUsers.has(a.user_id)).length;
          return ((returned / cohortUsers.size) * 100).toFixed(1) + "%";
        }
        const d1  = retentionRate(1,  0);
        const d7  = retentionRate(7,  0);
        const d30 = retentionRate(30, 0);

        // Engagement averages (last 28 days)
        const last28Days = Array.from({ length: 28 }, (_, i) =>
          new Date(Date.now() - (27 - i) * 86400000).toISOString().split("T")[0]
        );
        const recentActivity = dailyActivity.filter(a => last28Days.includes(a.date));
        const uniqueActiveWeekUsers = new Set(recentActivity.map(a => a.user_id)).size;
        const totalDepositsLast28   = recentActivity.reduce((s, a) => s + a.deposit_count, 0);
        const totalXPLast28         = recentActivity.reduce((s, a) => s + a.xp_gained, 0);
        const totalQuestsLast28     = recentActivity.reduce((s, a) => s + a.quests_completed, 0);
        const avgDepositsPerWeek    = uniqueActiveWeekUsers > 0
          ? ((totalDepositsLast28 / 4) / uniqueActiveWeekUsers).toFixed(1) : "0";
        const avgXPPerWeek          = uniqueActiveWeekUsers > 0
          ? Math.round((totalXPLast28 / 4) / uniqueActiveWeekUsers) : 0;
        const avgQuestsCompleted    = uniqueActiveWeekUsers > 0
          ? ((totalQuestsLast28 / 4) / uniqueActiveWeekUsers).toFixed(1) : "0";

        return (
          <div className="space-y-4">
            {/* Users */}
            <div>
              <h3 className="font-display font-semibold text-white text-sm mb-3 flex items-center gap-2">
                <Users size={14} className="text-brand-400" /> Users
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <AnalyticsCard label="Total Users"   value={String(totalUsers)}   color="text-white" />
                <AnalyticsCard label="Active"        value={String(displayActive)} color="text-emerald-400" sub="last 7 days" />
                <AnalyticsCard label="At Risk"       value={String(atRiskUsers)}  color="text-amber-400"   sub="4–7 days inactive" />
                <AnalyticsCard label="Churned"       value={String(churnedUsers)} color="text-red-400"     sub="8+ days inactive" />
              </div>
            </div>

            {/* Activation Funnel */}
            <div>
              <h3 className="font-display font-semibold text-white text-sm mb-3 flex items-center gap-2">
                <TrendingUp size={14} className="text-brand-400" /> Activation Funnel
              </h3>
              <div className="card p-4 space-y-3">
                <FunnelStep label="Signup → Goal Created"      pct={signupToGoalPct}  users={usersWithGoals}    total={totalUsers} />
                <FunnelStep label="Goal → First Deposit"       pct={goalToDepositPct} users={usersWithDeposits} total={usersWithGoals} />
                <FunnelStep label="Deposit → First Achievement" pct={depositToAchPct} users={usersWithAchieves} total={usersWithDeposits} />
              </div>
            </div>

            {/* Retention */}
            <div>
              <h3 className="font-display font-semibold text-white text-sm mb-3 flex items-center gap-2">
                <BarChart2 size={14} className="text-brand-400" /> Retention
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <AnalyticsCard label="D1 Retention"  value={d1}  color="text-brand-400" sub="day-1 return" />
                <AnalyticsCard label="D7 Retention"  value={d7}  color="text-brand-400" sub="day-7 return" />
                <AnalyticsCard label="D30 Retention" value={d30} color="text-brand-400" sub="day-30 return" />
              </div>
              <p className="text-[10px] text-white/25 mt-2 px-1">
                Retention = users from a cohort who were active on a later day. Requires analytics_daily_activity data to populate.
              </p>
            </div>

            {/* Engagement */}
            <div>
              <h3 className="font-display font-semibold text-white text-sm mb-3 flex items-center gap-2">
                <Zap size={14} className="text-brand-400" /> Engagement (last 28 days)
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <AnalyticsCard label="Avg Deposits / Week"  value={avgDepositsPerWeek}    color="text-emerald-400" sub="per active user" />
                <AnalyticsCard label="Avg XP / Week"        value={String(avgXPPerWeek)}   color="text-brand-400"   sub="per active user" />
                <AnalyticsCard label="Avg Quests / Week"    value={avgQuestsCompleted}     color="text-purple-400"  sub="per active user" />
              </div>
            </div>

            {/* Churn breakdown bar */}
            {totalUsers > 0 && (
              <div className="card p-4">
                <h3 className="font-display font-semibold text-white text-sm mb-3">User Health Distribution</h3>
                <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-2">
                  {displayActive > 0  && <div className="bg-emerald-500 transition-all" style={{ width: `${(displayActive / totalUsers) * 100}%` }} />}
                  {atRiskUsers > 0    && <div className="bg-amber-500  transition-all" style={{ width: `${(atRiskUsers  / totalUsers) * 100}%` }} />}
                  {churnedUsers > 0   && <div className="bg-red-500    transition-all" style={{ width: `${(churnedUsers / totalUsers) * 100}%` }} />}
                </div>
                <div className="flex items-center gap-4 text-xs text-white/40">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Active {displayActive}</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />At Risk {atRiskUsers}</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Churned {churnedUsers}</span>
                </div>
              </div>
            )}
          </div>
        );
      })()}
      {/* ── USER ACTIVITY DRAWER ──────────────────────── */}
      {selectedUser && (
        <UserActivityDrawer
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}

      {/* ── NOTIFICATIONS TAB ────────────────────────── */}
      {tab === "notifications" && (() => {
        async function loadMetrics() {
          setNotifLoading(true);
          try {
            const res = await fetch("/api/admin/notifications");
            if (res.ok) setNotifMetrics(await res.json());
          } finally {
            setNotifLoading(false);
          }
        }
        if (!notifMetrics && !notifLoading) loadMetrics();

        const m = notifMetrics?.metrics;
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-white">Push Notification Metrics</h2>
              <button onClick={() => { setNotifMetrics(null); }} className="text-xs text-white/40 hover:text-white/70">Refresh</button>
            </div>

            {notifLoading && <p className="text-white/40 text-sm text-center py-8">Loading metrics…</p>}

            {m && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="card p-4">
                    <div className="font-display font-bold text-white text-2xl">{notifMetrics.subscriberCount ?? 0}</div>
                    <div className="text-xs text-white/50 mt-0.5">Active subscribers</div>
                  </div>
                  <div className="card p-4">
                    <div className="font-display font-bold text-white text-2xl">{m.total_sent}</div>
                    <div className="text-xs text-white/50 mt-0.5">Total sent</div>
                  </div>
                  <div className="card p-4">
                    <div className="font-display font-bold text-emerald-400 text-2xl">{m.delivery_rate}%</div>
                    <div className="text-xs text-white/50 mt-0.5">Delivery rate</div>
                    <div className="text-[10px] text-white/30">{m.total_delivered} delivered</div>
                  </div>
                  <div className="card p-4">
                    <div className="font-display font-bold text-brand-400 text-2xl">{m.click_rate}%</div>
                    <div className="text-xs text-white/50 mt-0.5">Click-through rate</div>
                    <div className="text-[10px] text-white/30">{m.total_clicked} clicked</div>
                  </div>
                </div>

                <div>
                  <h3 className="font-display font-semibold text-white text-sm mb-3 flex items-center gap-2">
                    <Bell size={14} className="text-brand-400" /> By notification type
                  </h3>
                  <div className="card divide-y divide-surface-border">
                    {m.by_type.map((t: any) => (
                      <div key={t.type} className="p-3 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm text-white font-medium capitalize">{t.type.replace(/_/g, " ")}</p>
                          <p className="text-[10px] text-white/30">{t.sent} sent</p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs text-emerald-400">{t.sent > 0 ? ((t.delivered / t.sent) * 100).toFixed(0) : 0}% delivered</div>
                          <div className="text-xs text-brand-400">{t.delivered > 0 ? ((t.clicked / t.delivered) * 100).toFixed(0) : 0}% clicked</div>
                        </div>
                      </div>
                    ))}
                    {m.by_type.length === 0 && (
                      <p className="text-white/30 text-sm text-center py-8">No notifications sent yet.</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })()}

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

function AnalyticsCard({
  label, value, color, sub,
}: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className={`font-display font-bold text-2xl leading-tight ${color}`}>{value}</div>
      <div className="text-xs text-white/50 mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-white/25 mt-0.5">{sub}</div>}
    </div>
  );
}

function FunnelStep({
  label, pct, users, total,
}: { label: string; pct: string; users: number; total: number }) {
  const width = total > 0 ? (users / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-white/60">{label}</span>
        <span className="text-xs font-bold text-brand-400">{pct}%</span>
      </div>
      <div className="h-1.5 bg-surface-border rounded-full overflow-hidden">
        <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${width}%` }} />
      </div>
      <div className="text-[10px] text-white/25 mt-0.5">{users} of {total} users</div>
    </div>
  );
}
