"use client";

/**
 * components/social/ContributeModal.tsx
 *
 * Sprint 22. Posts to /api/shared-goals/contribute exactly as
 * implemented. Labeled "tracked contribution" throughout, matching that
 * route's own explicit distinction — this never touches the goal
 * owner's real balance (see 045/049's file headers on the separate-
 * ledger design).
 */

import { useId, useState } from "react";
import Modal from "@/components/ui/Modal";

interface ContributeModalProps {
  open: boolean;
  onClose: () => void;
  sharedGoalId: string;
  goalTitle: string;
  onContributed: () => void;
}

export default function ContributeModal({ open, onClose, sharedGoalId, goalTitle, onContributed }: ContributeModalProps) {
  const titleId = useId();
  const amountId = useId();
  const noteId = useId();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setAmount(""); setNote(""); setError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numeric = Number(amount);
    if (!numeric || numeric <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/shared-goals/contribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharedGoalId, amount: numeric, note: note.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't log that contribution");
      handleClose();
      onContributed();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} titleId={titleId} title={`Log a contribution to ${goalTitle}`} maxWidthClassName="max-w-sm">
      <p className="text-xs text-white/40 mb-4">
        This tracks your contribution for the group — it doesn&apos;t move money automatically. The goal owner reconciles it as a real deposit separately.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor={amountId} className="block text-sm text-white/70 mb-1.5">Amount</label>
          <input id={amountId} type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required className="input-field" autoFocus />
        </div>
        <div>
          <label htmlFor={noteId} className="block text-sm text-white/70 mb-1.5">Note <span className="text-white/30">(optional)</span></label>
          <input id={noteId} type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="input-field" placeholder="e.g. this week's contribution" />
        </div>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={handleClose} className="btn-ghost flex-1 text-sm" disabled={submitting}>Cancel</button>
          <button type="submit" disabled={submitting || !amount} className="btn-primary flex-1 text-sm">
            {submitting ? "Logging…" : "Log contribution"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
