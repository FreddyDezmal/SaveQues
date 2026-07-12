"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { getLevelFromXP, TIER_COLORS } from "@/lib/xp";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { format, subDays } from "date-fns";
import {
  Users, Target, Zap, TrendingUp, Plus, Edit2, Trash2,
  ToggleLeft, ToggleRight, ShieldCheck, Check, AlertTriangle,
  Calendar, CheckCircle, XCircle, BarChart2, Bell, ChevronRight,
  ListChecks, Link2, Award, X,
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
  // Task 3: Admin CRUD content tables
  dailyQuests: any[];
  weeklyQuests: any[];
  questChains: any[];
  badges: any[];
  dailyQuestUsage: Record<string, number>;
  chainUsage: Record<string, number>;
  badgeUsage: Record<string, number>;
}

type Tab = "overview" | "users" | "seasonal" | "events" | "quests" | "chains" | "badges" | "activity" | "analytics" | "notifications";

const BLANK_CHALLENGE = { title: "", description: "", type: "manual", xp_reward: 200, duration_days: 7, is_active: true, quest_type: "evergreen", start_date: "", end_date: "", preview_days: 3, year_agnostic: false };
const BLANK_EVENT = { slug: "", title: "", description: "", emoji: "⚡", event_type: "savequest", xp_reward: 300, available_from: "", available_until: "", is_annual: false, preview_days: 5, is_active: true };
const BLANK_DAILY_QUEST  = { id: "", title: "", description: "", category: "behavioral", xp_reward: 50, icon: "⭐", day_of_week: null as number | null, is_active: true };
const BLANK_WEEKLY_QUEST = { id: "", title: "", description: "", category: "behavioral", xp_reward: 300, icon: "⭐", is_active: true };
const BLANK_BADGE = { id: "", title: "", description: "", unlock_criteria: "", category: "special", icon: "🏅", xp_reward: 0, secret: false, visibility: "visible", is_active: true };
const BLANK_CHAIN = { id: "", title: "", description: "", icon: "🔗", completion_xp: 0, completion_badge_id: "", is_active: true, steps: [] as any[] };
const BLANK_STEP = { step_number: 1, title: "", description: "", xp_reward: 50, requires_type: "save_amount", requires_value: 1, requires_quest_id: "" };

