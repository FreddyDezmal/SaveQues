/**
 * components/social/SharedGoalCard.tsx
 *
 * Sprint 22. Renders entries from GET /api/shared-goals/list's `owned`
 * and `contributing` arrays (list_my_shared_goals(), 049). Real
 * target/current amounts ARE shown here — that RPC's own file header
 * documents this as a deliberate, scoped exception to "no amounts",
 * limited to people who can already see the shared goal's ledger.
 */

import Link from "next/link";
import { Users } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/utils";

export interface OwnedSharedGoal {
  shared_goal_id: string; goal_id: string; title: string; goal_emoji: string;
  target_amount: number; current_amount: number; is_complete: boolean;
  group_id: string | null; contributor_count: number;
}
export interface ContributingSharedGoal {
  shared_goal_id: string; goal_id: string; title: string; goal_emoji: string;
  target_amount: number; current_amount: number; is_complete: boolean;
  owner_display_name: string; my_total_contributed: number;
}

export default function SharedGoalCard({ goal, subtitle }: { goal: OwnedSharedGoal | ContributingSharedGoal; subtitle: string }) {
  const percent = goal.target_amount > 0 ? Math.min(100, (goal.current_amount / goal.target_amount) * 100) : 0;

  return (
    <Link
      href={`/shared-goals/${goal.shared_goal_id}`}
      className="card p-4 block hover:border-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-11 h-11 rounded-xl bg-surface-elevated flex items-center justify-center text-xl shrink-0" aria-hidden="true">{goal.goal_emoji}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{goal.title}</p>
          <p className="text-xs text-white/40">{subtitle}</p>
        </div>
        {goal.is_complete && <span className="text-xs text-emerald-400 font-medium">Complete</span>}
      </div>
      <div
        className="h-1.5 rounded-full bg-surface-elevated overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${goal.title} progress: ${formatPercent(percent)}`}
      >
        <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-xs text-white/40">
        <span>{formatCurrency(goal.current_amount)} of {formatCurrency(goal.target_amount)}</span>
        {"contributor_count" in goal && (
          <span className="flex items-center gap-1"><Users size={11} aria-hidden="true" /> {goal.contributor_count}</span>
        )}
      </div>
    </Link>
  );
}
