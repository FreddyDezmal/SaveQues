"use client";

/**
 * components/ui/Modal.tsx
 *
 * Sprint 22. Base dialog shell — role="dialog", aria-modal, focus trap,
 * Escape-to-close, focus restored to the trigger on close (useFocusTrap).
 * ConfirmationModal and every social "invite"/"create" modal this sprint
 * needs are built on this rather than each re-implementing the same
 * overlay/panel/focus-management boilerplate.
 */

import { ReactNode } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: string;
  descriptionId?: string;
  children: ReactNode;
  /** Max width class — defaults to a compact size suited to confirmations/forms. */
  maxWidthClassName?: string;
}

export default function Modal({
  open, onClose, titleId, title, descriptionId, children, maxWidthClassName = "max-w-sm",
}: ModalProps) {
  const panelRef = useFocusTrap<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={`relative w-full ${maxWidthClassName} card p-5 animate-fade-in focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 id={titleId} className="font-display text-lg font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-white/40 hover:text-white/70 p-1 -m-1 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
