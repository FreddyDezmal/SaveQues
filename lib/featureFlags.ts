/**
 * lib/featureFlags.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 24 (Product Intelligence Platform) — Phase 4: Feature Flags.
 *
 * Audit note: grepped the codebase before writing this — there is no
 * existing feature-flag system anywhere (lib/, components/, providers/).
 * This is new infrastructure, built to match the conventions already
 * established by lib/analytics.ts (provider-agnostic, never throws,
 * server+client safe) and lib/adminAudit.ts (admin writes go through
 * requireAdmin() + the service-role client, never direct RLS-guarded
 * writes from authenticated sessions).
 *
 * DESIGN
 *   • evaluateFlag() is a pure function — no I/O, no Date.now(), no
 *     env reads — so it's trivially unit-testable and safe to run on
 *     the client, server, or edge. All the impure bits (reading rows
 *     from Supabase, reading process.env) live in the thin wrapper
 *     functions below it.
 *   • Bucketing is a plain FNV-1a hash rather than crypto.subtle or
 *     Node's `crypto` module, deliberately — this needs to run
 *     identically in the browser, in a Next.js server action, and in
 *     an edge middleware without worrying about runtime availability.
 *   • Never throws. A flag lookup failure (network error, missing row)
 *     always resolves to `false` rather than crashing a render — same
 *     "analytics/flags must never break the product" philosophy as
 *     lib/analytics.ts's trackEvent().
 *
 * EVALUATION PRECEDENCE (highest wins):
 *   1. Per-user override (feature_flag_overrides) — always wins, on or off.
 *   2. enabled_environments — force-on if the current deploy environment
 *      is listed, regardless of rollout.
 *   3. is_enabled = false — hard kill switch, off for everyone.
 *   4. rollout_percentage — deterministic bucket(user_id, flag_key)
 *      compared against the percentage. 100 = everyone, 0 = no one
 *      (short-circuited without hashing).
 */

import { createClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────

export interface FeatureFlagRow {
  key: string;
  name: string;
  description: string | null;
  is_enabled: boolean;
  rollout_percentage: number;
  enabled_environments: string[];
}

export interface FeatureFlagOverrideRow {
  flag_key: string;
  user_id: string;
  is_enabled: boolean;
  reason: string | null;
}

// ── Deterministic bucketing ──────────────────────────────────

/**
 * FNV-1a 32-bit hash, normalised to [0, 100). Deterministic: the same
 * (identifier, flagKey) pair always lands in the same bucket, so a user
 * doesn't flicker between "in" and "out" of a rollout across requests —
 * the single most common feature-flag bug in ad-hoc `Math.random()`
 * implementations.
 */
export function bucketPercentage(identifier: string, flagKey: string): number {
  const input = `${flagKey}:${identifier}`;
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime multiplication, done with shifts to stay in int32 range
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  // Unsigned 32-bit, then normalise to a [0, 100) float.
  const unsigned = hash >>> 0;
  return (unsigned / 0xffffffff) * 100;
}

// ── Pure evaluation ───────────────────────────────────────────

export interface EvaluateFlagOptions {
  /** Stable identifier for bucketing — the user id. Null/undefined = anonymous. */
  userId?: string | null;
  /** Current deploy environment, e.g. "development" | "preview" | "production". */
  environment?: string | null;
  /** This user's override row for this flag, if any (look up by flag_key + user_id before calling). */
  override?: FeatureFlagOverrideRow | null;
}

/** Pure evaluation — see file header for precedence rules. */
export function evaluateFlag(flag: FeatureFlagRow, opts: EvaluateFlagOptions = {}): boolean {
  // 1. Per-user override always wins.
  if (opts.override && opts.override.flag_key === flag.key) {
    return opts.override.is_enabled;
  }

  // 2. Environment override forces on.
  if (opts.environment && flag.enabled_environments.includes(opts.environment)) {
    return true;
  }

  // 3. Master kill switch.
  if (!flag.is_enabled) return false;

  // 4. Rollout percentage.
  if (flag.rollout_percentage >= 100) return true;
  if (flag.rollout_percentage <= 0) return false;

  // Anonymous users can't be bucketed consistently (no stable id across
  // requests), so anything short of a full rollout stays off for them
  // rather than re-randomising on every request.
  if (!opts.userId) return false;

  return bucketPercentage(opts.userId, flag.key) < flag.rollout_percentage;
}

// ── Current environment ──────────────────────────────────────

/**
 * Vercel sets VERCEL_ENV to "development" | "preview" | "production" at
 * build/runtime — more precise than NODE_ENV (which is "production" for
 * both preview and production deploys on Vercel). Falls back to NODE_ENV
 * for non-Vercel environments (local dev without `vercel dev`, CI, tests).
 */
export function getCurrentEnvironment(): string {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}

// ── Server data-fetch helpers ────────────────────────────────

/**
 * Evaluates every flag for a given user (or anonymous, if userId is
 * omitted). Uses the CALLER'S session client, not the service-role
 * client — RLS already allows any authenticated user to read all of
 * feature_flags and their own feature_flag_overrides rows (migration
 * 059), so no elevated privilege is needed just to evaluate flags.
 *
 * Never throws: a Supabase error resolves to every flag defaulting to
 * `false` rather than breaking the page that called this.
 */
export async function getEvaluatedFlags(userId?: string | null): Promise<Record<string, boolean>> {
  const supabase = createClient();

  const [{ data: flags, error: flagsError }, overridesResult] = await Promise.all([
    supabase.from("feature_flags").select("key, is_enabled, rollout_percentage, enabled_environments"),
    userId
      ? supabase.from("feature_flag_overrides").select("flag_key, user_id, is_enabled, reason").eq("user_id", userId)
      : Promise.resolve({ data: [] as FeatureFlagOverrideRow[], error: null }),
  ]);

  if (flagsError || !flags) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[featureFlags] Failed to load feature_flags:", flagsError?.message);
    }
    return {};
  }

  const overridesByKey = new Map<string, FeatureFlagOverrideRow>(
    (overridesResult.data ?? []).map((o: FeatureFlagOverrideRow) => [o.flag_key, o])
  );

  const environment = getCurrentEnvironment();
  const result: Record<string, boolean> = {};
  for (const flag of flags as FeatureFlagRow[]) {
    result[flag.key] = evaluateFlag(flag, {
      userId,
      environment,
      override: overridesByKey.get(flag.key) ?? null,
    });
  }
  return result;
}

/**
 * Evaluates a single flag by key. Convenience wrapper around
 * getEvaluatedFlags() for server code (API routes, server components)
 * that only cares about one flag — e.g. `if (await isFeatureEnabled("ai_coach", user.id)) ...`.
 * Prefer getEvaluatedFlags() when checking more than one flag in the
 * same request to avoid redundant round-trips.
 */
export async function isFeatureEnabled(flagKey: string, userId?: string | null): Promise<boolean> {
  const flags = await getEvaluatedFlags(userId);
  return flags[flagKey] ?? false;
}