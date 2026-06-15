// ── Momentum States ────────────────────────────────────────────
// States are more emotionally resonant than scores.
// A user can't game a state — they can only live it.

import { getLastNUTCDateStrings } from "./dateUtils";

export type MomentumState = "building" | "consistent" | "on_fire" | "unstoppable";

export interface MomentumInfo {
  state: MomentumState;
  label: string;
  description: string;
  emoji: string;
  color: string;
  // 0–1 normalised score used internally only — never shown to user
  score: number;
}

/**
 * Calculate momentum state from the last 14 days of activity.
 *
 * Thresholds (based on 14-day window):
 *   Building     — 1–4  active days  (showing up but not yet consistent)
 *   Consistent   — 5–8  active days  (more than half the time)
 *   On Fire      — 9–11 active days  (strong consistency)
 *   Unstoppable  — 12+  active days  (elite territory)
 *
 * Also weights recent days more than older days (last 7 > first 7).
 *
 * IMPORTANT: "day" here means UTC calendar day, matching how
 * activity_log.activity_date is written (see lib/dateUtils.ts).
 * All callers — including MomentumHeatmap's day grid — must use
 * getUTCDateString()/getLastNUTCDateStrings() so this score and the
 * heatmap agree on which cell is "today".
 */
export function getMomentumState(activityLog: { date: string; xp_earned: number }[]): MomentumInfo {
  const last14 = getLastNUTCDateStrings(14);

  // Recent 7 days weighted 2×, older 7 days weighted 1×
  const activitySet = new Set(activityLog.map(a => a.date));
  let weightedScore = 0;

  last14.forEach((date, i) => {
    if (activitySet.has(date)) {
      weightedScore += i >= 7 ? 2 : 1; // last7 (indices 7-13) = more recent = higher weight
    }
  });

  // Max possible weighted score: 7×2 + 7×1 = 21
  const normalised = weightedScore / 21;

  let state: MomentumState;
  if (normalised === 0)        state = "building";
  else if (normalised < 0.38)  state = "building";
  else if (normalised < 0.62)  state = "consistent";
  else if (normalised < 0.85)  state = "on_fire";
  else                         state = "unstoppable";

  return { ...MOMENTUM_STATES[state], state, score: normalised };
}

export const MOMENTUM_STATES: Record<MomentumState, Omit<MomentumInfo, "state" | "score">> = {
  building: {
    label: "Building",
    description: "You're showing up. Keep going.",
    emoji: "🌱",
    color: "#6b7280",
  },
  consistent: {
    label: "Consistent",
    description: "More than half your days active. Strong.",
    emoji: "⚡",
    color: "#3b82f6",
  },
  on_fire: {
    label: "On Fire",
    description: "You're showing up almost every day.",
    emoji: "🔥",
    color: "#f97316",
  },
  unstoppable: {
    label: "Unstoppable",
    description: "Elite consistency. You're in rare company.",
    emoji: "👑",
    color: "#ffb800",
  },
};