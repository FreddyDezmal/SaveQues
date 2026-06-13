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
 * USAGE
 *   await recordDailyActivity(supabase, userId, {
 *     deposit_delta: 1,
 *     xp_delta:      150,
 *   });
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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
    const today = new Date().toISOString().split("T")[0];

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
