"use client";

/**
 * components/ui/ConfirmationModal.tsx
 *
 * Sprint 22. Required in front of every destructive action this sprint's
 * APIs expose: delete group, unshare goal, block friend, remove member,
 * leave group. Built on Modal (focus trap / Escape / return-focus already
 * handled there) — this component only adds the confirm/cancel button
 * pair and a danger-toned confirm button for genuinely destructive actions.
 */

import { useId, useState } from "react";
import Modal from "./Modal";

interface ConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  description: string;
  confirmLabel: string;
  /** Full label read by assistive tech, e.g. "Remove Alice from Travel Crew" — falls back to confirmLabel if omitted. */
  confirmAriaLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for irreversible/destructive actions (default true). Set false for lower-stakes confirmations. */
  danger?: boolean;
}

export default function ConfirmationModal({
  open, onClose, onConfirm, title, description, confirmLabel, confirmAriaLabel, cancelLabel = "Cancel", danger = true,
}: ConfirmationModalProps) {
  const titleId = useId();
  const descId = useId();
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} titleId={titleId} title={title} descriptionId={descId}>
      <p id={descId} className="text-sm text-white/60 mb-5 leading-relaxed">
        {description}
      </p>
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="btn-ghost flex-1 text-sm" disabled={submitting}>
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting}
          aria-label={confirmAriaLabel ?? confirmLabel}
          className={`flex-1 text-sm font-semibold font-display px-5 py-3 rounded-xl transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 ${
            danger
              ? "bg-red-500/90 hover:bg-red-500 text-white focus-visible:ring-red-500/50"
              : "bg-brand-500 hover:bg-brand-400 text-black focus-visible:ring-brand-500/50"
          }`}
        >
          {submitting ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
