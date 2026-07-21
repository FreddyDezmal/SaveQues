"use client";

/**
 * app/(app)/quests/groups/GroupQuestsClient.tsx
 *
 * Sprint 22, Phase 18. There is no single "all my group quests across
 * every group" backend endpoint — GET /api/group-quests/list requires a
 * groupId (RLS-scoped per group, 045/050) and GET /api/groups/list
 * returns the group set but not their quests. This page composes the
 * two client-side (one groups/list call, then one group-quests/list
 * call per active group, in parallel) rather than requesting a new
 * aggregate RPC, per this phase's "frontend only" scope. Reuses
 * GroupQuestCard exactly as GroupDetailClient does — no duplicated quest
 * card JSX.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { GroupSummary } from "@/components/social/GroupCard";
import GroupQuestCard, { type GroupQuest } from "@/components/social/GroupQuestCard";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";

interface GroupWithQuests {
  group: GroupSummary;
  quests: GroupQuest[];
}

export default function GroupQuestsClient() {
  const [data, setData] = useState<GroupWithQuests[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    setLoading(true);
    try {
      const groupsRes = await fetch("/api/groups/list");
      if (!groupsRes.ok) throw new Error();
      const groupsBody: { groups: GroupSummary[] } = await groupsRes.json();
      const groups = groupsBody.groups ?? [];

      const withQuests = await Promise.all(
        groups.map(async (group) => {
          const res = await fetch(`/api/group-quests/list?groupId=${group.group_id}`);
          const body = res.ok ? await res.json() : { quests: [] };
          return { group, quests: (body.quests ?? []) as GroupQuest[] };
        })
      );

      setData(withQuests);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
  }
  if (error || data === null) return <ErrorState type="server" onRetry={load} />;

  if (data.length === 0) {
    return (
      <EmptyState
        emoji="👥"
        title="Join a group to unlock group quests"
        description="Group quests are shared challenges you complete together — deposit streaks, combined savings targets, and more."
        action={{ label: "Find a group", href: "/groups" }}
      />
    );
  }

  const groupsWithActiveOrPast = data.filter((d) => d.quests.length > 0);

  if (groupsWithActiveOrPast.length === 0) {
    return (
      <EmptyState
        emoji="🏆"
        title="No group quests yet"
        description="An owner or admin in one of your groups can start one from the group's page."
      />
    );
  }

  return (
    <div className="space-y-6">
      {groupsWithActiveOrPast.map(({ group, quests }) => {
        const active = quests.filter((q) => q.status === "active");
        const settled = quests.filter((q) => q.status !== "active");
        return (
          <section key={group.group_id} aria-labelledby={`group-${group.group_id}-heading`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base" aria-hidden="true">{group.emoji}</span>
              <Link
                href={`/groups/${group.group_id}`}
                id={`group-${group.group_id}-heading`}
                className="text-xs font-semibold uppercase tracking-wide text-white/40 hover:text-white/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded"
              >
                {group.name}
              </Link>
            </div>
            <div className="space-y-2.5">
              {[...active, ...settled].map((q) => (
                <GroupQuestCard key={q.id} quest={q} canCheckCompletion onCompleted={load} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
