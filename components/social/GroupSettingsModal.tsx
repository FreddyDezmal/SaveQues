"use client";

/**
 * components/social/GroupSettingsModal.tsx
 *
 * Sprint 22. Posts to /api/groups/edit exactly as implemented — owner_id
 * is never sent (that route never accepts it; 048 locks it at the DB
 * level regardless).
 */

import { useId, useState } from "react";
import Modal from "@/components/ui/Modal";
import type { GroupSummary } from "./GroupCard";

interface GroupSettingsModalProps {
  open: boolean;
  onClose: () => void;
  group: GroupSummary;
  onSaved: () => void;
}

export default function GroupSettingsModal({ open, onClose, group, onSaved }: GroupSettingsModalProps) {
  const titleId = useId();
  const nameId = useId();
  const descId = useId();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/groups/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group.group_id, name: name.trim(), description: description.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't save changes");
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} titleId={titleId} title="Group settings" maxWidthClassName="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor={nameId} className="block text-sm text-white/70 mb-1.5">Group name</label>
          <input id={nameId} type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className="input-field" />
        </div>
        <div>
          <label htmlFor={descId} className="block text-sm text-white/70 mb-1.5">Description</label>
          <textarea id={descId} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} className="input-field resize-none" />
        </div>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost flex-1 text-sm" disabled={submitting}>Cancel</button>
          <button type="submit" disabled={submitting || !name.trim()} className="btn-primary flex-1 text-sm">
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
