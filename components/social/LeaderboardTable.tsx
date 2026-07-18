/**
 * components/social/LeaderboardTable.tsx
 *
 * Sprint 22. A labeled list of LeaderboardRow, with an aria-live region
 * announcing when the metric/period/scope changes and new results load —
 * screen reader users switching tabs need to know the list actually
 * updated, since visually it's obvious but the DOM change alone isn't
 * announced by default.
 */

import { ReactNode } from "react";

interface LeaderboardTableProps {
  label: string;
  loading: boolean;
  empty: boolean;
  emptyMessage: string;
  children: ReactNode;
}

export default function LeaderboardTable({ label, loading, empty, emptyMessage, children }: LeaderboardTableProps) {
  return (
    <div role="region" aria-label={label} aria-live="polite" aria-busy={loading}>
      {loading ? (
        <p className="text-sm text-white/40 text-center py-8">Loading…</p>
      ) : empty ? (
        <p className="text-sm text-white/40 text-center py-8">{emptyMessage}</p>
      ) : (
        <div className="space-y-1">{children}</div>
      )}
    </div>
  );
}
