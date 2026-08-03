"use client";

/**
 * components/insights/PremiumCoachingCard.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 30 — Phase 7: Premium Coaching.
 *
 * AUDIT NOTE: lib/coaching.ts (Sprint 19) is rule-based, not generative
 * (see that file's own header) — this sprint does not add a second
 * coaching engine, an LLM call, or any new message templates. Every
 * caller of generateCoachingMessages()/coachingMessagesForGoal() already
 * computes the FULL ranked list; it was just under-surfaced:
 *   - components/insights/IntelligencePanel.tsx only ever shows
 *     `topCoachingMessage` (index 0) — the other messages in
 *     intelligence.coachingMessages sat computed and unused.
 *   - components/goals/GoalIntelligenceCard.tsx shows indices 0-2
 *     (topCoaching + .slice(1,3)) — anything beyond that was discarded.
 * This component is purely a display extension of what's already free:
 * it takes the SAME array, skips the count already shown for free
 * (`alreadyFreeCount`), and unlocks the remainder for premium — free
 * users keep exactly what they already had, nothing removed or reduced.
 *
 * Gated by `ai_coaching` (migration 069 — seeded premium-only, never
 * previously checked anywhere; same "seeded but unenforced" pattern as
 * scenarios_limit/exports_limit found in earlier phases).
 *
 * "Trend explanation" (per the Sprint 30 Phase 7 brief) reuses
 * BehaviorProfile.explanation (lib/behaviorProfile.ts) — already computed,
 * already free-visible in BehaviorInsights — passed in as `trendExplanation`
 * purely for context alongside the coaching list, not gated a second time.
 *
 * NOT built here, and why: "action plans" in the brief's literal sense
 * (step-by-step generated plans) would mean new copy-generation logic —
 * exactly what "no duplicate coaching engine" rules out. The closest
 * existing equivalent, lib/interventions.ts's Intervention objects
 * (title/reason/evidence/expectedBenefit), already exists AND is already
 * shown in full, uncapped, to every user via BehaviorInsights — so there
 * was nothing ungated left to add there. See this sprint's summary for
 * the full reasoning.
 */

import { useRouter } from "next/navigation";
import { useFeatureEntitlement } from "@/lib/hooks/useFeatureEntitlement";
import LockedCard from "@/components/billing/LockedCard";
import type { CoachingMessage } from "@/lib/coaching";

interface Props {
  /** The FULL ranked coaching list — same array a free surface already renders a prefix of. */
  messages: CoachingMessage[];
  /** How many of `messages` (from the front) are already shown for free elsewhere on this page. */
  alreadyFreeCount: number;
  /** Optional goalId → title lookup, for messages tied to a specific goal (overview contexts only — goal-detail context already knows which goal it's on). */
  goalTitles?: Record<string, string>;
  /** BehaviorProfile.explanation — already-computed, already free-visible elsewhere; shown here only as context for the coaching list, not as new gated content. */
  trendExplanation?: string | null;
}

export default function PremiumCoachingCard({ messages, alreadyFreeCount, goalTitles, trendExplanation }: Props) {
  const router = useRouter();
  const { entitled } = useFeatureEntitlement("ai_coaching");

  const remaining = messages.slice(alreadyFreeCount);
  if (remaining.length === 0) return null;

  const focus = messages[0];

  const body = (
    <>
      <h2 id="premium-coaching-heading" className="text-sm font-semibold text-white/90 mb-1">Your coaching plan</h2>
      {focus && (
        <p className="text-xs text-white/45 mb-3">
          This week's focus: <span className="text-white/70">{focus.message}</span>
        </p>
      )}
      {trendExplanation && (
        <p className="text-xs text-white/45 mb-3">{trendExplanation}</p>
      )}
      <ul className="space-y-2">
        {remaining.map((m) => (
          <li key={m.id} className="text-sm text-white/80">
            {m.goalId && goalTitles?.[m.goalId] && (
              <span className="text-white/40">{goalTitles[m.goalId]}: </span>
            )}
            {m.message}
          </li>
        ))}
      </ul>
    </>
  );

  if (entitled) {
    return (
      <section className="card p-4 mb-4" aria-labelledby="premium-coaching-heading">
        {body}
      </section>
    );
  }

  return (
    <LockedCard
      title="Your coaching plan"
      description={`See ${remaining.length} more personalized coaching insight${remaining.length === 1 ? "" : "s"}, not just the top one.`}
      onUpgradeClick={() => router.push("/settings/billing")}
      className="mb-4"
    >
      {body}
    </LockedCard>
  );
}
