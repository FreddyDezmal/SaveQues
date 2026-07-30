/**
 * app/(app)/portfolio/page.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 20 — Phase 10: Portfolio Dashboard.
 *
 * A new, standalone "premium overview" route — additive, not a dashboard
 * redesign (the brief is explicit that the dashboard itself should only
 * be reordered, not rebuilt; this is a separate page for the fuller
 * lifetime view). Reuses the exact same query pattern already established
 * in app/(app)/goals/[id]/page.tsx (parallel Promise.all fetches, RLS via
 * .eq("user_id", user.id)) rather than inventing a new one, and computes
 * everything via lib/portfolioSummary.ts — no new statistics here.
 *
 * Sprint 28.5 — Phase 5: now also calls lib/intelligence/getFinancialIntelligence
 * (the new orchestrator) for two things this page genuinely didn't have —
 * a portfolio-wide cash-flow/quarter projection and a recommended next
 * goal. See the comment above that call below for what was deliberately
 * left out (financialHealthScore's 6-tier score) and why.
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { buildPortfolioSummary } from "@/lib/portfolioSummary";
import { getFinancialIntelligence } from "@/lib/intelligence/getFinancialIntelligence";
import PortfolioClient from "./PortfolioClient";
import type { SavingsGoal, Transaction } from "@/lib/types";

export default async function PortfolioPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Sprint 28.5 — Phase 5: goal select widened from a hand-picked column
  // list to "*", matching the pattern already used in
  // app/(app)/goals/[id]/page.tsx. Needed because
  // computeCategoryIntelligence (called via getFinancialIntelligence
  // below) reads the full savings_goals row shape (category, goal_emoji,
  // goal_status, etc.) — the previous narrower select only carried the
  // five columns buildPortfolioSummary happened to need.
  const [profileRes, goalsRes, txRes, achievementsRes, activityRes] = await Promise.all([
    supabase.from("profiles").select("xp_total, streak_days, longest_streak, currency_code, locale").eq("id", user.id).single(),
    supabase.from("savings_goals").select("*").eq("user_id", user.id),
    supabase.from("transactions").select("id, user_id, goal_id, amount, note, transaction_type, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("user_achievements").select("achievement_id, earned_at").eq("user_id", user.id),
    supabase.from("activity_log").select("activity_date, xp_earned, actions_count").eq("user_id", user.id),
  ]);

  const profile = profileRes.data ?? { xp_total: 0, streak_days: 0, longest_streak: 0, currency_code: "ZAR", locale: "en-ZA" };
  const goals = (goalsRes.data ?? []) as SavingsGoal[];
  const transactions = (txRes.data ?? []) as Transaction[];
  const achievements = achievementsRes.data ?? [];
  const activityLog = (activityRes.data ?? []).map((a: any) => ({
    date: a.activity_date,
    xp_earned: a.xp_earned,
    actions_count: a.actions_count,
  }));

  const summary = buildPortfolioSummary({
    transactions,
    goals,
    achievements,
    activityLog,
    profile: { xp_total: profile.xp_total ?? 0, streak_days: profile.streak_days ?? 0, longest_streak: profile.longest_streak ?? 0 },
  });

  // Sprint 28.5 — Phase 5: portfolio-wide intelligence, via the new
  // orchestrator rather than a fourth hand-rolled assembly of the same
  // modules (dashboard/page.tsx wires these up separately, and until now
  // nothing else did). Adds two things this page genuinely didn't have:
  // a portfolio-wide (not per-goal) cash-flow/quarter projection, and a
  // recommended-next-goal — lib/recommendations.ts had zero UI callers
  // anywhere in the app before this (see Phase 1 audit). Deliberately
  // NOT re-showing financialHealthScore's 6-tier score here: this page
  // already renders accountHealth's 4-band score above
  // (`summary.healthScore`), and financialHealthScore.ts's own module
  // comment is explicit that it's a distinct, additive surface — showing
  // both on the same page would be exactly the "adding information that
  // creates clutter" the Phase 1 audit was asked to watch for.
  const intelligence = getFinancialIntelligence({
    transactions,
    goals,
    activityLog,
    profile: {
      streak_days: profile.streak_days ?? 0,
      longest_streak: profile.longest_streak ?? 0,
      currency_code: profile.currency_code ?? "ZAR",
      locale: profile.locale ?? "en-ZA",
    },
  });

  return (
    <PortfolioClient
      summary={summary}
      currencyCode={profile.currency_code ?? "ZAR"}
      locale={profile.locale ?? "en-ZA"}
      cashFlow={intelligence.cashFlow}
      topRecommendation={intelligence.topRecommendation}
    />
  );
}
