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
import { getCurrencyConfig } from "@/lib/currency";
import { formatDateShort } from "@/lib/dateFormat";

export interface Contribution {
  id: string;
  user_id: string;
  amount: number;
  /** Sprint 31 — Phase 9. The currency THIS contribution was actually
   *  made in — deliberately NOT converted here. Each line item is one
   *  contributor's own money in their own currency; only the aggregate
   *  totals (SharedGoalDetailClient's total_contributed /
   *  total_group_contributions) get converted into the goal owner's
   *  currency. Showing this line converted would hide what the
   *  contributor actually typed. */
  currency_code: string;
  note: string | null;
  created_at: string;
  contributor_name?: string;
}

export default function ContributionCard({ contribution }: { contribution: Contribution }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-surface-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white">
          <span className="font-medium">{contribution.contributor_name || "A contributor"}</span> added {formatCurrency(contribution.amount, contribution.currency_code, getCurrencyConfig(contribution.currency_code).locale)}
        </p>
        {contribution.note && <p className="text-xs text-white/40 truncate">{contribution.note}</p>}
      </div>
      <time dateTime={contribution.created_at} className="text-xs text-white/30 shrink-0">
        {formatDateShort(contribution.created_at, getCurrencyConfig(contribution.currency_code).locale)}
      </time>
    </div>
  );
}
