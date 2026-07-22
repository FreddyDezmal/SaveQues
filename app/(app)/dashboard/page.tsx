// app/(app)/dashboard/page.tsx

import { createClient }        from "@/lib/supabase/server";
import { redirect }            from "next/navigation";
import { getLevelFromXP }      from "@/lib/xp";
import { getAlmostMessages }   from "@/lib/achievements";
import { isStreakPaused }      from "@/lib/streaks";
import DashboardClient         from "./DashboardClient";
import { getEventsForUser }    from "@/lib/events";
import { getUTCDateString }    from "@/lib/dateUtils";
import { createLogger }        from "@/lib/logger";
import { generateInsights }    from "@/lib/insights";
import { buildWeeklyReview }   from "@/lib/weeklyReview";
import { generateCoachingMessages } from "@/lib/coaching";
import { classifyJourneyStage, getDashboardSectionOrder, getRiskAwareSectionOrder } from "@/lib/dashboardPersonalization";
import { computeHabitProfile } from "@/lib/habits";
import { computeBehaviorProfile } from "@/lib/behaviorProfile";
import { computeBehavioralRisk } from "@/lib/riskEngine";
import { generateInterventions } from "@/lib/interventions";
import { computeAccountHealth } from "@/lib/accountHealth";
import { computeCategoryIntelligence } from "@/lib/categoryIntelligence";
import type { Transaction }    from "@/lib/types";

// Sprint 12 audit fix: measure server-side render time so the dashboard
// P95 SLO (#5 in SLO_DEFINITIONS.md) is measurable from structured logs.
// Filter Vercel logs by service=dashboard and field duration_ms to track
// P95 over time. Searchable by user_id for per-user debugging.
const log = createLogger("dashboard");

// User experience stage — drives progressive dashboard disclosure
// new: 0–6 days  |  building: 7–29 days  |  established: 30+ days
function getUserStage(createdAt: string): "new" | "building" | "established" {
  const daysSince = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / 86400000
  );
  if (daysSince < 7)  return "new";
  if (daysSince < 30) return "building";
  return "established";
}

/**
 * M2: Result shape returned by the new server-side update_streak().
 * The DB now owns all progression arithmetic — the dashboard only
 * reads back what happened and reacts (UI messages, achievement checks).
 */

