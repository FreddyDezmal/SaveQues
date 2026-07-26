"use client";

/**
 * components/ui/Toggle.tsx
 *
 * Extracted from the inline switch markup in
 * components/notifications/NotificationSettings.tsx (Sprint 13) — that
 * component had one hand-rolled toggle; the Notification Preferences
 * page (Sprint 16) needed six. Rather than copy-pasting the same button
 * six times (or worse, having two slightly-different toggle
 * implementations drift apart), this factors out the existing visual
 * design exactly as-is into a single reusable component.
 *
 * Sprint 27, Phase 12 update: NotificationSettings.tsx was originally
 * left on its own inline markup rather than migrated here, on the
 * reasoning that a purely cosmetic-equivalence change wasn't worth the
 * risk to a working, shipped component. That reasoning held until this
 * phase's accessibility audit found the inline version was missing
 * role="switch"/aria-checked entirely — not cosmetic, a real WCAG gap
 * (a screen reader announces it as a plain unlabeled-state button, not
 * a switch with an on/off state). That's the "measurable benefit" the
 * original comment was waiting for; NotificationSettings.tsx now uses
 * this component too. See that file's own comment for specifics.
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
