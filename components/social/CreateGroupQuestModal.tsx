"use client";

/**
 * components/social/CreateGroupQuestModal.tsx
 *
 * Sprint 22. Posts to /api/group-quests/create exactly as implemented —
 * quest type options and the NEEDS_TARGET set match that route precisely.
 */

import { useId, useState } from "react";
import Modal from "@/components/ui/Modal";

const QUEST_TYPES = [
  { value: "everyone_saves_this_week", label: "Everyone saves this week", needsTarget: false },
  { value: "full_participation", label: "Full participation", needsTarget: false },
  { value: "deposit_count_together", label: "Deposit count together", needsTarget: true, targetLabel: "Number of deposits" },
  { value: "target_amount_together", label: "Reach an amount together", needsTarget: true, targetLabel: "Target amount" },
] as const;

interface CreateGroupQuestModalProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  onCreated: () => void;
}

export default function CreateGroupQuestModal({ open, onClose, groupId, onCreated }: CreateGroupQuestModalProps) {
  const titleId = useId();
  const nameId = useId();
  const targetId = useId();
  const startId = useId();
  const endId = useId();

  const [questType, setQuestType] = useState<(typeof QUEST_TYPES)[number]["value"]>("everyone_saves_this_week");
  const [title, setTitle] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedType = QUEST_TYPES.find((t) => t.value === questType)!;

  function handleClose() {
    setTitle(""); setTargetValue(""); setError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/group-quests/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId, questType, title: title.trim(), startDate, endDate,
          targetValue: selectedType.needsTarget ? Number(targetValue) : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't create that quest");
      handleClose();
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} titleId={titleId} title="New group quest" maxWidthClassName="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset>
          <legend className="block text-sm text-white/70 mb-1.5">Quest type</legend>
          <div className="space-y-2" role="radiogroup" aria-label="Quest type">
            {QUEST_TYPES.map((t) => (
              <label
                key={t.value}
                className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                  questType === t.value ? "border-brand-500 bg-brand-500/10" : "border-surface-border hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="questType"
                  value={t.value}
                  checked={questType === t.value}
                  onChange={() => setQuestType(t.value)}
                  className="accent-brand-500"
                />
                <span className="text-sm text-white/80">{t.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={nameId} className="block text-sm text-white/70 mb-1.5">Title</label>
          <input id={nameId} type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required className="input-field" placeholder="Save together this week!" />
        </div>

        {selectedType.needsTarget && (
          <div>
            <label htmlFor={targetId} className="block text-sm text-white/70 mb-1.5">{selectedType.targetLabel}</label>
            <input id={targetId} type="number" min={1} value={targetValue} onChange={(e) => setTargetValue(e.target.value)} required className="input-field" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={startId} className="block text-sm text-white/70 mb-1.5">Start</label>
            <input id={startId} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required className="input-field" />
          </div>
          <div>
            <label htmlFor={endId} className="block text-sm text-white/70 mb-1.5">End</label>
            <input id={endId} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required className="input-field" />
          </div>
        </div>

        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={handleClose} className="btn-ghost flex-1 text-sm" disabled={submitting}>Cancel</button>
          <button type="submit" disabled={submitting || !title.trim()} className="btn-primary flex-1 text-sm">
            {submitting ? "Creating…" : "Create quest"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
