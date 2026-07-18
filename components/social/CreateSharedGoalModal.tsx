"use client";

/**
 * components/social/CreateSharedGoalModal.tsx
 *
 * Sprint 22. Posts to /api/shared-goals/create exactly as implemented.
 * The list of goals eligible to share is passed in as a prop (fetched
 * server-side in app/(app)/shared-goals/page.tsx via the same direct-
 * table-query pattern app/(app)/goals/page.tsx already uses — RLS
 * already scopes savings_goals to the caller) rather than a new API
 * route for "list my goals."
 */

import { useId, useState } from "react";
import Modal from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/utils";

interface EligibleGoal { id: string; title: string; goal_emoji: string; target_amount: number; current_amount: number; }

interface CreateSharedGoalModalProps {
  open: boolean;
  onClose: () => void;
  eligibleGoals: EligibleGoal[];
  onCreated: () => void;
}

export default function CreateSharedGoalModal({ open, onClose, eligibleGoals, onCreated }: CreateSharedGoalModalProps) {
  const titleId = useId();
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setSelectedGoalId(null); setError(null);
    onClose();
  }

  async function handleSubmit() {
    if (!selectedGoalId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/shared-goals/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goalId: selectedGoalId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't share that goal");
      handleClose();
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} titleId={titleId} title="Share a goal" maxWidthClassName="max-w-md">
      {eligibleGoals.length === 0 ? (
        <p className="text-sm text-white/50 py-4 text-center">
          You don&apos;t have any goals available to share. Create a new goal first, then come back here.
        </p>
      ) : (
        <>
          <p className="text-sm text-white/60 mb-4">Pick one of your goals to invite others to contribute to.</p>
          <div className="space-y-2 max-h-72 overflow-y-auto" role="radiogroup" aria-label="Choose a goal to share">
            {eligibleGoals.map((g) => (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={selectedGoalId === g.id}
                onClick={() => setSelectedGoalId(g.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
                  selectedGoalId === g.id ? "border-brand-500 bg-brand-500/10" : "border-surface-border hover:border-white/20"
                }`}
              >
                <span className="text-xl shrink-0" aria-hidden="true">{g.goal_emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{g.title}</p>
                  <p className="text-xs text-white/40">{formatCurrency(g.current_amount)} of {formatCurrency(g.target_amount)}</p>
                </div>
              </button>
            ))}
          </div>

          {error && <p role="alert" className="text-xs text-red-400 mt-3">{error}</p>}

          <div className="flex gap-3 mt-4">
            <button type="button" onClick={handleClose} className="btn-ghost flex-1 text-sm" disabled={submitting}>Cancel</button>
            <button type="button" onClick={handleSubmit} disabled={submitting || !selectedGoalId} className="btn-primary flex-1 text-sm">
              {submitting ? "Sharing…" : "Share this goal"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