export default function AdminClient({
  users, goals, transactions, challenges,
  userChallenges, userAchievements, activityLog, adminName, dbEvents,
  engagementStatuses, dailyActivity,
  dailyQuests, weeklyQuests, questChains, badges,
  dailyQuestUsage, chainUsage, badgeUsage,
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

  // ── Quests tab (daily / weekly sub-tabs) ───────────────────────
  const [questSubTab, setQuestSubTab] = useState<"daily" | "weekly">("daily");
  const [editingDQ, setEditingDQ] = useState<any | null>(null);
  const [newDQ,     setNewDQ]     = useState(false);
  const [dqForm,    setDqForm]    = useState({ ...BLANK_DAILY_QUEST });
  const [editingWQ, setEditingWQ] = useState<any | null>(null);
  const [newWQ,     setNewWQ]     = useState(false);
  const [wqForm,    setWqForm]    = useState({ ...BLANK_WEEKLY_QUEST });

  // ── Badges tab ──────────────────────────────────────────────────
  const [editingBadge, setEditingBadge] = useState<any | null>(null);
  const [newBadge,     setNewBadge]     = useState(false);
  const [badgeForm,    setBadgeForm]    = useState({ ...BLANK_BADGE });

  // ── Quest Chains tab ────────────────────────────────────────────
  const [editingChain, setEditingChain] = useState<any | null>(null);
  const [newChain,     setNewChain]     = useState(false);
  const [chainForm,    setChainForm]    = useState<typeof BLANK_CHAIN>({ ...BLANK_CHAIN, steps: [] });

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

  // ── Seasonal CRUD via server API (service role) ────────────────
  function startEditCh(ch: any) {
    setEditingCh(ch);
    setChForm({
      title: ch.title, description: ch.description, type: ch.type,
      xp_reward: ch.xp_reward, duration_days: ch.duration_days, is_active: ch.is_active,
      quest_type: ch.quest_type ?? "evergreen",
      start_date: ch.start_date ?? "", end_date: ch.end_date ?? "",
      preview_days: ch.preview_days ?? 3, year_agnostic: ch.year_agnostic ?? false,
    });
    setNewCh(false);
  }
  function startNewCh() {
    setEditingCh(null);
    setChForm({ ...BLANK_CHALLENGE });
    setNewCh(true);
  }
  async function saveCh() {
    if (!chForm.title.trim() || !chForm.description.trim()) {
      showToast("Title and description are required.", "error"); return;
    }
    setSaving(true);
    const payload = {
      ...chForm,
      start_date: chForm.start_date || null,
      end_date:   chForm.end_date   || null,
    };
    try {
      const res = await fetch("/api/admin/seasonal", {
        method: newCh ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCh ? payload : { id: editingCh.id, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      showToast(newCh ? "Seasonal quest created!" : "Seasonal quest updated!", "success");
      setEditingCh(null); setNewCh(false);
      router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }
  async function toggleCh(id: string, current: boolean) {
    // Optimistic UI: flip immediately, roll back on failure.
    try {
      const res = await fetch("/api/admin/seasonal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_active: !current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Something went wrong", "error");
    }
  }
  async function deleteChallenge(ch: any) {
    try {
      const res = await fetch("/api/admin/seasonal", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ch.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Delete failed", "error");
        setDeleteConfirm(null); return;
      }
      showToast("Seasonal quest deleted.", "success");
      setDeleteConfirm(null); router.refresh();
    } catch {
      showToast("Network error — try again", "error");
      setDeleteConfirm(null);
    }
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

  // ── Generic helper: CRUD against /api/admin/<endpoint> ──────────
  async function apiSave(endpoint: string, isNew: boolean, payload: any, idForUpdate?: string) {
    const res = await fetch(`/api/admin/${endpoint}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isNew ? payload : { id: idForUpdate, ...payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Save failed");
    return data;
  }
  async function apiDelete(endpoint: string, id: string) {
    const res = await fetch(`/api/admin/${endpoint}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Delete failed");
    return data;
  }
  async function apiToggle(endpoint: string, id: string, current: boolean) {
    try {
      await apiSave(endpoint, false, { is_active: !current }, id);
      router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Something went wrong", "error");
    }
  }

  // ── Daily Quest CRUD ──────────────────────────────────────────
  function startEditDQ(q: any) {
    setEditingDQ(q);
    setDqForm({ id: q.id, title: q.title, description: q.description, category: q.category, xp_reward: q.xp_reward, icon: q.icon, day_of_week: q.day_of_week, is_active: q.is_active });
    setNewDQ(false);
  }
  function startNewDQ() {
    setEditingDQ(null);
    setDqForm({ ...BLANK_DAILY_QUEST });
    setNewDQ(true);
  }
  async function saveDQ() {
    if (!dqForm.title.trim() || !dqForm.description.trim() || (newDQ && !dqForm.id.trim())) {
      showToast("ID, title, and description are required.", "error"); return;
    }
    setSaving(true);
    try {
      await apiSave("daily-quests", newDQ, dqForm, editingDQ?.id);
      showToast(newDQ ? "Daily quest created!" : "Daily quest updated!", "success");
      setEditingDQ(null); setNewDQ(false);
      router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }
  async function deleteDQ(q: any) {
    try {
      await apiDelete("daily-quests", q.id);
      showToast("Daily quest deleted.", "success");
      setDeleteConfirm(null); router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Delete failed", "error");
      setDeleteConfirm(null);
    }
  }

  // ── Weekly Quest CRUD ─────────────────────────────────────────
  function startEditWQ(q: any) {
    setEditingWQ(q);
    setWqForm({ id: q.id, title: q.title, description: q.description, category: q.category, xp_reward: q.xp_reward, icon: q.icon, is_active: q.is_active });
    setNewWQ(false);
  }
  function startNewWQ() {
    setEditingWQ(null);
    setWqForm({ ...BLANK_WEEKLY_QUEST });
    setNewWQ(true);
  }
  async function saveWQ() {
    if (!wqForm.title.trim() || !wqForm.description.trim() || (newWQ && !wqForm.id.trim())) {
      showToast("ID, title, and description are required.", "error"); return;
    }
    setSaving(true);
    try {
      await apiSave("weekly-quests", newWQ, wqForm, editingWQ?.id);
      showToast(newWQ ? "Weekly quest created!" : "Weekly quest updated!", "success");
      setEditingWQ(null); setNewWQ(false);
      router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }
  async function deleteWQ(q: any) {
    try {
      await apiDelete("weekly-quests", q.id);
      showToast("Weekly quest deleted.", "success");
      setDeleteConfirm(null); router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Delete failed", "error");
      setDeleteConfirm(null);
    }
  }

  // ── Badge CRUD ────────────────────────────────────────────────
  function startEditBadge(b: any) {
    setEditingBadge(b);
    setBadgeForm({
      id: b.id, title: b.title, description: b.description,
      unlock_criteria: b.unlock_criteria ?? b.description, category: b.category,
      icon: b.icon, xp_reward: b.xp_reward, secret: b.secret, visibility: b.visibility ?? "visible",
      is_active: b.is_active,
    });
    setNewBadge(false);
  }
  function startNewBadge() {
    setEditingBadge(null);
    setBadgeForm({ ...BLANK_BADGE });
    setNewBadge(true);
  }
  async function saveBadge() {
    if (!badgeForm.title.trim() || !badgeForm.description.trim() || (newBadge && !badgeForm.id.trim())) {
      showToast("ID, title, and description are required.", "error"); return;
    }
    setSaving(true);
    try {
      await apiSave("badges", newBadge, badgeForm, editingBadge?.id);
      showToast(newBadge ? "Badge created!" : "Badge updated!", "success");
      setEditingBadge(null); setNewBadge(false);
      router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }
  async function deleteBadge(b: any) {
    try {
      await apiDelete("badges", b.id);
      showToast("Badge deleted.", "success");
      setDeleteConfirm(null); router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Delete failed", "error");
      setDeleteConfirm(null);
    }
  }

  // ── Quest Chain CRUD ──────────────────────────────────────────
  function startEditChain(c: any) {
    setEditingChain(c);
    setChainForm({
      id: c.id, title: c.title, description: c.description, icon: c.icon,
      completion_xp: c.completion_xp, completion_badge_id: c.completion_badge_id ?? "",
      is_active: c.is_active,
      steps: (c.steps ?? []).map((s: any) => ({ ...s })).sort((a: any, b: any) => a.step_number - b.step_number),
    });
    setNewChain(false);
  }
  function startNewChain() {
    setEditingChain(null);
    setChainForm({ ...BLANK_CHAIN, steps: [{ ...BLANK_STEP, step_number: 1 }] });
    setNewChain(true);
  }
  function addStep() {
    setChainForm(f => ({ ...f, steps: [...f.steps, { ...BLANK_STEP, step_number: f.steps.length + 1 }] }));
  }
  function removeStep(index: number) {
    setChainForm(f => {
      const steps = f.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_number: i + 1 }));
      return { ...f, steps };
    });
  }
  function updateStep(index: number, patch: Partial<typeof BLANK_STEP>) {
    setChainForm(f => ({ ...f, steps: f.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }
  function moveStep(index: number, direction: -1 | 1) {
    setChainForm(f => {
      const target = index + direction;
      if (target < 0 || target >= f.steps.length) return f;
      const steps = [...f.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...f, steps: steps.map((s, i) => ({ ...s, step_number: i + 1 })) };
    });
  }
  async function saveChain() {
    if (!chainForm.title.trim() || !chainForm.description.trim() || (newChain && !chainForm.id.trim())) {
      showToast("ID, title, and description are required.", "error"); return;
    }
    if (chainForm.steps.length === 0) {
      showToast("Add at least one step.", "error"); return;
    }
    for (const step of chainForm.steps) {
      if (!step.title.trim() || !step.description.trim()) {
        showToast("Every step needs a title and description.", "error"); return;
      }
    }
    setSaving(true);
    const payload = {
      ...chainForm,
      completion_badge_id: chainForm.completion_badge_id || null,
      steps: chainForm.steps.map(s => ({ ...s, requires_quest_id: s.requires_quest_id || null })),
    };
    try {
      await apiSave("quest-chains", newChain, payload, editingChain?.id);
      showToast(newChain ? "Quest chain created!" : "Quest chain updated!", "success");
      setEditingChain(null); setNewChain(false);
      router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }
  async function deleteChain(c: any) {
    try {
      await apiDelete("quest-chains", c.id);
      showToast("Quest chain deleted.", "success");
      setDeleteConfirm(null); router.refresh();
    } catch (err: any) {
      showToast(err.message ?? "Delete failed", "error");
      setDeleteConfirm(null);
    }
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview",  label: "Overview",  icon: <TrendingUp size={14} /> },
    { id: "users",     label: "Users",     icon: <Users size={14} /> },
    { id: "quests",    label: "Quests",    icon: <ListChecks size={14} /> },
    { id: "chains",    label: "Chains",    icon: <Link2 size={14} /> },
    { id: "badges",    label: "Badges",    icon: <Award size={14} /> },
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
              const isConfirming = deleteConfirm === `ch_${ch.id}`;
              return (
                <div key={ch.id} className={`card p-4 ${!ch.is_active ? "opacity-50" : ""}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-medium text-white text-sm truncate">{ch.title}</p>
                        <span className="text-[10px] text-white/30 border border-surface-border rounded-full px-1.5 py-0.5">{ch.type}</span>
                        {!ch.is_active && <span className="text-[10px] text-orange-400 border border-orange-400/30 rounded-full px-1.5 py-0.5">inactive</span>}
                      </div>
                      <p className="text-xs text-white/40 mb-2">{ch.description}</p>
                      <div className="flex items-center gap-3 text-xs text-white/30">
                        <span className="text-brand-400">⚡ {ch.xp_reward} XP</span>
                        <span>⏱ {ch.duration_days}d</span>
                        <span>✅ {completions} completed</span>
                        <span>🔄 {active} active</span>
                      </div>

                      {isConfirming && (
                        <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                          <AlertTriangle size={13} className="text-red-400" />
                          <p className="text-xs text-red-400">Delete this seasonal quest? This cannot be undone.</p>
                          <button onClick={() => deleteChallenge(ch)} className="ml-auto text-xs text-red-400 font-bold hover:text-red-300">Confirm</button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-xs text-white/30 hover:text-white/60">Cancel</button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => startEditCh(ch)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-white/70 transition-colors">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => toggleCh(ch.id, ch.is_active)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center transition-colors hover:border-brand-500/40">
                        {ch.is_active ? <ToggleRight size={16} className="text-brand-400" /> : <ToggleLeft size={16} className="text-white/30" />}
                      </button>
                      <button onClick={() => setDeleteConfirm(isConfirming ? null : `ch_${ch.id}`)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-red-400 transition-colors">
                        <Trash2 size={13} />
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

      {/* ── QUESTS (Daily / Weekly) ────────────────────── */}
      {tab === "quests" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-white">Quests</h2>
            <button
              onClick={questSubTab === "daily" ? startNewDQ : startNewWQ}
              className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2"
            >
              <Plus size={14} /> New {questSubTab === "daily" ? "Daily" : "Weekly"} Quest
            </button>
          </div>

          {/* Sub-tab toggle */}
          <div className="flex gap-2 p-1 bg-surface-elevated rounded-xl border border-surface-border w-fit">
            <button
              onClick={() => setQuestSubTab("daily")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${questSubTab === "daily" ? "bg-brand-500 text-black" : "text-white/50 hover:text-white"}`}
            >
              Daily ({dailyQuests.length})
            </button>
            <button
              onClick={() => setQuestSubTab("weekly")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${questSubTab === "weekly" ? "bg-brand-500 text-black" : "text-white/50 hover:text-white"}`}
            >
              Weekly ({weeklyQuests.length})
            </button>
          </div>

          {/* ── Daily Quest form ── */}
          {questSubTab === "daily" && (newDQ || editingDQ) && (
            <div className="card p-4 border-brand-500/30">
              <h3 className="font-display font-semibold text-white text-sm mb-4">
                {newDQ ? "Create Daily Quest" : "Edit Daily Quest"}
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1">
                    <label className="block text-xs text-white/40 mb-1">Icon</label>
                    <input className="input-field text-center" value={dqForm.icon} onChange={e => setDqForm(f => ({ ...f, icon: e.target.value }))} />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-xs text-white/40 mb-1">Title</label>
                    <input className="input-field" value={dqForm.title} onChange={e => setDqForm(f => ({ ...f, title: e.target.value }))} placeholder="Quest title" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Description</label>
                  <input className="input-field" value={dqForm.description} onChange={e => setDqForm(f => ({ ...f, description: e.target.value }))} placeholder="What the user needs to do" />
                </div>
                {newDQ && (
                  <div>
                    <label className="block text-xs text-white/40 mb-1">ID (unique, lowercase, underscores)</label>
                    <input className="input-field font-mono text-xs" value={dqForm.id} onChange={e => setDqForm(f => ({ ...f, id: e.target.value }))} placeholder="daily_my_quest" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/40 mb-1">XP Reward</label>
                    <input type="number" className="input-field" value={dqForm.xp_reward} onChange={e => setDqForm(f => ({ ...f, xp_reward: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Category</label>
                    <select className="input-field" value={dqForm.category} onChange={e => setDqForm(f => ({ ...f, category: e.target.value }))}>
                      <option value="savings">Savings</option>
                      <option value="behavioral">Behavioral</option>
                      <option value="streak">Streak</option>
                      <option value="challenge">Challenge</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-white/60 cursor-pointer text-sm">
                  <input type="checkbox" checked={dqForm.is_active} onChange={e => setDqForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
                  Active
                </label>
                <div className="flex gap-2">
                  <button onClick={saveDQ} disabled={saving} className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2.5">
                    <Check size={14} /> {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => { setEditingDQ(null); setNewDQ(false); }} className="btn-ghost text-sm px-4 py-2.5">Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Weekly Quest form ── */}
          {questSubTab === "weekly" && (newWQ || editingWQ) && (
            <div className="card p-4 border-brand-500/30">
              <h3 className="font-display font-semibold text-white text-sm mb-4">
                {newWQ ? "Create Weekly Quest" : "Edit Weekly Quest"}
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1">
                    <label className="block text-xs text-white/40 mb-1">Icon</label>
                    <input className="input-field text-center" value={wqForm.icon} onChange={e => setWqForm(f => ({ ...f, icon: e.target.value }))} />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-xs text-white/40 mb-1">Title</label>
                    <input className="input-field" value={wqForm.title} onChange={e => setWqForm(f => ({ ...f, title: e.target.value }))} placeholder="Quest title" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Description</label>
                  <input className="input-field" value={wqForm.description} onChange={e => setWqForm(f => ({ ...f, description: e.target.value }))} placeholder="What the user needs to do" />
                </div>
                {newWQ && (
                  <div>
                    <label className="block text-xs text-white/40 mb-1">ID (unique, lowercase, underscores)</label>
                    <input className="input-field font-mono text-xs" value={wqForm.id} onChange={e => setWqForm(f => ({ ...f, id: e.target.value }))} placeholder="weekly_my_quest" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/40 mb-1">XP Reward</label>
                    <input type="number" className="input-field" value={wqForm.xp_reward} onChange={e => setWqForm(f => ({ ...f, xp_reward: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Category</label>
                    <select className="input-field" value={wqForm.category} onChange={e => setWqForm(f => ({ ...f, category: e.target.value }))}>
                      <option value="savings">Savings</option>
                      <option value="behavioral">Behavioral</option>
                      <option value="streak">Streak</option>
                      <option value="challenge">Challenge</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-white/60 cursor-pointer text-sm">
                  <input type="checkbox" checked={wqForm.is_active} onChange={e => setWqForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
                  Active
                </label>
                <div className="flex gap-2">
                  <button onClick={saveWQ} disabled={saving} className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2.5">
                    <Check size={14} /> {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => { setEditingWQ(null); setNewWQ(false); }} className="btn-ghost text-sm px-4 py-2.5">Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Daily quest list ── */}
          {questSubTab === "daily" && (
            <div className="space-y-2">
              {dailyQuests.map(q => {
                const usage = dailyQuestUsage[q.id] ?? 0;
                const isConfirming = deleteConfirm === `dq_${q.id}`;
                return (
                  <div key={q.id} className={`card p-4 ${!q.is_active ? "opacity-50" : ""}`}>
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{q.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <p className="font-medium text-white text-sm">{q.title}</p>
                          <span className="text-[10px] text-white/30 border border-surface-border rounded-full px-1.5 py-0.5">{q.category}</span>
                          {!q.is_active && <span className="text-[10px] text-orange-400 border border-orange-400/30 rounded-full px-1.5 py-0.5">disabled</span>}
                        </div>
                        <p className="text-xs text-white/40 mb-1">{q.description}</p>
                        <div className="flex items-center gap-3 text-xs text-white/30">
                          <span className="text-brand-400">⚡ {q.xp_reward} XP</span>
                          <span className="font-mono">{q.id}</span>
                          {usage > 0 && <span>📊 {usage} completion(s)</span>}
                        </div>

                        {isConfirming && (
                          <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                            <AlertTriangle size={13} className="text-red-400" />
                            <p className="text-xs text-red-400">Delete this quest? This cannot be undone.</p>
                            <button onClick={() => deleteDQ(q)} className="ml-auto text-xs text-red-400 font-bold hover:text-red-300">Confirm</button>
                            <button onClick={() => setDeleteConfirm(null)} className="text-xs text-white/30 hover:text-white/60">Cancel</button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => startEditDQ(q)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-white/70 transition-colors">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => apiToggle("daily-quests", q.id, q.is_active)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center transition-colors hover:border-brand-500/40">
                          {q.is_active ? <ToggleRight size={16} className="text-brand-400" /> : <ToggleLeft size={16} className="text-white/30" />}
                        </button>
                        <button
                          onClick={() => usage > 0 ? showToast(`Cannot delete — ${usage} user(s) have completion logs. Disable it instead.`, "error") : setDeleteConfirm(isConfirming ? null : `dq_${q.id}`)}
                          className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {dailyQuests.length === 0 && <p className="text-white/30 text-sm text-center py-8">No daily quests in database yet.</p>}
            </div>
          )}

          {/* ── Weekly quest list ── */}
          {questSubTab === "weekly" && (
            <div className="space-y-2">
              {weeklyQuests.map(q => {
                const isConfirming = deleteConfirm === `wq_${q.id}`;
                return (
                  <div key={q.id} className={`card p-4 ${!q.is_active ? "opacity-50" : ""}`}>
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{q.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <p className="font-medium text-white text-sm">{q.title}</p>
                          <span className="text-[10px] text-white/30 border border-surface-border rounded-full px-1.5 py-0.5">{q.category}</span>
                          {!q.is_active && <span className="text-[10px] text-orange-400 border border-orange-400/30 rounded-full px-1.5 py-0.5">disabled</span>}
                        </div>
                        <p className="text-xs text-white/40 mb-1">{q.description}</p>
                        <div className="flex items-center gap-3 text-xs text-white/30">
                          <span className="text-brand-400">⚡ {q.xp_reward} XP</span>
                          <span className="font-mono">{q.id}</span>
                        </div>

                        {isConfirming && (
                          <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                            <AlertTriangle size={13} className="text-red-400" />
                            <p className="text-xs text-red-400">Delete this quest? This cannot be undone.</p>
                            <button onClick={() => deleteWQ(q)} className="ml-auto text-xs text-red-400 font-bold hover:text-red-300">Confirm</button>
                            <button onClick={() => setDeleteConfirm(null)} className="text-xs text-white/30 hover:text-white/60">Cancel</button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => startEditWQ(q)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-white/70 transition-colors">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => apiToggle("weekly-quests", q.id, q.is_active)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center transition-colors hover:border-brand-500/40">
                          {q.is_active ? <ToggleRight size={16} className="text-brand-400" /> : <ToggleLeft size={16} className="text-white/30" />}
                        </button>
                        <button onClick={() => setDeleteConfirm(isConfirming ? null : `wq_${q.id}`)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-red-400 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {weeklyQuests.length === 0 && <p className="text-white/30 text-sm text-center py-8">No weekly quests in database yet.</p>}
            </div>
          )}
        </div>
      )}

      {/* ── BADGES ───────────────────────────────────── */}
      {tab === "badges" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-white">Badges</h2>
            <button onClick={startNewBadge} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
              <Plus size={14} /> New Badge
            </button>
          </div>

          {/* AUDIT NOTE (docs/ADMIN_CRUD_AUDIT.md): this tab manages the `badges`
              catalog table, which is display/reference only. The actual unlock
              logic that awards badges to users runs entirely from the hardcoded
              ACHIEVEMENTS array in lib/achievements.ts and is never read from
              this table. Creating a badge here does NOT make it earnable, and
              editing unlock_criteria here has no effect on anything. */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <strong className="font-semibold">Heads up:</strong> badges created or edited here are catalog/display
            entries only. The actual unlock logic lives in code (<code className="text-amber-100">lib/achievements.ts</code>)
            and does not read from this table — a new badge added here will not be earnable by users until a
            developer also adds matching logic in code. See the admin CRUD audit for details.
          </div>

          {/* Badge form */}
          {(newBadge || editingBadge) && (
            <div className="card p-4 border-brand-500/30">
              <h3 className="font-display font-semibold text-white text-sm mb-4">
                {newBadge ? "Create Badge" : "Edit Badge"}
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1">
                    <label className="block text-xs text-white/40 mb-1">Icon</label>
                    <input className="input-field text-center" value={badgeForm.icon} onChange={e => setBadgeForm(f => ({ ...f, icon: e.target.value }))} />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-xs text-white/40 mb-1">Title</label>
                    <input className="input-field" value={badgeForm.title} onChange={e => setBadgeForm(f => ({ ...f, title: e.target.value }))} placeholder="Badge title" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Description</label>
                  <input className="input-field" value={badgeForm.description} onChange={e => setBadgeForm(f => ({ ...f, description: e.target.value }))} placeholder="Flavor text shown on the badge" />
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Unlock Criteria</label>
                  <input className="input-field" value={badgeForm.unlock_criteria} onChange={e => setBadgeForm(f => ({ ...f, unlock_criteria: e.target.value }))} placeholder="What the user must do to earn this" />
                </div>
                {newBadge && (
                  <div>
                    <label className="block text-xs text-white/40 mb-1">ID (unique, lowercase, underscores)</label>
                    <input className="input-field font-mono text-xs" value={badgeForm.id} onChange={e => setBadgeForm(f => ({ ...f, id: e.target.value }))} placeholder="my_new_badge" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/40 mb-1">XP Reward</label>
                    <input type="number" className="input-field" value={badgeForm.xp_reward} onChange={e => setBadgeForm(f => ({ ...f, xp_reward: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Category</label>
                    <select className="input-field" value={badgeForm.category} onChange={e => setBadgeForm(f => ({ ...f, category: e.target.value }))}>
                      <option value="streak">Streak</option>
                      <option value="savings">Savings</option>
                      <option value="quest">Quest</option>
                      <option value="social">Social</option>
                      <option value="special">Special</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Visibility</label>
                  <select className="input-field" value={badgeForm.visibility} onChange={e => setBadgeForm(f => ({ ...f, visibility: e.target.value }))}>
                    <option value="visible">Visible — shown to all users (locked or earned)</option>
                    <option value="hidden">Hidden — only revealed once earned</option>
                  </select>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-2 text-white/60 cursor-pointer">
                    <input type="checkbox" checked={badgeForm.secret} onChange={e => setBadgeForm(f => ({ ...f, secret: e.target.checked }))} className="rounded" />
                    Secret badge
                  </label>
                  <label className="flex items-center gap-2 text-white/60 cursor-pointer">
                    <input type="checkbox" checked={badgeForm.is_active} onChange={e => setBadgeForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
                    Active
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveBadge} disabled={saving} className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2.5">
                    <Check size={14} /> {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => { setEditingBadge(null); setNewBadge(false); }} className="btn-ghost text-sm px-4 py-2.5">Cancel</button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {badges.map(b => {
              const usage = badgeUsage[b.id] ?? 0;
              const isConfirming = deleteConfirm === `badge_${b.id}`;
              return (
                <div key={b.id} className={`card p-4 ${!b.is_active ? "opacity-50" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{b.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="font-medium text-white text-sm">{b.title}</p>
                        <span className="text-[10px] text-white/30 border border-surface-border rounded-full px-1.5 py-0.5">{b.category}</span>
                        {b.secret && <span className="text-[10px] text-purple-400 border border-purple-400/30 rounded-full px-1.5 py-0.5">secret</span>}
                        {!b.is_active && <span className="text-[10px] text-orange-400 border border-orange-400/30 rounded-full px-1.5 py-0.5">disabled</span>}
                      </div>
                      <p className="text-xs text-white/40 mb-1">{b.description}</p>
                      <div className="flex items-center gap-3 text-xs text-white/30">
                        <span className="text-brand-400">⚡ {b.xp_reward} XP</span>
                        <span className="font-mono">{b.id}</span>
                        {usage > 0 && <span>🏅 {usage} earned</span>}
                      </div>

                      {isConfirming && (
                        <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                          <AlertTriangle size={13} className="text-red-400" />
                          <p className="text-xs text-red-400">Delete this badge? This cannot be undone.</p>
                          <button onClick={() => deleteBadge(b)} className="ml-auto text-xs text-red-400 font-bold hover:text-red-300">Confirm</button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-xs text-white/30 hover:text-white/60">Cancel</button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => startEditBadge(b)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-white/70 transition-colors">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => apiToggle("badges", b.id, b.is_active)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center transition-colors hover:border-brand-500/40">
                        {b.is_active ? <ToggleRight size={16} className="text-brand-400" /> : <ToggleLeft size={16} className="text-white/30" />}
                      </button>
                      <button
                        onClick={() => usage > 0 ? showToast(`Cannot delete — ${usage} user(s) have earned this badge. Disable it instead.`, "error") : setDeleteConfirm(isConfirming ? null : `badge_${b.id}`)}
                        className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {badges.length === 0 && <p className="text-white/30 text-sm text-center py-8">No badges in database yet.</p>}
          </div>
        </div>
      )}

      {/* ── QUEST CHAINS ─────────────────────────────── */}
      {tab === "chains" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-white">Quest Chains</h2>
            <button onClick={startNewChain} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
              <Plus size={14} /> New Chain
            </button>
          </div>

          {/* AUDIT NOTE (docs/ADMIN_CRUD_AUDIT.md): the live chain-progression
              flow (app/api/quest/chain/step/route.ts) reads chain/step
              definitions from the hardcoded QUEST_CHAINS constant in
              lib/quests.ts, not from these DB tables. Chains created or edited
              here are catalog/display entries only, until a developer also
              adds/updates the matching entry in code. */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <strong className="font-semibold">Heads up:</strong> chains created or edited here are catalog/display
            entries only. Live chain progression reads from a hardcoded list in
            code (<code className="text-amber-100">lib/quests.ts</code>), not from this table — a new chain added here
            will not be playable until a developer also adds it in code. See the admin CRUD audit for details.
          </div>

          {/* Chain form */}
          {(newChain || editingChain) && (
            <div className="card p-4 border-brand-500/30">
              <h3 className="font-display font-semibold text-white text-sm mb-4">
                {newChain ? "Create Quest Chain" : "Edit Quest Chain"}
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1">
                    <label className="block text-xs text-white/40 mb-1">Icon</label>
                    <input className="input-field text-center" value={chainForm.icon} onChange={e => setChainForm(f => ({ ...f, icon: e.target.value }))} />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-xs text-white/40 mb-1">Title</label>
                    <input className="input-field" value={chainForm.title} onChange={e => setChainForm(f => ({ ...f, title: e.target.value }))} placeholder="Chain title" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Description</label>
                  <input className="input-field" value={chainForm.description} onChange={e => setChainForm(f => ({ ...f, description: e.target.value }))} placeholder="What this chain is about" />
                </div>
                {newChain && (
                  <div>
                    <label className="block text-xs text-white/40 mb-1">ID (unique, lowercase, underscores)</label>
                    <input className="input-field font-mono text-xs" value={chainForm.id} onChange={e => setChainForm(f => ({ ...f, id: e.target.value }))} placeholder="chain_my_chain" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Completion Bonus XP</label>
                    <input type="number" className="input-field" value={chainForm.completion_xp} onChange={e => setChainForm(f => ({ ...f, completion_xp: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Completion Badge (optional)</label>
                    <select className="input-field" value={chainForm.completion_badge_id} onChange={e => setChainForm(f => ({ ...f, completion_badge_id: e.target.value }))}>
                      <option value="">None</option>
                      {badges.map(b => <option key={b.id} value={b.id}>{b.icon} {b.title}</option>)}
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-white/60 cursor-pointer text-sm">
                  <input type="checkbox" checked={chainForm.is_active} onChange={e => setChainForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
                  Active
                </label>

                {/* Steps editor */}
                <div className="pt-2 border-t border-surface-border">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-white/40 uppercase tracking-wider">Steps ({chainForm.steps.length})</p>
                    <button onClick={addStep} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                      <Plus size={12} /> Add Step
                    </button>
                  </div>
                  <div className="space-y-2">
                    {chainForm.steps.map((step, i) => (
                      <div key={i} className="p-3 rounded-xl bg-surface-elevated border border-surface-border space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white/30 font-mono w-6">#{step.step_number}</span>
                          <input className="input-field flex-1" value={step.title} onChange={e => updateStep(i, { title: e.target.value })} placeholder="Step title" />
                          <div className="flex flex-col gap-0.5">
                            <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="text-white/30 hover:text-white disabled:opacity-20 px-1">▲</button>
                            <button onClick={() => moveStep(i, 1)} disabled={i === chainForm.steps.length - 1} className="text-white/30 hover:text-white disabled:opacity-20 px-1">▼</button>
                          </div>
                          <button onClick={() => removeStep(i)} className="text-white/30 hover:text-red-400 px-1">
                            <X size={14} />
                          </button>
                        </div>
                        <input className="input-field" value={step.description} onChange={e => updateStep(i, { description: e.target.value })} placeholder="Step description" />
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] text-white/30 mb-1">XP Reward</label>
                            <input type="number" className="input-field text-xs" value={step.xp_reward} onChange={e => updateStep(i, { xp_reward: Number(e.target.value) })} />
                          </div>
                          <div>
                            <label className="block text-[10px] text-white/30 mb-1">Requires</label>
                            <select className="input-field text-xs" value={step.requires_type} onChange={e => updateStep(i, { requires_type: e.target.value })}>
                              <option value="save_amount">Save Amount</option>
                              <option value="streak">Streak Days</option>
                              <option value="complete_quest">Complete Quest</option>
                              <option value="complete_daily">Complete Daily</option>
                              <option value="open_app">Open App</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] text-white/30 mb-1">Value</label>
                            <input type="number" className="input-field text-xs" value={step.requires_value} onChange={e => updateStep(i, { requires_value: Number(e.target.value) })} />
                          </div>
                        </div>
                        {step.requires_type === "complete_quest" && (
                          <div>
                            <label className="block text-[10px] text-white/30 mb-1">Required Quest ID (optional)</label>
                            <input className="input-field text-xs font-mono" value={step.requires_quest_id ?? ""} onChange={e => updateStep(i, { requires_quest_id: e.target.value })} placeholder="e.g. daily_skip_purchase" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={saveChain} disabled={saving} className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2.5">
                    <Check size={14} /> {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => { setEditingChain(null); setNewChain(false); }} className="btn-ghost text-sm px-4 py-2.5">Cancel</button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {questChains.map(c => {
              const usage = chainUsage[c.id] ?? 0;
              const isConfirming = deleteConfirm === `chain_${c.id}`;
              return (
                <div key={c.id} className={`card p-4 ${!c.is_active ? "opacity-50" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{c.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="font-medium text-white text-sm">{c.title}</p>
                        <span className="text-[10px] text-white/30 border border-surface-border rounded-full px-1.5 py-0.5">{(c.steps ?? []).length} steps</span>
                        {!c.is_active && <span className="text-[10px] text-orange-400 border border-orange-400/30 rounded-full px-1.5 py-0.5">disabled</span>}
                      </div>
                      <p className="text-xs text-white/40 mb-1">{c.description}</p>
                      <div className="flex items-center gap-3 text-xs text-white/30">
                        <span className="text-brand-400">⚡ +{c.completion_xp} XP on completion</span>
                        <span className="font-mono">{c.id}</span>
                        {usage > 0 && <span>🔄 {usage} in progress/completed</span>}
                      </div>

                      {isConfirming && (
                        <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                          <AlertTriangle size={13} className="text-red-400" />
                          <p className="text-xs text-red-400">Delete this chain and all its steps? This cannot be undone.</p>
                          <button onClick={() => deleteChain(c)} className="ml-auto text-xs text-red-400 font-bold hover:text-red-300">Confirm</button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-xs text-white/30 hover:text-white/60">Cancel</button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => startEditChain(c)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-white/70 transition-colors">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => apiToggle("quest-chains", c.id, c.is_active)} className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center transition-colors hover:border-brand-500/40">
                        {c.is_active ? <ToggleRight size={16} className="text-brand-400" /> : <ToggleLeft size={16} className="text-white/30" />}
                      </button>
                      <button
                        onClick={() => usage > 0 ? showToast(`Cannot delete — ${usage} user(s) have progress on this chain. Disable it instead.`, "error") : setDeleteConfirm(isConfirming ? null : `chain_${c.id}`)}
                        className="w-8 h-8 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center text-white/40 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {questChains.length === 0 && <p className="text-white/30 text-sm text-center py-8">No quest chains in database yet.</p>}
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
        const depositUserIds    = new Set(deposits.map(t => t.user_id));
        const usersWithDeposits = depositUserIds.size;
        // "Deposit → First Achievement" must be users who have BOTH a deposit
        // AND an achievement — not all users with achievements. Without this
        // intersection, users who earned achievements via quests alone (no deposit)
        // inflate the numerator against the smaller deposit denominator.
        const usersWithAchieves = new Set(
          userAchievements.filter(a => depositUserIds.has(a.user_id)).map(a => a.user_id)
        ).size;
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