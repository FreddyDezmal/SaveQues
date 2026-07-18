"use client";

/**
 * components/ui/PrivacySelector.tsx
 *
 * Sprint 22. Native <select> — explicitly required over a custom
 * dropdown so keyboard/screen-reader support comes from the browser,
 * not hand-rolled ARIA that's easy to get subtly wrong. Styled with the
 * existing .input-field class so it matches every other form control in
 * the app rather than introducing a new visual style for just this case.
 */

import { useId } from "react";
import type { VisibilityLevel } from "./VisibilityBadge";

interface Option {
  value: VisibilityLevel;
  label: string;
  description: string;
}

const OPTION_SETS: Record<"profile" | "activity" | "goal" | "achievement", Option[]> = {
  profile: [
    { value: "private", label: "Private", description: "Strangers can't find or view your profile" },
    { value: "friends", label: "Friends",  description: "Only accepted friends can find you" },
    { value: "public",  label: "Public",   description: "Anyone can find your profile" },
  ],
  activity: [
    { value: "private", label: "Private", description: "Only you" },
    { value: "friends", label: "Friends",  description: "Your accepted friends" },
    { value: "groups",  label: "Groups",   description: "Members of groups you share" },
    { value: "public",  label: "Public",   description: "Anyone" },
  ],
  goal: [
    { value: "private", label: "Private", description: "Only you" },
    { value: "friends", label: "Friends",  description: "Your accepted friends" },
    { value: "group",   label: "Group",    description: "Members of the group this goal is shared with" },
    { value: "public",  label: "Public",   description: "Anyone" },
  ],
  achievement: [
    { value: "private", label: "Private", description: "Only you" },
    { value: "friends", label: "Friends",  description: "Your accepted friends" },
    { value: "groups",  label: "Groups",   description: "Members of groups you share" },
    { value: "public",  label: "Public",   description: "Anyone" },
  ],
};

interface PrivacySelectorProps {
  kind: "profile" | "activity" | "goal" | "achievement";
  value: VisibilityLevel;
  onChange: (value: VisibilityLevel) => void;
  label: string;
  disabled?: boolean;
}

export default function PrivacySelector({ kind, value, onChange, label, disabled }: PrivacySelectorProps) {
  const selectId = useId();
  const descId = useId();
  const options = OPTION_SETS[kind];
  const selected = options.find((o) => o.value === value);

  return (
    <div>
      <label htmlFor={selectId} className="block text-sm text-white/70 mb-1.5">
        {label}
      </label>
      <select
        id={selectId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as VisibilityLevel)}
        aria-describedby={descId}
        className="input-field disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <p id={descId} className="text-xs text-white/40 mt-1.5">
        {selected?.description}
      </p>
    </div>
  );
}
