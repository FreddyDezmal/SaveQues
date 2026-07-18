"use client";

/**
 * components/social/GroupQuestCard.tsx
 *
 * Sprint 22. Renders one entry of GET /api/group-quests/list, with an
 * expandable section that fetches GET /api/group-quests/progress
 * (aggregate-only — member_count/participated_count/deposit counts,
 * never individual dollar amounts, per compute_group_quest_progress's
 * own design, 050) on demand rather than eagerly for every quest card.
 */

import { useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import StatusBadge, { type BadgeStatus } from "@/components/ui/StatusBadge";

export interface GroupQuest {
  id: string;
  quest_type: string;
  title: string;
  description: string | null;
  target_value: number | null;
  xp_reward: number;
  start_date: string;
  end_date: string;
  status: "active" | "completed" | "expired";
  completed_at: string | null;
}

interface Progress {
  member_count: number;
  participated_count: number;
  total_deposit_count: number;
  total_deposit_amount: number;
  is_condition_met: boolean;
}

export default function GroupQuestCard({ quest, canCheckCompletion, onCompleted }: {
  quest: GroupQuest; canCheckCompletion: boolean; onCompleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [checking, setChecking] = useState(false);
  const detailId = `quest-detail-${quest.id}`;

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && !progress) {
      setLoadingProgress(true);
      try {
        const res = await fetch(`/api/group-quests/progress?groupQuestId=${quest.id}`);
        if (res.ok) setProgress(await res.json());
      } finally {
        setLoadingProgress(false);
      }
    }
  }

  async function checkCompletion() {
    setChecking(true);
    try {
      const res = await fetch("/api/group-quests/check-completion", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupQuestId: quest.id }),
      });
      if (res.ok) onCompleted();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="card p-4">
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-controls={detailId}
        className="w-full flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded-lg"
      >
        <div className="w-9 h-9 rounded-lg bg-brand-500/10 flex items-center justify-center shrink-0" aria-hidden="true">
          <Trophy size={16} className="text-brand-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{quest.title}</p>
          <p className="text-xs text-white/40">{quest.xp_reward} XP · ends {new Date(quest.end_date).toLocaleDateString()}</p>
        </div>
        <StatusBadge status={quest.status as BadgeStatus} />
        <ChevronDown size={16} className={`text-white/30 transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {expanded && (
        <div id={detailId} className="mt-3 pt-3 border-t border-surface-border">
          {loadingProgress ? (
            <p className="text-xs text-white/40">Loading progress…</p>
          ) : progress ? (
            <div className="space-y-1.5 text-xs text-white/60">
              <p>{progress.participated_count} / {progress.member_count} members have saved</p>
              <p>{progress.total_deposit_count} deposits logged this quest</p>
              {progress.is_condition_met && quest.status === "active" && (
                <p className="text-emerald-400 font-medium">Goal reached! 🎉</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-white/40">No progress data available.</p>
          )}

          {quest.status === "active" && canCheckCompletion && (
            <button type="button" onClick={checkCompletion} disabled={checking} className="btn-ghost text-xs mt-3 px-3 py-2">
              {checking ? "Checking…" : "Check for completion"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
