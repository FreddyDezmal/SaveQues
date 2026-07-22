// lib/momentum.ts

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
 * This is NOT a flat day-count: each active day in the last 14 is
 * scored, but the most recent 7 days count double the older 7, then
 * normalised against the max possible weighted score (21). So the
 * state someone lands in depends on *when* they were active, not just
 * how many days — e.g. 4 active days that are all in the last week
 * (weighted 4×2=8, normalised 0.38) already crosses into "Consistent,"
 * not "Building," while 4 active days spread across the older week
 * only (weighted 4×1=4, normalised 0.19) stays "Building."
 *
 * Code review fix: this docstring previously listed flat thresholds
 * ("Building = 1–4 active days" etc.) that ignored the recency
 * weighting below and didn't match the code — anyone writing UI copy
 * like "3 more days to next level!" from that table would have gotten
 * it wrong. Approximate all-recent-or-all-old ranges, for intuition
 * only (exact boundary depends on which specific days were active):
 *   Building     — normalised score < 0.38
 *   Consistent   — 0.38 ≤ score < 0.62
 *   On Fire      — 0.62 ≤ score < 0.85
 *   Unstoppable  — score ≥ 0.85
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