/**
 * lib/dashboardPersonalization.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 20 — Phase 4: Dynamic Dashboard.
 *
 * This does NOT redesign the dashboard (per the brief) — it only decides,
 * from real account-age + activity signals, which order the *intelligence*
 * sections (Sprint 19/20's insights/coaching/forecast/personality/trends
 * cards) should appear in. The dashboard's core sections (stat cards,
 * goals list, streak controls) are untouched and always render in their
 * existing Sprint 18 order.
 *
 * Deliberately a superset of the existing 3-stage `getUserStage()` in
 * app/(app)/dashboard/page.tsx (new/building/established), not a
 * replacement — that function also gates streak-grace UI and changing its
 * semantics would be a regression risk for something outside this sprint's
 * scope. `classifyJourneyStage()` here is a separate, dashboard-content-only
 * classification with the 4 stages the Sprint 20 brief asks for.
 */

export type JourneyStage = "new" | "growing" | "experienced" | "veteran";

export type DashboardSection =
  | "onboarding_prompts"
  | "weekly_review"
  | "coaching"
  | "goal_progress"
  | "forecasts"
  | "goal_health"
  | "financial_personality"
  | "insights"
  | "trends"
  | "monthly_comparisons"
  | "lifetime_achievements"
  | "milestone_timeline";

const SECTION_ORDER_BY_STAGE: Record<JourneyStage, DashboardSection[]> = {
  new: ["onboarding_prompts", "goal_progress"],
  growing: ["weekly_review", "coaching", "goal_progress", "insights"],
  experienced: ["forecasts", "goal_health", "financial_personality", "insights", "coaching", "weekly_review"],
  veteran: ["trends", "monthly_comparisons", "lifetime_achievements", "milestone_timeline", "forecasts", "goal_health"],
};

export interface JourneyStageInputs {
  accountAgeDays: number;
  depositCount: number;
  completedGoalCount: number;
}

/**
 * Classification rules (documented, not arbitrary):
 *   new          — account < 7 days old OR zero deposits yet.
 *   growing      — account < 30 days old, or fewer than 10 deposits and no
 *                  completed goals yet (still building the habit).
 *   experienced  — established habit: 30+ days old, 10+ deposits, but
 *                  fewer than 3 completed goals and < 90 days old.
 *   veteran      — 90+ days old AND (3+ completed goals OR 30+ deposits) —
 *                  enough lifetime history for trends/comparisons to be
 *                  meaningful rather than noisy.
 */
export function classifyJourneyStage(inputs: JourneyStageInputs): JourneyStage {
  const { accountAgeDays, depositCount, completedGoalCount } = inputs;

  if (accountAgeDays < 7 || depositCount === 0) return "new";

  if (accountAgeDays >= 90 && (completedGoalCount >= 3 || depositCount >= 30)) return "veteran";

  if (accountAgeDays < 30 || (depositCount < 10 && completedGoalCount === 0)) return "growing";

  return "experienced";
}

export function getDashboardSectionOrder(stage: JourneyStage): DashboardSection[] {
  return SECTION_ORDER_BY_STAGE[stage];
}
