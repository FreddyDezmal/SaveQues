"use client";

/**
 * components/social/CreateGroupModal.tsx
 *
 * Sprint 22. Posts to /api/groups/create exactly as implemented — the
 * group_type options here match VALID_TYPES in that route precisely.
 */

import { useId, useState } from "react";
import Modal from "@/components/ui/Modal";

const GROUP_TYPES: { value: string; label: string; emoji: string }[] = [
  { value: "family", label: "Family", emoji: "👨‍👩‍👧‍👦" },
  { value: "friends", label: "Friends", emoji: "🧑‍🤝‍🧑" },
  { value: "university", label: "University", emoji: "🎓" },
  { value: "roommates", label: "Roommates", emoji: "🏠" },
  { value: "travel", label: "Travel", emoji: "✈️" },
  { value: "wedding", label: "Wedding", emoji: "💍" },
  { value: "emergency_fund", label: "Emergency Fund", emoji: "🛟" },
  { value: "custom", label: "Custom", emoji: "👥" },
];

interface CreateGroupModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateGroupModal({ open, onClose, onCreated }: CreateGroupModalProps) {
  const titleId = useId();
  const nameId = useId();
  const descId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [groupType, setGroupType] = useState("custom");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setName(""); setDescription(""); setGroupType("custom"); setError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const selected = GROUP_TYPES.find((t) => t.value === groupType);
      const res = await fetch("/api/groups/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, groupType, emoji: selected?.emoji }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't create that group");
      handleClose();
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} titleId={titleId} title="Create a group" maxWidthClassName="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor={nameId} className="block text-sm text-white/70 mb-1.5">Group name</label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            className="input-field"
            placeholder="Travel Crew"
          />
        </div>

        <div>
          <label htmlFor={descId} className="block text-sm text-white/70 mb-1.5">Description <span className="text-white/30">(optional)</span></label>
          <textarea
            id={descId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            rows={2}
            className="input-field resize-none"
            placeholder="What's this group saving for?"
          />
        </div>

        <fieldset>
          <legend className="block text-sm text-white/70 mb-1.5">Type</legend>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Group type">
            {GROUP_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={groupType === t.value}
                onClick={() => setGroupType(t.value)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
                  groupType === t.value ? "border-brand-500 bg-brand-500/10 text-brand-300" : "border-surface-border text-white/50 hover:border-white/20"
                }`}
              >
                <span className="text-lg" aria-hidden="true">{t.emoji}</span>
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>

        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={handleClose} className="btn-ghost flex-1 text-sm" disabled={submitting}>Cancel</button>
          <button type="submit" disabled={submitting || !name.trim()} className="btn-primary flex-1 text-sm">
            {submitting ? "Creating…" : "Create group"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
