import { createClient }        from "@/lib/supabase/server";
import { redirect }            from "next/navigation";
import { getLevelFromXP }      from "@/lib/xp";
import { getAlmostMessages }   from "@/lib/achievements";
import { isStreakPaused }      from "@/lib/streaks";
import DashboardClient         from "./DashboardClient";
import { getEventsForUser }    from "@/lib/events";
import { getUTCDateString }    from "@/lib/dateUtils";
import { createLogger }        from "@/lib/logger";

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
    // Fall back to login if profile is missing; otherwise let Next.js
    // surface the error through its normal error boundary.
    redirect("/auth/login");
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

  // Timeline preview is now returned directly by the RPC (no extra round-trip)
  const timelinePreview = userStage !== "new"
    ? (dash.timeline_preview ?? [])
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
    />
  );
}