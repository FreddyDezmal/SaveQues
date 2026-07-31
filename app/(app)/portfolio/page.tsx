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
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { buildPortfolioSummary } from "@/lib/portfolioSummary";
import { computeCategoryIntelligence } from "@/lib/categoryIntelligence";
import { projectCashFlow } from "@/lib/cashFlowProjection";
import { computePortfolioIntelligence } from "@/lib/portfolioIntelligence";
import PortfolioClient from "./PortfolioClient";
import type { Transaction } from "@/lib/types";

export default async function PortfolioPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [profileRes, goalsRes, txRes, achievementsRes, activityRes] = await Promise.all([
    supabase.from("profiles").select("xp_total, streak_days, longest_streak, currency_code, locale").eq("id", user.id).single(),
    supabase.from("savings_goals").select("id, title, category, target_amount, current_amount, target_date, is_complete").eq("user_id", user.id),
    supabase.from("transactions").select("id, user_id, goal_id, amount, note, transaction_type, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("user_achievements").select("achievement_id, earned_at").eq("user_id", user.id),
    supabase.from("activity_log").select("activity_date, xp_earned, actions_count").eq("user_id", user.id),
  ]);

  const profile = profileRes.data ?? { xp_total: 0, streak_days: 0, longest_streak: 0, currency_code: "ZAR", locale: "en-ZA" };
  const goals = goalsRes.data ?? [];
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

  // ── Sprint 28.5 — Phase 5: Portfolio Intelligence ──────────────────────
  // categoryIntelligence and cashFlow are computed here (not imported from
  // a shared bundle) because this page's fetch shape differs from the
  // dashboard's (no RPC, a plain goals/transactions select) — see
  // lib/intelligence/getFinancialIntelligence.ts's own docstring for why
  // it isn't reused across pages with different fetch shapes. Both are
  // passed into computePortfolioIntelligence() as inputs rather than
  // letting that module import and re-run them itself.
  const categoryIntelligence = computeCategoryIntelligence(goals as any, transactions);
  const cashFlow = projectCashFlow(
    transactions,
    goals.map((g: any) => ({ id: g.id, target_amount: g.target_amount, current_amount: g.current_amount, is_complete: g.is_complete }))
  );
  const portfolioIntelligence = computePortfolioIntelligence({
    goals,
    transactions,
    categoryIntelligence,
    cashFlow,
  });

  return (
    <PortfolioClient
      summary={summary}
      portfolioIntelligence={portfolioIntelligence}
      currencyCode={profile.currency_code ?? "ZAR"}
      locale={profile.locale ?? "en-ZA"}
    />
  );
}
