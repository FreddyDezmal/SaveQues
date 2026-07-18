/**
 * components/social/ContributionCard.tsx
 *
 * Sprint 22. Renders one row of group_contributions (fetched directly
 * client-side — RLS group_contributions_select_participant, 045,
 * already scopes this to shared-goal participants, same "reuse existing
 * RLS-protected direct access" pattern as the eligible-goals fetch on
 * the shared-goals list page). Amounts shown here are the same
 * deliberate, participant-scoped exception documented in 049's file
 * header — this is exactly the ledger that RPC's design describes.
 */

import { formatCurrency } from "@/lib/utils";

export interface Contribution {
  id: string;
  user_id: string;
  amount: number;
  note: string | null;
  created_at: string;
  contributor_name?: string;
}

export default function ContributionCard({ contribution }: { contribution: Contribution }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-surface-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white">
          <span className="font-medium">{contribution.contributor_name || "A contributor"}</span> added {formatCurrency(contribution.amount)}
        </p>
        {contribution.note && <p className="text-xs text-white/40 truncate">{contribution.note}</p>}
      </div>
      <time dateTime={contribution.created_at} className="text-xs text-white/30 shrink-0">
        {new Date(contribution.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </time>
    </div>
  );
}
