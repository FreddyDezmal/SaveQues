/**
 * lib/experiments.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 24 (Product Intelligence Platform) — Phase 5: Experimentation.
 *
 * Reuses bucketPercentage() from lib/featureFlags.ts rather than
 * reimplementing FNV-1a hashing a second time — same deterministic-
 * bucketing need, just applied twice per experiment (once to decide IF a
 * user is in the experiment's traffic allocation, once to decide WHICH
 * variant) with different salts so those two decisions aren't
 * correlated with each other (see assignVariant()'s docstring) or with
 * this same user's feature-flag rollout bucketing for a flag that
 * happens to share the same key string.
 *
 * PERSISTENCE MODEL
 *   Assignment is looked up first (experiment_assignments, migration
 *   060), and only computed + written on a genuine first evaluation.
 *   Once written, RLS (migration 060) makes the row un-updatable by the
 *   user it belongs to — "assignment persistence" from the brief is
 *   enforced at the database layer, not just by this code choosing to
 *   check first. See getOrCreateAssignment()'s race-handling comment for
 *   what happens when two requests both hit "no assignment yet" at once.
 *
 * METRIC COLLECTION
 *   This file does not send analytics events itself — per the brief's
 *   "Experiments must reuse the event system," that's the caller's job
 *   via the EXISTING lib/analytics.ts / lib/analytics-server.ts
 *   (trackEvent / trackServerEvent), e.g. firing an "Experiment Viewed"
 *   event with { experiment_key, variant_id } right after calling
 *   getExperimentAssignments(). Duplicating an event-sending call here
 *   would be a second, parallel path to the same PostHog project.
 */

import { createClient } from "@/lib/supabase/server";
import { bucketPercentage } from "@/lib/featureFlags";

export interface ExperimentVariant {
  id: string;
  name: string;
  /** Relative weight, not required to sum to 100 across all variants — see validateVariants(). */
  weight: number;
}

export interface ExperimentRow {
  key: string;
  name: string;
  status: "draft" | "running" | "completed" | "archived";
  variants: ExperimentVariant[];
  traffic_allocation_percentage: number;
}

export interface ExperimentAssignmentRow {
  experiment_key: string;
  user_id: string;
  variant_id: string;
  assigned_at: string;
}

/** Returns an error message if `variants` isn't usable, or null if it's fine. Used by the admin create/update routes so a malformed experiment can't be saved. */
export function validateVariants(variants: unknown): string | null {
  if (!Array.isArray(variants) || variants.length < 2) return "An experiment needs at least 2 variants";
  const ids = new Set<string>();
  for (const v of variants) {
    if (!v || typeof v !== "object") return "Each variant must be an object";
    const { id, name, weight } = v as Partial<ExperimentVariant>;
    if (!id || typeof id !== "string") return "Each variant needs a string id";
    if (ids.has(id)) return `Duplicate variant id "${id}"`;
    ids.add(id);
    if (!name || typeof name !== "string") return "Each variant needs a name";
    if (typeof weight !== "number" || weight <= 0) return `Variant "${id}" needs a positive weight`;
  }
  return null;
}

/**
 * Deterministic weighted variant pick. Two independent bucket()
 * calls with different salted keys:
 *   ":traffic" — is this user even in the experiment at all (vs. the
 *                excluded portion implied by traffic_allocation_percentage)
 *   ":variant" — which variant, weighted by each variant's share of
 *                total weight
 * Using the SAME hash for both would mean a user just inside the traffic
 * cutoff and a user just inside a variant's weight band are correlated
 * with each other in a way that has nothing to do with either
 * assignment individually — two salts keep them independent.
 *
 * Returns null if the user falls outside the traffic allocation (not
 * part of this experiment at all) or if variants is empty/invalid.
 */
export function assignVariant(
  experimentKey: string,
  userId: string,
  variants: ExperimentVariant[],
  trafficAllocationPercentage: number
): string | null {
  if (variants.length === 0) return null;

  const trafficBucket = bucketPercentage(userId, `${experimentKey}:traffic`);
  if (trafficBucket >= trafficAllocationPercentage) return null; // excluded from the experiment entirely

  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  if (totalWeight <= 0) return null;

  const variantBucket = bucketPercentage(userId, `${experimentKey}:variant`) / 100; // [0, 1)
  let cumulative = 0;
  for (const v of variants) {
    cumulative += v.weight / totalWeight;
    if (variantBucket < cumulative) return v.id;
  }
  return variants[variants.length - 1].id; // floating-point safety net
}

/**
 * Looks up this user's persisted assignment for one experiment, or
 * computes + persists a new one on first evaluation. Never reassigns —
 * if a row already exists, its variant_id is returned unchanged even if
 * the experiment's variants/weights have since been edited by an admin
 * (changing weights only affects users assigned AFTER the edit).
 *
 * Uses the CALLER'S session client (RLS-respecting), matching
 * lib/featureFlags.ts's getEvaluatedFlags() — a user creating their own
 * assignment row is exactly what the migration 060 INSERT policy allows,
 * no elevated privilege needed.
 */
export async function getOrCreateAssignment(
  supabase: ReturnType<typeof createClient>,
  experiment: ExperimentRow,
  userId: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("experiment_assignments")
    .select("variant_id")
    .eq("experiment_key", experiment.key)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) return existing.variant_id;

  const variantId = assignVariant(experiment.key, userId, experiment.variants, experiment.traffic_allocation_percentage);
  if (variantId === null) return null; // excluded from traffic allocation — nothing to persist

  const { error } = await supabase
    .from("experiment_assignments")
    .insert({ experiment_key: experiment.key, user_id: userId, variant_id: variantId });

  if (error) {
    // 23505 = unique_violation: another concurrent request for this same
    // user won the race and inserted first (two requests can both see
    // "no existing assignment" before either has written one). That's
    // not a failure — it means an assignment now exists; re-read it so
    // this request returns the SAME variant the other one persisted,
    // rather than the value it computed itself (which, being
    // deterministic from the same inputs, should already match — but
    // reading the actual row is the source of truth, not an assumption).
    if (error.code === "23505") {
      const { data: winner } = await supabase
        .from("experiment_assignments")
        .select("variant_id")
        .eq("experiment_key", experiment.key)
        .eq("user_id", userId)
        .maybeSingle();
      return winner?.variant_id ?? variantId;
    }
    // Any other error: still return the computed variant so the user's
    // *experience* is consistent within this request even though it
    // couldn't be persisted — the next request will just recompute the
    // same deterministic value and try to persist again.
    return variantId;
  }

  return variantId;
}

/**
 * Evaluates every RUNNING experiment for a user, returning
 * { [experimentKey]: variantId }. Excluded/draft/completed/archived
 * experiments are omitted entirely rather than included with a null
 * variant, so callers can do a simple `if (key in assignments)` check.
 * Never throws — same fail-closed philosophy as lib/featureFlags.ts.
 */
export async function getExperimentAssignments(userId: string): Promise<Record<string, string>> {
  const supabase = createClient();

  const { data: experiments, error } = await supabase
    .from("experiments")
    .select("key, name, status, variants, traffic_allocation_percentage")
    .eq("status", "running");

  if (error || !experiments) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[experiments] Failed to load experiments:", error?.message);
    }
    return {};
  }

  const result: Record<string, string> = {};
  const assignments = await Promise.all(
    (experiments as ExperimentRow[]).map(async (exp) => ({ key: exp.key, variantId: await getOrCreateAssignment(supabase, exp, userId) }))
  );
  for (const a of assignments) {
    if (a.variantId !== null) result[a.key] = a.variantId;
  }
  return result;
}