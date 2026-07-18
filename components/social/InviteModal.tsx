"use client";

/**
 * components/social/InviteModal.tsx
 *
 * Sprint 22. One modal shell for every "search for a user, then act on
 * them" flow — add friend, invite to group, invite to shared goal,
 * request a partner. Each caller supplies the title/description/submit
 * label and the actual API call; this component owns the search UI,
 * loading/error state, and success feedback only.
 */

import { useId, useState } from "react";
import Modal from "@/components/ui/Modal";
import UserSearchPicker, { type SearchResultUser } from "./UserSearchPicker";
import UserAvatar, { UserName } from "./UserAvatar";

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  excludeIds?: string[];
  /** Called when the user confirms sending the invite/request to the selected user. Should throw with a message on failure. */
  onInvite: (user: SearchResultUser) => Promise<void>;
  submitLabel: string;
}

export default function InviteModal({ open, onClose, title, description, excludeIds, onInvite, submitLabel }: InviteModalProps) {
  const titleId = useId();
  const descId = useId();
  const [selected, setSelected] = useState<SearchResultUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleClose() {
    setSelected(null);
    setError(null);
    setSuccess(false);
    onClose();
  }

  async function handleSubmit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await onInvite(selected);
      setSuccess(true);
      setTimeout(handleClose, 1200);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} titleId={titleId} title={title} descriptionId={descId} maxWidthClassName="max-w-md">
      <p id={descId} className="text-sm text-white/60 mb-4">{description}</p>

      {success ? (
        <div role="status" className="text-center py-6">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-sm text-white/70">Done!</p>
        </div>
      ) : selected ? (
        <div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-elevated mb-4">
            <UserAvatar emoji={selected.avatar_emoji} />
            <UserName displayName={selected.display_name} username={selected.username} className="flex-1 min-w-0" />
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-white/40 hover:text-white/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded px-2 py-1"
            >
              Change
            </button>
          </div>
          {error && <p role="alert" className="text-xs text-red-400 mb-3">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={handleClose} className="btn-ghost flex-1 text-sm" disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary flex-1 text-sm"
              aria-label={`${submitLabel} to ${selected.display_name || "this user"}`}
            >
              {submitting ? "Sending…" : submitLabel}
            </button>
          </div>
        </div>
      ) : (
        <UserSearchPicker onSelect={setSelected} excludeIds={excludeIds} />
      )}
    </Modal>
  );
}