export default async function DashboardPage() {
  const pageStart = Date.now();
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // ── Sprint 13: Consolidated dashboard RPC ─────────────────────────────────
  // Previously: 17 database round-trips in the worst case (returning user,
  //   new day, new achievements). Confirmed by tracing dashboard/page.tsx and
  //   lib/timeline.ts — every table was hit 2-3 times across the main fetch,
  //   the conditional streak/achievement block, and fetchTimelineEvents.
  //
  // Now: 1 round-trip. get_dashboard_data() (migration 032) reads every table
  //   once, integrates the streak update and check-in XP award, assembles the
  //   timeline preview, and returns everything in a single JSONB response.
  //
  // Preserved exactly:
  //   - All business logic (streak update, check-in XP, achievement check)
  //     now runs inside the RPC using the same underlying RPCs
  //   - RLS: SECURITY DEFINER with auth.uid() = p_user_id guard
  //   - All props passed to DashboardClient unchanged
  //
  // record_app_open() is still called fire-and-forget (it updates the
  //   notification hour EMA and is intentionally separate from the main
  //   data fetch since it's a write, not a read).

  const { data: dashRaw, error: dashError } = await supabase.rpc(
    "get_dashboard_data",
    { p_user_id: user.id }
  );

  if (dashError || !dashRaw) {
    log.error("get_dashboard_data RPC failed", {
      user_id:    user.id,
      error:      dashError?.message ?? "null response",
      error_code: dashError?.code,
    });
    // For new users the profile row may not be ready yet (the handle_new_user
    // trigger and the dashboard load can race). Redirect to a loading page
    // that retries rather than throwing a Server Component error.
    if (dashError?.message?.includes("profile not found") || dashError?.code === "no_data_found") {
      redirect("/auth/setting-up");
    }
    // For all other RPC failures redirect to an error page — throwing here
    // produces an unrecoverable Server Component crash in production.
    redirect("/error?reason=dashboard_load_failed");
  }

  const dash = dashRaw as {
    profile:           any;
    goals:             any[];
    active_challenges: any[];
    achievements:      { achievement_id: string; earned_at: string }[];
    activity_log:      any[];
    today_quest:       { completed: boolean; quest_id: string | null };
    chain_progress:    any[];
    has_deposit:       boolean;
    timeline_preview:  any[];
  };

  // Record app open for notification timing (fire-and-forget — write, not read)
  supabase.rpc("record_app_open", { p_user_id: user.id }).then(() => {});

  const profile     = dash.profile;
  const goals       = dash.goals ?? [];
  const hasDeposit  = dash.has_deposit;

  const allAchievementIds    = (dash.achievements ?? []).map((a) => a.achievement_id);
  const recentAchievementsData = dash.achievements ?? [];
  const levelInfo            = getLevelFromXP(profile.xp_total);
  const totalSaved           = goals.reduce((sum: number, g: any) => sum + Number(g.current_amount), 0);
  const activeGoals          = goals.filter((g: any) => !g.is_complete);
  const completedGoals       = goals.filter((g: any) => g.is_complete);
  const userStage            = getUserStage(profile.created_at);
  const streakCurrentlyPaused = isStreakPaused(profile.streak_paused_until);

  // ── Sprint 19: Intelligence layer ──────────────────────────────────────
  // The dashboard RPC (032) intentionally does not return full transaction
  // history (it was scoped to the 5-event timeline preview only — see the
  // RPC's own comments). Insights/forecasting/coaching need the full
  // deposit history, so it's fetched here as one additional indexed query
  // (idx_transactions_user_created_at, migration 024/033 — already covers
  // this access pattern) rather than modifying the RPC and risking the
  // dashboard's existing single-round-trip guarantee for users who don't
  // need this data (new users skip the fetch entirely below).
  //
  // hasDeposit is already known false for brand-new users — skip the query
  // and every downstream computation for them rather than running an
  // analytics engine over an empty array.
  let insights: ReturnType<typeof generateInsights> = [];
  let weeklyReview: ReturnType<typeof buildWeeklyReview> | null = null;
  let topCoachingMessage: string | null = null;
  let depositCount = 0;
  // Sprint 21 — behavioral layer (Phases 2-5). Computed from the same
  // `transactions`/`activityLog` already fetched below for Sprint 19/20's
  // intelligence layer — no additional query.
  let habitProfile: ReturnType<typeof computeHabitProfile> | null = null;
  let behaviorProfile: ReturnType<typeof computeBehaviorProfile> | null = null;
  let behavioralRisk: ReturnType<typeof computeBehavioralRisk> | null = null;
  let interventions: ReturnType<typeof generateInterventions> = [];
  let categoryIntelligence: ReturnType<typeof computeCategoryIntelligence> | null = null;

  if (hasDeposit && userStage !== "new") {
    const { data: txData, error: txError } = await supabase
      .from("transactions")
      .select("id, user_id, goal_id, amount, note, transaction_type, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (txError) {
      log.error("intelligence layer: transaction fetch failed", { user_id: user.id, error: txError.message });
    } else {
      const transactions = (txData ?? []) as Transaction[];
      depositCount = transactions.filter((t) => t.transaction_type === "deposit").length;
      insights = generateInsights(transactions, {
        currencyCode: profile.currency_code ?? "ZAR",
        locale: profile.locale ?? "en-ZA",
      });
      weeklyReview = buildWeeklyReview({
        transactions,
        goals: goals.map((g: any) => ({ id: g.id, is_complete: g.is_complete })),
        achievements: dash.achievements ?? [],
        activityLog: (dash.activity_log ?? []).map((a: any) => ({
          date: a.date,
          xp_earned: a.xp_earned,
          actions_count: a.actions_count,
        })),
        profile: { streak_days: profile.streak_days, longest_streak: profile.longest_streak },
      });

      const transactionsByGoal: Record<string, Transaction[]> = {};
      for (const t of transactions) {
        (transactionsByGoal[t.goal_id] ??= []).push(t);
      }
      const coachingMessages = generateCoachingMessages({
        transactions,
        goals: activeGoals.map((g: any) => ({
          id: g.id,
          title: g.title,
          target_amount: g.target_amount,
          current_amount: g.current_amount,
          target_date: g.target_date,
          is_complete: g.is_complete,
        })),
        transactionsByGoal,
      });
      topCoachingMessage = coachingMessages[0]?.message ?? null;

      // ── Sprint 21: Phases 2-5 — habits, behavior profile, risk, interventions ──
      const activityLogForBehavior = (dash.activity_log ?? []).map((a: any) => ({
        date: a.date,
        xp_earned: a.xp_earned,
        actions_count: a.actions_count,
      }));
      habitProfile = computeHabitProfile(transactions);
      behaviorProfile = computeBehaviorProfile({
        transactions,
        goals: goals.map((g: any) => ({ id: g.id, is_complete: g.is_complete })),
        streakDays: profile.streak_days,
        longestStreak: profile.longest_streak,
      });
      behavioralRisk = computeBehavioralRisk({
        transactions,
        streakDays: profile.streak_days,
        longestStreak: profile.longest_streak,
      });
      const accountHealthForInterventions = computeAccountHealth({
        transactions,
        goals: goals.map((g: any) => ({
          id: g.id,
          target_amount: g.target_amount,
          current_amount: g.current_amount,
          target_date: g.target_date,
          is_complete: g.is_complete,
        })),
        activityLog: activityLogForBehavior,
      });
      interventions = generateInterventions({
        behaviorProfile,
        risk: behavioralRisk,
        accountHealth: accountHealthForInterventions,
        coachingMessages,
      });

      // ── Sprint 24: Phase 8 — Category Intelligence ─────────────────────
      // Reuses the same `goals`/`transactions` already loaded above for
      // insights/coaching — no separate fetch. Gated behind the same
      // hasDeposit/userStage check as the rest of the intelligence layer
      // for consistency, since a brand-new user has no per-category
      // savings behaviour to report yet.
      categoryIntelligence = computeCategoryIntelligence(goals, transactions);
    }
  }

  // ── Sprint 20: Phase 4 — Dynamic Dashboard ───────────────────────────────
  // Does not redesign the dashboard — only decides which of the
  // insights/coaching/weekly-review content (added in Sprint 19/20, all
  // inside IntelligencePanel) leads for this user. Core Sprint 18 sections
  // above (stat cards, goals, streak controls) are untouched and keep their
  // existing order and their existing 3-stage `getUserStage` gating.
  const accountAgeDays = Math.floor((Date.now() - new Date(profile.created_at).getTime()) / 86400000);
  const journeyStage = classifyJourneyStage({
    accountAgeDays,
    depositCount,
    completedGoalCount: completedGoals.length,
  });
  const intelligenceSectionOrder = behavioralRisk
    ? getRiskAwareSectionOrder(journeyStage, behavioralRisk.riskLevel)
    : getDashboardSectionOrder(journeyStage);

  const almostMessages = userStage !== "new"
    ? getAlmostMessages({
        streakDays:           profile.streak_days,
        totalSaved,
        goalsCompleted:       completedGoals.length,
        challengesCompleted:  (dash.active_challenges ?? []).filter((uc: any) => uc.status === "completed").length,
        dailyQuestsCompleted: profile.daily_quests_completed ?? 0,
        earnedIds:            allAchievementIds,
      })
    : [];

  const chainProgress = dash.chain_progress ?? [];
  const activeChain   = userStage !== "new"
    ? (chainProgress.find((c: any) => c.status === "active") ?? null)
    : null;

  const dashboardEvents = userStage !== "new"
    ? getEventsForUser(profile.country_code ?? "ZA").slice(0, 3)
    : [];

  // Timeline preview is now returned directly by the RPC (no extra round-trip).
  // The RPC returns a flat TimelineEvent[], but DashboardClient expects
  // TimelineEventGroup[] (events grouped by date). Group them here.
  const timelinePreview = userStage !== "new"
    ? (() => {
        const flatEvents: any[] = dash.timeline_preview ?? [];
        const grouped: Record<string, any[]> = {};
        for (const event of flatEvents) {
          const date = (event.timestamp as string).slice(0, 10); // "YYYY-MM-DD"
          if (!grouped[date]) grouped[date] = [];
          grouped[date].push(event);
        }
        return Object.entries(grouped)
          .sort(([a], [b]) => b.localeCompare(a)) // newest date first
          .map(([date, events]) => ({ date, events }));
      })()
    : [];

  const streakBroken =
    profile.streak_days === 1 &&
    (profile.longest_streak ?? 0) > 3 &&
    profile.last_active_date === getUTCDateString();

  // Sprint 12/13: structured timing log for P95 SLO measurement.
  log.info("dashboard rendered", {
    user_id:     user.id,
    duration_ms: Date.now() - pageStart,
    is_new_day:  profile.last_active_date !== getUTCDateString(),
    goal_count:  activeGoals.length,
    rpc_used:    "get_dashboard_data",
  });

  return (
    <DashboardClient
      profile={profile}
      levelInfo={levelInfo}
      totalSaved={totalSaved}
      activeGoals={activeGoals}
      completedGoals={completedGoals}
      activeChallenges={dash.active_challenges ?? []}
      recentAchievements={allAchievementIds}
      recentAchievementsData={recentAchievementsData}
      activityLog={dash.activity_log ?? []}
      dailyQuestCompletedToday={dash.today_quest?.completed ?? false}
      todayQuestId={dash.today_quest?.quest_id ?? undefined}
      almostMessages={almostMessages}
      activeChain={activeChain}
      streakBroken={streakBroken}
      userStage={userStage}
      streakPaused={streakCurrentlyPaused}
      streakPausedUntil={profile.streak_paused_until ?? null}
      dashboardEvents={dashboardEvents}
      timelinePreview={timelinePreview}
      hasDeposit={hasDeposit}
      notificationPromptDismissed={!!(profile as any).notification_prompt_dismissed}
      intelligence={{ insights, weeklyReview, topCoachingMessage, categoryIntelligence }}
      intelligenceSectionOrder={intelligenceSectionOrder}
      behavior={habitProfile && behaviorProfile && behavioralRisk ? { habits: habitProfile, behaviorProfile, risk: behavioralRisk, interventions } : null}
    />
  );
}