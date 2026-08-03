/**
 * tests/component/BehaviorInsights.test.tsx
 * Sprint 21 — Phase 10 (component).
 * Sprint 30 — Phase 8: explainability audit fix.
 *
 * No test previously existed for this component. Added specifically to
 * lock in the Phase 8 fix: the expanded "Recommended focus" list used to
 * show only `expectedBenefit` for every intervention past the first —
 * answering "what to do" but not "why" — while the top intervention (shown
 * unconditionally, collapsed) already showed `reason`. Both now match.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BehaviorInsights from "@/components/behavior/BehaviorInsights";
import type { HabitProfile } from "@/lib/habits";
import type { BehaviorProfile } from "@/lib/behaviorProfile";
import type { BehavioralRisk } from "@/lib/riskEngine";
import type { Intervention } from "@/lib/interventions";

const habits: HabitProfile = {
  habitScore: 72,
  habitScoreExplanation: "Based on consistency and rhythm.",
  depositRhythm: { type: "weekly", confidence: 0.8 } as any,
  strongestSavingDay: { day: "Friday", count: 6 },
  strongestSavingHour: null,
  preferredSavingWindow: "evening" as any,
  skippedWeekCount: 1,
  consistencyTrend: "improving" as any,
  habitStability: 65,
  hasEnoughData: true,
};

const behaviorProfile: BehaviorProfile = {
  profile: "Disciplined Saver",
  confidence: 0.7,
  explanation: "You've saved consistently most weeks over the last two months.",
  supportingMetrics: {},
};

const risk: BehavioralRisk = {
  riskScore: 20,
  riskLevel: "low",
  factors: [],
  confidence: 0.7,
  recommendedInterventionType: "none" as any,
  hasEnoughData: true,
};

const interventions: Intervention[] = [
  {
    type: "increase_frequency" as any,
    title: "Save a little more often",
    reason: "Your deposits have slowed to about once every two weeks.",
    evidence: "3 deposits in the last 6 weeks.",
    expectedBenefit: "Could reach your goal about 3 weeks sooner.",
    priority: 9,
  },
  {
    type: "smaller_goal" as any,
    title: "Try a smaller milestone",
    reason: "Your current goal is large relative to your typical deposit size.",
    evidence: "Average deposit is 4% of the target amount.",
    expectedBenefit: "Smaller milestones tend to keep momentum going.",
    priority: 6,
  },
];

describe("BehaviorInsights", () => {
  it("renders nothing when there isn't enough data", () => {
    const { container } = render(
      <BehaviorInsights
        habits={{ ...habits, hasEnoughData: false }}
        behaviorProfile={behaviorProfile}
        risk={risk}
        interventions={[]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the top intervention's reason unconditionally, collapsed", () => {
    render(<BehaviorInsights habits={habits} behaviorProfile={behaviorProfile} risk={risk} interventions={interventions} />);
    expect(screen.getByText(/slowed to about once every two weeks/i)).toBeInTheDocument();
  });

  it("shows every intervention's reason, not just the top one, once expanded (Sprint 30 Phase 8 fix)", async () => {
    const user = userEvent.setup();
    render(<BehaviorInsights habits={habits} behaviorProfile={behaviorProfile} risk={risk} interventions={interventions} />);

    await user.click(screen.getByRole("button", { name: /habit score/i }));

    // Both interventions' expectedBenefit (pre-existing behavior)...
    expect(screen.getByText(/reach your goal about 3 weeks sooner/i)).toBeInTheDocument();
    expect(screen.getByText(/smaller milestones tend to keep momentum going/i)).toBeInTheDocument();
    // ...and the second intervention's reason, which was previously dropped.
    expect(screen.getByText(/current goal is large relative to your typical deposit size/i)).toBeInTheDocument();
  });
});
