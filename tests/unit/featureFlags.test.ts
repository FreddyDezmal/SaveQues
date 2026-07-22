/**
 * tests/unit/featureFlags.test.ts
 *
 * Sprint 24 — Phase 4. Tests the pure evaluation logic in
 * lib/featureFlags.ts: bucketing determinism/distribution and the
 * override > environment > kill-switch > rollout precedence chain.
 * Does NOT test getEvaluatedFlags()/isFeatureEnabled() — those are thin
 * Supabase-fetching wrappers with no logic of their own beyond calling
 * evaluateFlag(), and would need a real/mocked DB connection to test
 * meaningfully. See the TODO stub at the bottom for that integration gap.
 */
import { describe, it, expect } from "vitest";
import { bucketPercentage, evaluateFlag, type FeatureFlagRow, type FeatureFlagOverrideRow } from "@/lib/featureFlags";

function makeFlag(overrides: Partial<FeatureFlagRow> = {}): FeatureFlagRow {
  return {
    key: "ai_coach",
    name: "AI Coach",
    description: null,
    is_enabled: true,
    rollout_percentage: 100,
    enabled_environments: [],
    ...overrides,
  };
}

describe("bucketPercentage", () => {
  it("is deterministic for the same identifier + flag key", () => {
    const a = bucketPercentage("user-123", "ai_coach");
    const b = bucketPercentage("user-123", "ai_coach");
    expect(a).toBe(b);
  });

  it("returns a value in [0, 100)", () => {
    for (const id of ["a", "user-1", "00000000-0000-0000-0000-000000000000", "🙂", ""]) {
      const v = bucketPercentage(id, "some_flag");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
    }
  });

  it("gives different flags independent buckets for the same user", () => {
    // Not a strict guarantee for every possible pair, but for these two
    // concrete keys the hash should not coincidentally match — this
    // guards against a bug where flagKey is ignored in the hash input.
    const a = bucketPercentage("user-123", "flag_a");
    const b = bucketPercentage("user-123", "flag_b");
    expect(a).not.toBe(b);
  });

  it("distributes roughly uniformly across a sample of ids (sanity check, not a strict statistical test)", () => {
    let below50 = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (bucketPercentage(`user-${i}`, "distribution_check") < 50) below50 += 1;
    }
    const ratio = below50 / n;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });
});

describe("evaluateFlag — precedence", () => {
  it("a per-user override wins even when the flag's kill switch is off", () => {
    const flag = makeFlag({ is_enabled: false });
    const override: FeatureFlagOverrideRow = { flag_key: "ai_coach", user_id: "u1", is_enabled: true, reason: "QA" };
    expect(evaluateFlag(flag, { userId: "u1", override })).toBe(true);
  });

  it("a per-user override can also force a flag OFF even at 100% rollout", () => {
    const flag = makeFlag({ is_enabled: true, rollout_percentage: 100 });
    const override: FeatureFlagOverrideRow = { flag_key: "ai_coach", user_id: "u1", is_enabled: false, reason: "broken for this account" };
    expect(evaluateFlag(flag, { userId: "u1", override })).toBe(false);
  });

  it("environment override forces on even when the kill switch is off", () => {
    const flag = makeFlag({ is_enabled: false, enabled_environments: ["development"] });
    expect(evaluateFlag(flag, { userId: "u1", environment: "development" })).toBe(true);
  });

  it("environment override does not apply outside the listed environments", () => {
    const flag = makeFlag({ is_enabled: false, enabled_environments: ["development"] });
    expect(evaluateFlag(flag, { userId: "u1", environment: "production" })).toBe(false);
  });

  it("is_enabled = false is a hard kill switch regardless of rollout_percentage", () => {
    const flag = makeFlag({ is_enabled: false, rollout_percentage: 100 });
    expect(evaluateFlag(flag, { userId: "u1" })).toBe(false);
  });

  it("rollout_percentage = 100 is on for everyone (no hashing needed)", () => {
    const flag = makeFlag({ is_enabled: true, rollout_percentage: 100 });
    for (const id of ["u1", "u2", "u3"]) {
      expect(evaluateFlag(flag, { userId: id })).toBe(true);
    }
  });

  it("rollout_percentage = 0 is off for everyone, even with is_enabled = true", () => {
    const flag = makeFlag({ is_enabled: true, rollout_percentage: 0 });
    expect(evaluateFlag(flag, { userId: "u1" })).toBe(false);
  });

  it("mid-range rollout is consistent for the same user across repeated calls", () => {
    const flag = makeFlag({ is_enabled: true, rollout_percentage: 50 });
    const first = evaluateFlag(flag, { userId: "stable-user" });
    for (let i = 0; i < 5; i++) {
      expect(evaluateFlag(flag, { userId: "stable-user" })).toBe(first);
    }
  });

  it("anonymous users (no userId) stay off for a partial rollout, never randomly flip", () => {
    const flag = makeFlag({ is_enabled: true, rollout_percentage: 50 });
    expect(evaluateFlag(flag, { userId: null })).toBe(false);
    expect(evaluateFlag(flag, {})).toBe(false);
  });

  it("anonymous users still get a full (100%) rollout", () => {
    const flag = makeFlag({ is_enabled: true, rollout_percentage: 100 });
    expect(evaluateFlag(flag, { userId: null })).toBe(true);
  });

  it("ignores an override row for a different flag key (defensive — caller should pre-filter, but evaluateFlag should not trust it blindly)", () => {
    const flag = makeFlag({ key: "ai_coach", is_enabled: false });
    const mismatchedOverride: FeatureFlagOverrideRow = { flag_key: "premium", user_id: "u1", is_enabled: true, reason: null };
    expect(evaluateFlag(flag, { userId: "u1", override: mismatchedOverride })).toBe(false);
  });
});

// ── Integration gap (honest, not fabricated) ───────────────────────────────
// TODO(integration): getEvaluatedFlags() and isFeatureEnabled() query
// Supabase directly via lib/supabase/server.ts's createClient(). Testing
// them meaningfully needs either a real Supabase test project or a
// mocked PostgrestClient — neither is wired up in this test file. The
// pure evaluateFlag()/bucketPercentage() logic above covers the actual
// decision-making; the DB-fetching wrappers are intentionally thin
// (fetch flags + own overrides, build a Map, call evaluateFlag() per
// row) so the risk they carry beyond what's tested here is low, but it
// is real and untested — flagging rather than claiming coverage that
// doesn't exist.