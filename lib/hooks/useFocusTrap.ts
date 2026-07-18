"use client";

/**
 * lib/hooks/useFocusTrap.ts
 *
 * Sprint 22, Phase "Social UI". Extracted from the inline focus-trap /
 * Escape-to-close / return-focus effect in
 * components/notifications/NotificationCenter.tsx (Sprint 17) — that
 * component had one dialog needing this; this sprint's social features
 * need several (ConfirmationModal, InviteModal, group/goal creation
 * forms). Same "extract on second use" reasoning as
 * usePrefersReducedMotion.ts. NotificationCenter itself is left with its
 * own inline implementation rather than retroactively refactored to use
 * this — unnecessary risk to a working, shipped component for a
 * cosmetic-equivalence gain, same reasoning Toggle.tsx's header already
 * documents for a different component.
 *
 * Usage:
 *   const panelRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);
 *   <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1}>...
 */

import { useEffect, useRef } from "react";

export function useFocusTrap<T extends HTMLElement>(active: boolean, onClose: () => void) {
  const panelRef = useRef<T>(null);
  const triggerElementRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!active) return;

    // Remember what had focus before the dialog opened, so it can be
    // restored on close instead of dropping focus back to <body>.
    triggerElementRef.current = document.activeElement;
    panelRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (triggerElementRef.current instanceof HTMLElement) {
        triggerElementRef.current.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return panelRef;
}
