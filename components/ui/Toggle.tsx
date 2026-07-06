"use client";

/**
 * components/ui/Toggle.tsx
 *
 * Extracted from the inline switch markup in
 * components/notifications/NotificationSettings.tsx (Sprint 13) — that
 * component had one hand-rolled toggle; this sprint's Notification
 * Preferences page needs six. Rather than copy-pasting the same button six
 * times (or worse, having two slightly-different toggle implementations
 * drift apart), this factors out the existing visual design exactly as-is
 * into a single reusable component. NotificationSettings.tsx itself is
 * intentionally left using its own inline markup rather than retroactively
 * refactored to use this — that would be an unnecessary risk to a working,
 * shipped component for a purely cosmetic-equivalence gain, which the
 * sprint brief's "avoid cosmetic changes without measurable benefit"
 * principle argues against.
 */

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  /** Visually hidden but read by screen readers when no visible label sits next to the control. */
  srLabel?: string;
}

export default function Toggle({ checked, onChange, disabled, label, srLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={srLabel ?? label}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative shrink-0 w-12 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-40 ${
        checked ? "bg-brand-500" : "bg-surface-border"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
}
