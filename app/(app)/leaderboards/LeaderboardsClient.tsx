"use client";

/**
 * app/(app)/leaderboards/LeaderboardsClient.tsx
 *
 * Sprint 22. Consumes GET /api/leaderboards/* exactly as implemented.
 *
 * Deliberately does NOT include: a "Global" scope (052's own migration
 * documents this as an explicit privacy decision, not an oversight —
 * every leaderboard is friends- or group-scoped only), an "All Time"
 * period (leaderboard_xp only accepts 'week'|'month'), a "Savings"
 * dollar column (leaderboards never expose amounts — 052's file header),
 * or rank-movement arrows (nothing in this schema tracks a previous rank
 * to diff against). Building any of these would mean fabricating either
 * an API capability or data that doesn't exist.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import LeaderboardRow from "@/components/social/LeaderboardRow";
import LeaderboardTable from "@/components/social/LeaderboardTable";

type Scope = "friends" | "group";
type Metric = "xp" | "streak" | "goals" | "consistency" | "contributions";
type Period = "week" | "month";

interface Group { group_id: string; name: string; emoji: string; }
interface Entry { user_id: string; username: string | null; display_name: string | null; avatar_emoji: string | null; rank: number | null; [key: string]: any; }

const METRICS: { key: Metric; label: string; groupOnly?: boolean }[] = [
  { key: "xp", label: "XP" },
  { key: "streak", label: "Streak" },
  { key: "goals", label: "Goals" },
  { key: "consistency", label: "Consistency" },
  { key: "contributions", label: "Contributions", groupOnly: true },
];

export default function LeaderboardsClient() {
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [scope, setScope] = useState<Scope>("friends");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("xp");
  const [period, setPeriod] = useState<Period>("week");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));
    fetch("/api/groups/list").then((r) => r.json()).then((body) => {
      const groups = (body.groups ?? []).map((g: any) => ({ group_id: g.group_id, name: g.name, emoji: g.emoji }));
      setMyGroups(groups);
      if (groups.length > 0) setGroupId((prev) => prev ?? groups[0].group_id);
    });
  }, []);

  const load = useCallback(async () => {
    if (scope === "group" && !groupId) { setEntries([]); return; }
    setLoading(true);
    try {
      let url: string;
      const scopeParam = scope === "group" ? `scope=group&groupId=${groupId}` : "scope=friends";
      if (metric === "xp") url = `/api/leaderboards/xp?${scopeParam}&period=${period}`;
      else if (metric === "streak") url = `/api/leaderboards/streak?${scopeParam}`;
      else if (metric === "goals") url = `/api/leaderboards/goals-completed?${scopeParam}`;
      else if (metric === "consistency") url = `/api/leaderboards/consistency?${scopeParam}`;
      else url = `/api/leaderboards/group-contributions?groupId=${groupId}`;

      const res = await fetch(url);
      const body = await res.json();
      setEntries(body.entries ?? []);
    } finally {
      setLoading(false);
    }
  }, [scope, groupId, metric, period]);

  useEffect(() => { load(); }, [load]);

  function formatValue(e: Entry): string {
    switch (metric) {
      case "xp": return `${e.xp_in_period ?? 0} XP`;
      case "streak": return `${e.longest_streak ?? 0}d best`;
      case "goals": return `${e.goals_completed ?? 0} completed`;
      case "consistency": return e.consistency_score === null ? "Not enough data" : `${Math.round(e.consistency_score)}/100`;
      case "contributions": return `${e.contribution_count ?? 0} logged`;
    }
  }

  const availableMetrics = METRICS.filter((m) => !m.groupOnly || scope === "group");

  return (
    <div>
      <div className="flex gap-1 bg-surface-elevated rounded-xl p-1 mb-4" role="tablist" aria-label="Leaderboard scope">
        <button
          role="tab"
          aria-selected={scope === "friends"}
          onClick={() => setScope("friends")}
          className={`flex-1 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${scope === "friends" ? "bg-brand-500 text-black" : "text-white/60 hover:text-white"}`}
        >
          Friends
        </button>
        <button
          role="tab"
          aria-selected={scope === "group"}
          onClick={() => setScope("group")}
          disabled={myGroups.length === 0}
          className={`flex-1 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${scope === "group" ? "bg-brand-500 text-black" : "text-white/60 hover:text-white"}`}
        >
          Group
        </button>
      </div>

      {scope === "group" && myGroups.length > 0 && (
        <div className="mb-4">
          <label htmlFor="lb-group-select" className="sr-only">Choose a group</label>
          <select id="lb-group-select" value={groupId ?? ""} onChange={(e) => setGroupId(e.target.value)} className="input-field">
            {myGroups.map((g) => <option key={g.group_id} value={g.group_id}>{g.emoji} {g.name}</option>)}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1" role="tablist" aria-label="Leaderboard metric">
        {availableMetrics.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={metric === m.key}
            onClick={() => setMetric(m.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
              metric === m.key ? "bg-brand-500 text-black" : "bg-surface-elevated text-white/60 hover:text-white"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {metric === "xp" && (
        <div className="flex gap-1 mb-4" role="radiogroup" aria-label="Time period">
          {(["week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
                period === p ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              {p === "week" ? "This week" : "This month"}
            </button>
          ))}
        </div>
      )}

      <LeaderboardTable
        label={`${METRICS.find((m) => m.key === metric)?.label} leaderboard`}
        loading={loading}
        empty={entries.length === 0}
        emptyMessage={scope === "group" && myGroups.length === 0 ? "Join a group to see group leaderboards." : "No one to rank yet."}
      >
        {entries.map((e) => (
          <LeaderboardRow
            key={e.user_id}
            rank={e.rank ?? 0}
            avatarEmoji={e.avatar_emoji}
            displayName={e.display_name}
            username={e.username}
            value={formatValue(e)}
            isSelf={e.user_id === myUserId}
          />
        ))}
      </LeaderboardTable>

      {myGroups.length > 1 && <MyGroupsLeaderboard />}
    </div>
  );
}

/**
 * Ranks the caller's own groups against each other by XP
 * (leaderboard_my_groups, 052) — a distinct entity type (groups, not
 * people) from everything above, so it's its own small section rather
 * than forced into the member-ranking tab logic.
 */
function MyGroupsLeaderboard() {
  const [groups, setGroups] = useState<{ group_id: string; name: string; emoji: string; xp_total: number; rank: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leaderboards/groups").then((r) => r.json()).then((body) => {
      setGroups(body.entries ?? []);
      setLoading(false);
    });
  }, []);

  if (loading || groups.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-2">Your groups, ranked</h2>
      <LeaderboardTable label="My groups by XP" loading={false} empty={false} emptyMessage="">
        {groups.map((g) => (
          <div key={g.group_id} className="flex items-center gap-3 p-3 rounded-xl">
            <span className="w-6 text-center text-sm font-display font-semibold text-white/50 shrink-0" aria-hidden="true">{g.rank}</span>
            <div className="w-8 h-8 rounded-full bg-surface-elevated flex items-center justify-center text-base shrink-0" aria-hidden="true">{g.emoji}</div>
            <p className="flex-1 min-w-0 text-sm text-white truncate">{g.name}</p>
            <span className="text-sm font-medium text-white shrink-0">{g.xp_total} XP</span>
          </div>
        ))}
      </LeaderboardTable>
    </div>
  );
}
