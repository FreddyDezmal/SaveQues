/**
 * lib/financialHealthSnapshot.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 28 — Phase 5/11: persistence for the Financial Health Score.
 *
 * Kept separate from lib/financialHealthScore.ts on purpose — that file is
 * the pure scoring function (Raw Data → Metrics → Insights layer); this
 * file is the I/O layer (Presentation-adjacent persistence) that reads a
 * user's real data, calls the pure function, and writes one row. Same
 * split lib/digest.ts (pure digest shape) vs lib/notifications.ts
 * (runWeeklySummaryScheduler, which fetches + writes) already established
 * — this follows that precedent rather than inventing a new one.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { computeFinancialHealthScore } from "@/lib/financialHealthScore";
import { getUTCDateString } from "@/lib/dateUtils";
import { createLogger } from "@/lib/logger";

const log = createLogger("financialHealthSnapshot");

export interface FinancialHealthSnapshotRunResult {
  processed: number;
  written: number;
  errors: number;
}

/**
 * Writes today's financial_health_score_snapshots row for every user with
 * at least one deposit on record. Users with zero deposits are skipped —
 * a "score" for someone with no savings history yet isn't a meaningful
 * data point to trend, and computeAccountHealth's own neutral defaults
 * (used internally by computeFinancialHealthScore) would otherwise write
 * the same flat ~50 score for every brand-new user, which is noise, not
 * signal, on a trend chart.
 *
 * Idempotent: (user_id, date) is unique (migration 067) and this upserts,
 * so re-running the same day's cron twice (or a manual backfill re-run)
 * is safe.
 */
export async function runFinancialHealthSnapshotScheduler(now: Date = new Date()): Promise<FinancialHealthSnapshotRunResult> {
  const supabase = createServiceClient();
  const today = getUTCDateString(now);

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id");

  if (error || !profiles) {
    log.error("Failed to fetch profiles", { action: "fetch_profiles", error: error?.message ?? String(error) });
    return { processed: 0, written: 0, errors: 1 };
  }

  let written = 0;
  let errors = 0;

  for (const { id: userId } of profiles as { id: string }[]) {
    try {
      const [{ data: transactions }, { data: goals }, { data: activity }] = await Promise.all([
        supabase.from("transactions").select("id, user_id, goal_id, amount, note, transaction_type, created_at").eq("user_id", userId),
        supabase.from("savings_goals").select("id, user_id, title, category, target_amount, current_amount, target_date, is_complete, is_primary, is_active, goal_status, completed_at, created_at, goal_emoji").eq("user_id", userId),
        supabase.from("activity_log").select("activity_date, xp_earned").eq("user_id", userId),
      ]);

      // Skip users with no deposit history — see function docstring.
      const hasDeposit = (transactions ?? []).some((t: any) => t.transaction_type === "deposit" && Number(t.amount) > 0);
      if (!hasDeposit) continue;

      const result = computeFinancialHealthScore({
        transactions: (transactions ?? []) as any,
        goals: (goals ?? []) as any,
        activityLog: (activity ?? []).map((a: any) => ({ date: a.activity_date, xp_earned: a.xp_earned })),
        now,
      });

      const { error: upsertError } = await supabase
        .from("financial_health_score_snapshots")
        .upsert(
          {
            user_id: userId,
            date: today,
            score: result.score,
            tier: result.tier,
            factors: result.factors,
          },
          { onConflict: "user_id,date" }
        );

      if (upsertError) {
        errors += 1;
        log.error("Failed to write snapshot", { action: "upsert_snapshot", userId, error: upsertError.message });
        continue;
      }

      written += 1;
    } catch (err) {
      errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      log.error("Unhandled error computing/writing snapshot", { action: "process_user", userId, error: message });
    }
  }

  return { processed: (profiles as any[]).length, written, errors };
}
