"use client";

/**
 * components/ui/UndoSnackbar.tsx
 *
 * A single, app-wide reusable snackbar for non-destructive, reversible
 * actions — mark notification read, dismiss, delete local draft, hide
 * announcement, etc. Deliberately generic (message + undo callback) so it
 * isn't a "notifications-only" component wearing a general-purpose name.
 *
 * HARD RULE, stated in code as well as here: this must never be used for
 * financial actions (deposits, withdrawals, goal edits). Those already
 * have their own explicit, server-validated confirmation flows — bolting
 * an "undo" affordance onto a financial mutation would imply a client-side
 * reversibility that doesn't actually exist (the deposit already committed
 * server-side by the time any snackbar could render), which is actively
 * misleading for a financial app. There is no technical enforcement of
 * this in the component itself (it's a generic UI primitive, it has no way
 * to know what its caller is undoing) — the enforcement is: don't call it
 * from a financial mutation's success handler. Documented prominently here
 * so that boundary isn't accidentally crossed later by someone reaching
 * for "there's already an undo snackbar" as a shortcut.
 *
 * Only one snackbar is shown at a time — a second call while one is
 * visible replaces it rather than stacking, which matches how this is
 * actually used (a fast sequence of "mark read" taps shouldn't produce a
 * pile of snackbars).
 */

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Undo2 } from "lucide-react";

interface UndoSnackbarState {
  message: string;
  onUndo: () => void;
}

interface UndoSnackbarContextValue {
  showUndo: (message: string, onUndo: () => void) => void;
}

const UndoSnackbarContext = createContext<UndoSnackbarContextValue | null>(null);

const AUTO_DISMISS_MS = 5000;

export function UndoSnackbarProvider({ children }: { children: React.ReactNode }) {
  const [snackbar, setSnackbar] = useState<UndoSnackbarState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUndo = useCallback((message: string, onUndo: () => void) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setSnackbar({ message, onUndo });
    timeoutRef.current = setTimeout(() => setSnackbar(null), AUTO_DISMISS_MS);
  }, []);

  function handleUndo() {
    if (!snackbar) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    snackbar.onUndo();
    setSnackbar(null);
  }

  return (
    <UndoSnackbarContext.Provider value={{ showUndo }}>
      {children}
      {snackbar && (
        <div
          role="status"
          className="fixed bottom-24 left-4 right-4 z-40 mx-auto max-w-sm rounded-2xl bg-surface-elevated border border-surface-border shadow-lg px-4 py-3 flex items-center gap-3 animate-fade-in"
        >
          <p className="text-sm text-white/80 flex-1 min-w-0">{snackbar.message}</p>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 text-sm font-medium text-brand-400 hover:text-brand-300 transition-colors flex-shrink-0 px-2 py-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <Undo2 size={14} /> Undo
          </button>
        </div>
      )}
    </UndoSnackbarContext.Provider>
  );
}

/**
 * Throws (rather than silently no-op-ing) if used outside the provider —
 * a silently-missing undo affordance is worse than a loud one, since it'd
 * mean a "reversible" action quietly became irreversible with no signal.
 */
export function useUndoSnackbar(): UndoSnackbarContextValue {
  const ctx = useContext(UndoSnackbarContext);
  if (!ctx) {
    throw new Error("useUndoSnackbar must be used within an UndoSnackbarProvider");
  }
  return ctx;
}
