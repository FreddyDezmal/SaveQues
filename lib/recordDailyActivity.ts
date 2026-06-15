/**
 * lib/recordDailyActivity.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin wrapper around the upsert_daily_activity() Postgres function.
 *
 * Call this from any server-side API route where a meaningful user action
 * occurs (deposit, quest completion, etc.).  It records activity signals
 * used later for D1 / D7 / D30 retention, WAU, and MAU calculations.
 *
 * The underlying function is idempotent (INSERT ... ON CONFLICT DO UPDATE)
 * so calling it multiple times in the same day is safe — deltas are additive.
 *
 * NOTE — relationship to activity_log / Day Momentum:
 *   This writes to `analytics_daily_activity`, a separate table used purely
 *   for retention analytics (D1/D7/D30, WAU/MAU) in the Admin dashboard.
 *   It is NOT the source of truth for the Dashboard's Day Momentum heatmap —
 *   that reads `activity_log`, which is written by award_xp() /
 *   log_activity_event() (see lib/dateUtils.ts and migration 015).
 *   Most callers of recordDailyActivity() already call awardXP() first
 *   (which writes activity_log), so DO NOT also call log_activity_event()
 *   here — that would double-count actions_count/xp_earned for the day.
 *   Only call log_activity_event() directly for actions that do NOT go
 *   through awardXP() (e.g. withdrawals, daily check-ins).
 *
 * USAGE
 *   await recordDailyActivity(supabase, userId, {
 *     deposit_delta: 1,
 *     xp_delta:      150,
 *   });
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getUTCDateString } from "@/lib/dateUtils";

interface ActivityDeltas {
  /** Mark the user as having opened the app today */
  app_opened?:    boolean;
  /** Number of deposits made (positive transactions) */
  deposit_delta?: number;
  /** XP earned */
  xp_delta?:      number;
  /** Quests completed (daily + weekly + seasonal) */
  quest_delta?:   number;
}

/**
 * Records incremental activity for a user on the current calendar day.
 * Silently swallows errors so analytics never breaks the primary action.
 */
export async function recordDailyActivity(
  supabase: SupabaseClient,
  userId: string,
  deltas: ActivityDeltas = {}
): Promise<void> {
  try {
    const today = getUTCDateString();

    await supabase.rpc("upsert_daily_activity", {
      p_user_id:       userId,
      p_date:          today,
      p_app_opened:    deltas.app_opened    ?? false,
      p_deposit_delta: deltas.deposit_delta ?? 0,
      p_xp_delta:      deltas.xp_delta      ?? 0,
      p_quest_delta:   deltas.quest_delta   ?? 0,
    });
  } catch (err) {
    // Never propagate — daily activity recording is non-critical
    if (process.env.NODE_ENV === "development") {
      console.warn("[recordDailyActivity] error:", err);
    }
  }
}
