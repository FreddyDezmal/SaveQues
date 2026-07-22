/**
 * tests/unit/experiments.test.ts
 * Sprint 24 — Phase 5: Experimentation. Tests the pure logic only
 * (assignVariant, validateVariants) — getOrCreateAssignment() and
 * getExperimentAssignments() are thin Supabase-fetching wrappers, same
 * honest integration-gap note as tests/unit/featureFlags.test.ts.
 */
import { describe, it, expect } from "vitest";
import { assignVariant, validateVariants, type ExperimentVariant } from "@/lib/experiments";

const TWO_VARIANTS: ExperimentVariant[] = [
  { id: "control", name: "Control", weight: 1 },
  { id: "treatment", name: "Treatment", weight: 1 },
];

describe("validateVariants", () => {
  it("rejects fewer than 2 variants", () => {
    expect(validateVariants([{ id: "a", name: "A", weight: 1 }])).toMatch(/at least 2/);
  });
  it("rejects a duplicate id", () => {
    expect(validateVariants([{ id: "a", name: "A", weight: 1 }, { id: "a", name: "B", weight: 1 }])).toMatch(/Duplicate/);
  });
  it("rejects a non-positive weight", () => {
    expect(validateVariants([{ id: "a", name: "A", weight: 0 }, { id: "b", name: "B", weight: 1 }])).toMatch(/positive weight/);
  });
  it("accepts a valid pair", () => {
    expect(validateVariants(TWO_VARIANTS)).toBeNull();
  });
});

describe("assignVariant", () => {
  it("is deterministic for the same user + experiment", () => {
    const a = assignVariant("exp_a", "user-1", TWO_VARIANTS, 100);
    const b = assignVariant("exp_a", "user-1", TWO_VARIANTS, 100);
    expect(a).toBe(b);
  });

  it("always returns a valid variant id when traffic allocation is 100%", () => {
    for (const id of ["u1", "u2", "u3", "u4", "u5"]) {
      const v = assignVariant("exp_a", id, TWO_VARIANTS, 100);
      expect(["control", "treatment"]).toContain(v);
    }
  });

  it("returns null (excluded) for everyone when traffic allocation is 0%", () => {
    for (const id of ["u1", "u2", "u3"]) {
      expect(assignVariant("exp_a", id, TWO_VARIANTS, 0)).toBeNull();
    }
  });

  it("returns null when there are no variants", () => {
    expect(assignVariant("exp_a", "u1", [], 100)).toBeNull();
  });

  it("distributes across variants roughly proportional to weight (sanity check, not a strict statistical test)", () => {
    const weighted: ExperimentVariant[] = [{ id: "a", name: "A", weight: 1 }, { id: "b", name: "B", weight: 3 }];
    let bCount = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (assignVariant("weighted_exp", `user-${i}`, weighted, 100) === "b") bCount += 1;
    }
    const ratio = bCount / n; // expect ~0.75
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(0.85);
  });

  it("traffic-allocation exclusion and variant choice are not correlated with each other (different salts)", () => {
    // At 50% traffic allocation, among the users who ARE included, variant
    // distribution should still be roughly balanced — not skewed toward
    // one variant just because the traffic-allocation hash and the
    // variant hash used the same input.
    let treatmentCount = 0;
    let includedCount = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const v = assignVariant("salt_check", `user-${i}`, TWO_VARIANTS, 50);
      if (v !== null) {
        includedCount += 1;
        if (v === "treatment") treatmentCount += 1;
      }
    }
    expect(includedCount / n).toBeGreaterThan(0.4);
    expect(includedCount / n).toBeLessThan(0.6);
    const treatmentRatio = treatmentCount / includedCount;
    expect(treatmentRatio).toBeGreaterThan(0.4);
    expect(treatmentRatio).toBeLessThan(0.6);
  });

  it("a different experiment key gives the same user an independent assignment", () => {
    // Not guaranteed different for every possible pair, but for these two
    // concrete keys it shouldn't coincidentally match every time across a
    // sample — guards against a bug where experimentKey is ignored.
    let sameCount = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      const a = assignVariant("exp_x", `user-${i}`, TWO_VARIANTS, 100);
      const b = assignVariant("exp_y", `user-${i}`, TWO_VARIANTS, 100);
      if (a === b) sameCount += 1;
    }
    expect(sameCount).toBeLessThan(n); // not literally every single one matches
  });
});

// TODO(integration): getOrCreateAssignment() and getExperimentAssignments()
// need a real/mocked Supabase connection to test meaningfully — same
// honest gap as lib/featureFlags.ts's getEvaluatedFlags(). The pure
// bucketing/weighting logic above is what's covered here.
