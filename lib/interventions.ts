/**
 * lib/interventions.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 21 — Phase 5: Intervention Engine.
 *
 * Combines lib/riskEngine.ts + lib/behaviorProfile.ts + lib/accountHealth.ts
 * (Sprint 20) + lib/momentum.ts + lib/coaching.ts (Sprint 19) into a small
 * set of next-step suggestions. Every intervention names its reason, the
 * evidence behind it, and the expected benefit — never a bare directive.
 *
 * Tone rules (enforced by construction, matching lib/coaching.ts's house
 * rules from Sprint 19): no shame, no guilt, no invented urgency. A
 * declining-consistency user gets "here's an easier version of the goal,"
 * never "you're failing."
 */

import type { BehavioralRisk, InterventionType } from "@/lib/riskEngine";
import type { BehaviorProfile } from "@/lib/behaviorProfile";
import type { AccountHealth } from "@/lib/accountHealth";
import type { CoachingMessage } from "@/lib/coaching";

export interface Intervention {
  type: InterventionType;
  title: string;
  reason: string;
  evidence: string;
  expectedBenefit: string;
  priority: number; // higher = show first
}

export interface InterventionInputs {
  behaviorProfile: BehaviorProfile;
  risk: BehavioralRisk;
  accountHealth: AccountHealth;
  coachingMessages: CoachingMessage[];
}

/**
 * Builds 0-3 interventions, highest priority first. Deliberately caps at 3
 * — the point of an intervention system is a small, actionable nudge, not
 * a wall of suggestions. Returns an empty array when there isn't enough
 * evidence (`risk.hasEnoughData === false`) rather than guessing.
 */
export function generateInterventions(inputs: InterventionInputs): Intervention[] {
  const { risk, accountHealth, behaviorProfile } = inputs;
  if (!risk.hasEnoughData) return [];

  const interventions: Intervention[] = [];

  // ── Streak recovery ───────────────────────────────────────────────────
  const collapsingFactor = risk.factors.find((f) => f.name === "Collapsing streak" && f.triggered);
  const abandonmentFactor = risk.factors.find((f) => f.name === "Abandonment risk" && f.triggered);
  if (collapsingFactor || abandonmentFactor) {
    interventions.push({
      type: "streak_recovery",
      title: "Ease back in",
      reason: "A gap in saving activity was detected, and gaps are the single easiest thing to recover from with one small deposit.",
      evidence: (collapsingFactor ?? abandonmentFactor)!.explanation,
      expectedBenefit: "One deposit — any size — restarts momentum and is usually enough to rebuild the habit within a week or two.",
      priority: 100,
    });
  }

  // ── Smaller deposit suggestion ─────────────────────────────────────────
  const fatigueFactor = risk.factors.find((f) => f.name === "Saving fatigue" && f.triggered);
  if (fatigueFactor) {
    interventions.push({
      type: "smaller_deposit_suggestion",
      title: "Try a smaller amount",
      reason: "Recent deposits have been noticeably smaller than earlier ones — sizing the next one down further can keep the habit alive without the pressure of matching past deposits.",
      evidence: fatigueFactor.explanation,
      expectedBenefit: "Removes the pressure to match past deposit sizes, which is often what causes a saving habit to quietly stop.",
      priority: 80,
    });
  }

  // ── Easier weekly goal ───────────────────────────────────────────────
  const inactivityFactor = risk.factors.find((f) => f.name === "Inactivity" && f.triggered);
  if (inactivityFactor && !collapsingFactor && !abandonmentFactor) {
    interventions.push({
      type: "easier_weekly_goal",
      title: "Scale down this week's target",
      reason: "Activity has slowed from this user's usual rhythm — a smaller, more achievable weekly target rebuilds confidence before scaling back up.",
      evidence: inactivityFactor.explanation,
      expectedBenefit: "A weekly target that's easy to hit right now is more motivating than one that already feels out of reach.",
      priority: 60,
    });
  }

  // ── Challenge adjustment ─────────────────────────────────────────────
  const decliningFactor = risk.factors.find((f) => f.name === "Declining consistency" && f.triggered);
  const rapidDecreaseFactor = risk.factors.find((f) => f.name === "Rapidly decreasing deposits" && f.triggered);
  if ((decliningFactor || rapidDecreaseFactor) && interventions.length < 3) {
    interventions.push({
      type: "challenge_adjustment",
      title: "Adjust this week's challenge",
      reason: "The current saving trend suggests the existing weekly challenge may be calibrated to an earlier, stronger pace.",
      evidence: (decliningFactor ?? rapidDecreaseFactor)!.explanation,
      expectedBenefit: "A challenge sized to the current pace is achievable, which keeps the reward loop working instead of reinforcing a miss.",
      priority: 50,
    });
  }

  // ── Target extension (from account-level forecast reliability) ───────
  const forecastFactor = accountHealth.factors.find((f) => f.name === "Forecast reliability");
  if (forecastFactor && forecastFactor.maxPoints > 0 && forecastFactor.points / forecastFactor.maxPoints < 0.5 && interventions.length < 3) {
    interventions.push({
      type: "target_extension",
      title: "Consider extending a target date",
      reason: "Some goals with a target date are currently behind the pace needed to hit it.",
      evidence: forecastFactor.explanation,
      expectedBenefit: "Extending a target date to match actual pace turns a goal that feels like it's failing into one that's realistically on track.",
      priority: 40,
    });
  }

  // ── Motivational celebration ──────────────────────────────────────────
  if (interventions.length === 0 && risk.riskScore === 0) {
    interventions.push({
      type: "motivational_celebration",
      title: "Keep the momentum going",
      reason: `No risk signals detected, and the current behavioral profile is "${behaviorProfile.profile}."`,
      evidence: `Risk score 0/100; behavioral profile confidence ${Math.round(behaviorProfile.confidence * 100)}%.`,
      expectedBenefit: "Recognizing a strong pattern while it's happening reinforces it — this is the best time to celebrate progress, not just react to problems.",
      priority: 10,
    });
  }

  return interventions.sort((a, b) => b.priority - a.priority).slice(0, 3);
}
