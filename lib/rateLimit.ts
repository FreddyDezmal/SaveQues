/**
 * lib/rateLimit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight, database-backed rate limiting. No Redis, no external
 * infrastructure — uses the same Postgres database the app already talks to.
 *
 * DESIGN
 *   Counts rows in an existing table within a rolling time window, using an
 *   indexed query. This is intentionally simple: at beta/low-thousands scale,
 *   one extra indexed COUNT query per write is cheap and avoids introducing
 *   a new dependency (Upstash, Redis) before it's actually needed.
 *
 *   This is NOT a generic rate limiter — it counts rows in a specific table
 *   (transactions, daily_quest_logs, etc.) rather than maintaining a separate
 *   counter table. This means it only works for endpoints that already write
 *   a row per request, which covers every endpoint this sprint requires.
 *
 * MIGRATION TO REDIS
 *   When request volume makes an extra COUNT query per write too expensive
 *   (roughly 10,000+ users with frequent writes), swap this module's
 *   internals for Upstash's sliding-window rate limiter. The call signature
 *   below (`checkRateLimit(...)`) is designed to stay the same so callers
 *   in route handlers do not need to change.
 *
 * USAGE
 *   const limit = await checkRateLimit(supabase, {
 *     table:        "transactions",
 *     userId:       user.id,
 *     windowMinutes: 60,
 *     maxRequests:  60,
 *   });
 *   if (!limit.allowed) {
 *     return NextResponse.json({ error: limit.message }, { status: 429 });
 *   }
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface RateLimitConfig {
  /** Table to count rows in. Must have a `user_id` and `created_at` column. */
  table: string;
  userId: string;
  windowMinutes: number;
  maxRequests: number;
  /**
   * Optional human-readable label used in the friendly error message.
   * Defaults to "requests".
   */
  actionLabel?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  message?: string;
}

/**
 * Checks whether the user has exceeded `maxRequests` within the last
 * `windowMinutes` for the given table, using an indexed COUNT query.
 *
 * IMPORTANT: this counts existing rows BEFORE the current request's insert.
 * Call this before inserting, so a user at exactly the limit is blocked
 * rather than allowed to slip one row over.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const { table, userId, windowMinutes, maxRequests, actionLabel = "requests" } = config;

  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", windowStart);

  // Fail OPEN on a counting error — a rate limit check that itself errors
  // should never be the reason a legitimate user's request is blocked.
  // The underlying write still goes through normal validation/RLS.
  if (error) {
    return { allowed: true, count: 0, limit: maxRequests };
  }

  const currentCount = count ?? 0;

  if (currentCount >= maxRequests) {
    return {
      allowed: false,
      count:   currentCount,
      limit:   maxRequests,
      message: `You've made too many ${actionLabel} recently. Please wait a bit before trying again.`,
    };
  }

  return { allowed: true, count: currentCount, limit: maxRequests };
}

// ─────────────────────────────────────────────────────────────────────────────
// Attempt-based rate limiting (for idempotent endpoints)
// ─────────────────────────────────────────────────────────────────────────────

export interface AttemptRateLimitConfig {
  userId: string;
  /** Logical endpoint name, e.g. "quest.daily.complete". Used as a label
   *  in the rate_limit_attempts table so different endpoints don't share
   *  a counter. */
  endpoint: string;
  windowMinutes: number;
  maxRequests: number;
  actionLabel?: string;
}

/**
 * Rate-limits by REQUEST ATTEMPT rather than by rows written to a business
 * table. Use this for endpoints backed by an idempotent DB function (like
 * complete_daily_quest()) where a spamming client can call the endpoint
 * repeatedly without ever creating more than one business-data row — so
 * counting that table would never detect the spam.
 *
 * Writes one row to rate_limit_attempts per call, regardless of outcome.
 * Call this BEFORE the business logic runs, and record the attempt
 * whether or not the underlying action ultimately succeeds.
 */
export async function checkAttemptRateLimit(
  supabase: SupabaseClient,
  config: AttemptRateLimitConfig
): Promise<RateLimitResult> {
  const { userId, endpoint, windowMinutes, maxRequests, actionLabel = "requests" } = config;

  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("rate_limit_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("endpoint", endpoint)
    .gte("created_at", windowStart);

  // Fail OPEN on a counting error — see checkRateLimit() for rationale.
  if (error) {
    return { allowed: true, count: 0, limit: maxRequests };
  }

  const currentCount = count ?? 0;

  if (currentCount >= maxRequests) {
    return {
      allowed: false,
      count:   currentCount,
      limit:   maxRequests,
      message: `You've made too many ${actionLabel} recently. Please wait a bit before trying again.`,
    };
  }

  return { allowed: true, count: currentCount, limit: maxRequests };
}

/**
 * Records a single rate-limit attempt row. Fire-and-forget is acceptable
 * here — if this insert fails, the worst case is the rate limit undercounts
 * for one request, which fails open (the safe direction).
 */
export async function recordAttempt(
  supabase: SupabaseClient,
  userId: string,
  endpoint: string
): Promise<void> {
  await supabase.from("rate_limit_attempts").insert({ user_id: userId, endpoint });
}