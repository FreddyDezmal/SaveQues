"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { format, formatDistanceToNow } from "date-fns";
import { X, TrendingUp, Target, Zap, Trophy, Calendar, Coins, ChevronRight } from "lucide-react";

interface Props {
  user: {
    id: string;
    display_name: string;
    avatar_emoji: string;
    email: string;
    xp_total: number;
    streak_days: number;
    last_active_date: string | null;
    created_at: string;
  };
  onClose: () => void;
}

interface ActivityEvent {
  id: string;
  type: "deposit" | "quest" | "achievement" | "challenge" | "streak";
  label: string;
  sub?: string;
  icon: string;
  color: string;
  ts: string;
  amount?: number;
}

export default function UserActivityDrawer({ user, onClose }: Props) {
  const [events, setEvents]   = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats]     = useState({
    totalSaved: 0,
    goalsCount: 0,
    questsDone: 0,
    achievementCount: 0,
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      const [txRes, questRes, achRes, chalRes, goalRes] = await Promise.all([
        supabase.from("transactions")
          .select("id, amount, transaction_type, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.from("daily_quest_logs")
          .select("id, quest_id, quest_date, xp_earned, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase.from("user_achievements")
          .select("achievement_id, earned_at")
          .eq("user_id", user.id)
          .order("earned_at", { ascending: false }),
        supabase.from("user_challenges")
          .select("challenge_id, status, started_at, completed_at, challenges(title)")
          .eq("user_id", user.id)
          .order("started_at", { ascending: false }),
        supabase.from("savings_goals")
          .select("id, title, target_amount, current_amount, is_complete, created_at")
          .eq("user_id", user.id),
      ]);

      // Build unified timeline
      const allEvents: ActivityEvent[] = [];

      for (const tx of txRes.data ?? []) {
        const isDeposit = tx.transaction_type === "deposit" || Number(tx.amount) > 0;
        allEvents.push({
          id:     tx.id,
          type:   "deposit",
          label:  isDeposit ? "Logged a saving" : "Made a withdrawal",
          icon:   isDeposit ? "💰" : "📤",
          color:  isDeposit ? "text-emerald-400" : "text-red-400",
          ts:     tx.created_at,
          amount: Number(tx.amount),
        });
      }

      for (const q of questRes.data ?? []) {
        allEvents.push({
          id:    q.id,
          type:  "quest",
          label: "Completed daily quest",
          sub:   q.quest_id,
          icon:  "📋",
          color: "text-brand-400",
          ts:    q.created_at,
          amount: q.xp_earned,
        });
      }

      for (const a of achRes.data ?? []) {
        allEvents.push({
          id:    a.achievement_id,
          type:  "achievement",
          label: "Earned achievement",
          sub:   a.achievement_id.replace(/_/g, " "),
          icon:  "🏆",
          color: "text-amber-400",
          ts:    a.earned_at,
        });
      }

      for (const c of chalRes.data ?? []) {
        const ch = (c as any).challenges;
        if (c.status === "completed" && c.completed_at) {
          allEvents.push({
            id:    c.challenge_id + c.completed_at,
            type:  "challenge",
            label: "Completed challenge",
            sub:   ch?.title ?? c.challenge_id,
            icon:  "⚡",
            color: "text-purple-400",
            ts:    c.completed_at,
          });
        }
      }

      // Sort all events newest first
      allEvents.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      setEvents(allEvents.slice(0, 60));

      // Stats
      const deposits = (txRes.data ?? []).filter(t => Number(t.amount) > 0);
      setStats({
        totalSaved:       deposits.reduce((s, t) => s + Number(t.amount), 0),
        goalsCount:       goalRes.data?.length ?? 0,
        questsDone:       questRes.data?.length ?? 0,
        achievementCount: achRes.data?.length ?? 0,
      });

      setLoading(false);
    }
    load();
  }, [user.id]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-surface-base border-l border-surface-border z-50 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-surface-border shrink-0">
          <span className="text-3xl">{user.avatar_emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-white truncate">{user.display_name}</p>
            <p className="text-xs text-white/30 truncate">{user.email}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-surface-border transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-px bg-surface-border shrink-0">
          {[
            { label: "Saved",      value: `R${stats.totalSaved.toLocaleString()}`, icon: <Coins size={12} />,     color: "text-emerald-400" },
            { label: "Goals",      value: String(stats.goalsCount),                icon: <Target size={12} />,    color: "text-brand-400"   },
            { label: "Quests",     value: String(stats.questsDone),                icon: <Calendar size={12} />,  color: "text-purple-400"  },
            { label: "Badges",     value: String(stats.achievementCount),           icon: <Trophy size={12} />,    color: "text-amber-400"   },
          ].map(s => (
            <div key={s.label} className="bg-surface-base p-3 text-center">
              <div className={`flex items-center justify-center gap-1 ${s.color} mb-1`}>{s.icon}</div>
              <p className={`text-sm font-bold font-display ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-white/30">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Meta */}
        <div className="px-4 py-2.5 border-b border-surface-border shrink-0 flex items-center justify-between">
          <span className="text-xs text-white/30">
            Joined {format(new Date(user.created_at), "d MMM yyyy")}
          </span>
          <span className="text-xs text-white/30">
            {user.streak_days}🔥 streak
            {user.last_active_date && ` · active ${formatDistanceToNow(new Date(user.last_active_date))} ago`}
          </span>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && events.length === 0 && (
            <div className="text-center py-16">
              <p className="text-white/30 text-sm">No activity yet.</p>
            </div>
          )}

          {!loading && events.length > 0 && (
            <div className="p-4 space-y-0">
              <p className="text-xs text-white/30 font-medium uppercase tracking-wider mb-3">
                Activity timeline
              </p>

              {/* Group by date */}
              {(() => {
                const groups = new Map<string, ActivityEvent[]>();
                for (const e of events) {
                  const day = format(new Date(e.ts), "yyyy-MM-dd");
                  if (!groups.has(day)) groups.set(day, []);
                  groups.get(day)!.push(e);
                }

                return Array.from(groups.entries()).map(([day, dayEvents]) => (
                  <div key={day} className="mb-4">
                    <p className="text-[10px] text-white/20 uppercase tracking-wider mb-2 sticky top-0 bg-surface-base py-1">
                      {format(new Date(day), "EEEE, d MMM yyyy")}
                    </p>
                    <div className="space-y-1 border-l border-surface-border ml-1.5 pl-3">
                      {dayEvents.map(e => (
                        <div key={e.id} className="relative flex items-start gap-2.5 py-1.5">
                          {/* Timeline dot */}
                          <div className="absolute -left-[17px] top-2.5 w-2 h-2 rounded-full bg-surface-border ring-2 ring-surface-base" />

                          <span className="text-base leading-none mt-0.5">{e.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${e.color}`}>{e.label}</p>
                            {e.sub && (
                              <p className="text-xs text-white/30 truncate capitalize">{e.sub}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            {e.type === "deposit" && e.amount !== undefined && (
                              <p className={`text-xs font-bold ${e.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {e.amount >= 0 ? "+" : ""}R{Math.abs(e.amount).toLocaleString()}
                              </p>
                            )}
                            {e.type === "quest" && e.amount !== undefined && (
                              <p className="text-xs text-brand-400">+{e.amount} XP</p>
                            )}
                            <p className="text-[10px] text-white/20">
                              {format(new Date(e.ts), "HH:mm")}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
