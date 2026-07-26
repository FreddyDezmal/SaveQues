/**
 * lib/hourOptions.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27, Phase 4: extracted from the HOURS constant that lived inline
 * in components/notifications/NotificationSettings.tsx (Sprint 13) — the
 * new quiet-hours picker in NotificationPreferencesClient.tsx needs the
 * exact same "0-23 → 12-hour label" list, and duplicating a second copy
 * would be exactly the kind of drift risk the "avoid duplication"
 * engineering rule exists to prevent. NotificationSettings.tsx now imports
 * this instead of defining its own — same values, same order, one source.
 */
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i === 0 ? "12:00 AM" : i < 12 ? `${i}:00 AM` : i === 12 ? "12:00 PM" : `${i - 12}:00 PM`,
}));
