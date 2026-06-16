import { createClient }        from "@/lib/supabase/server";
import { redirect }            from "next/navigation";
import { getLevelFromXP, getXPForAction } from "@/lib/xp";
import { getAlmostMessages }   from "@/lib/achievements";
import { isStreakPaused, STREAK_MILESTONES } from "@/lib/streaks";
import DashboardClient         from "./DashboardClient";
import { QUEST_CHAINS }        from "@/lib/quests";
import { getEventsForUser }    from "@/lib/events";
import { fetchTimelineEvents } from "@/lib/timeline";
import { getUTCDateString }    from "@/lib/dateUtils";
import { checkAndAwardAchievements } from "@/lib/awardXP";

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
interface StreakUpdateResult {
  updated:     boolean;
  reason:      "already_updated_today" | "paused" | "continued" | "started" | "grace_day" | "broken";
  streak_days: number;
  longest:     number;
  shields:     number;
  grace_used:  boolean;
  broken:      boolean;
  paused:      boolean;
}

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [
    profileRes, goalsRes, activeChallengesRes, achievementsRes,
    activityRes, dailyQuestRes, chainProgressRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("savings_goals").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("user_challenges").select("*, challenges(*)").eq("user_id", user.id).eq("status", "active"),
    supabase.from("user_achievements").select("achievement_id, earned_at").eq("user_id", user.id).order("earned_at", { ascending: false }).limit(5),
    supabase.from("activity_log").select("*").eq("user_id", user.id).gte("activity_date", getUTCDateString(new Date(Date.now() - 30 * 86400000))),
    supabase.from("daily_quest_logs").select("quest_id, quest_date").eq("user_id", user.id).eq("quest_date", getUTCDateString()).maybeSingle(),
    supabase.from("quest_chain_progress").select("chain_id, current_step, status").eq("user_id", user.id),
  ]);

  const profile = profileRes.data;
  if (!profile) redirect("/auth/login");

  // Record app open for notification timing (fire-and-forget)
  supabase.rpc("record_app_open", { p_user_id: user.id }).then(() => {});

  const streakCurrentlyPaused = isStreakPaused(profile.streak_paused_until);

  // ── M2: Streak update — DB computes everything ─────────────
  // update_streak() reads last_active_date, streak_days, shields, and
  // paused state from the profile row and applies all transition logic.
  // We supply only identity (p_user_id defaults to auth.uid()).
  // No caller-computed values cross the RPC boundary.
  if (profile.last_active_date !== getUTCDateString() && !streakCurrentlyPaused) {
    const { data: streakRaw } = await supabase.rpc("update_streak", {
      p_user_id: user.id,
    });
    const streakResult = streakRaw as StreakUpdateResult | null;

    if (streakResult?.updated) {
      // Reflect DB-computed values into the profile object so the rest
      // of the Server Component sees the correct state without a re-fetch.
      profile.streak_days        = streakResult.streak_days;
      profile.longest_streak     = streakResult.longest;
      profile.streak_shields     = streakResult.shields;
      profile.last_active_date   = getUTCDateString();

      // ── Check-in XP ──────────────────────────────────────
      // record_checkin() is idempotent (source_id = today's date).
      // XP is still computed server-side from the DB-authoritative
      // streak_days value returned by update_streak.
      const checkinXP = getXPForAction("DAILY_CHECKIN", streakResult.streak_days);
      const { data: checkinResult } = await supabase.rpc("record_checkin", {
        p_user_id: user.id,
        p_date:    getUTCDateString(),
        p_xp:      checkinXP,
      });
      const checkinXpAwarded = (checkinResult as { xp_awarded?: number } | null)?.xp_awarded ?? 0;
      if (checkinXpAwarded > 0) {
        profile.xp_total = (profile.xp_total ?? 0) + checkinXpAwarded;
      }

      // ── Streak achievement check ──────────────────────────
      // Only run if the streak actually changed (skip if already_updated_today).
      const [earnedRes, chainRes, weeklyRes] = await Promise.all([
        supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id),
        supabase.from("quest_chain_progress").select("id").eq("user_id", user.id).eq("status", "completed"),
        supabase.from("user_weekly_quests").select("id").eq("user_id", user.id).eq("status", "completed"),
      ]);

      await checkAndAwardAchievements(user.id, {
        streakDays:            streakResult.streak_days,
        totalSaved:            0,   // not needed for streak achievements
        goalsCompleted:        0,
        activeGoals:           0,
        challengesCompleted:   0,
        dailyQuestsCompleted:  profile.daily_quests_completed ?? 0,
        weeklyQuestsCompleted: weeklyRes.data?.length ?? 0,
        questChainsCompleted:  chainRes.data?.length ?? 0,
        earnedIds:             (earnedRes.data ?? []).map((a: any) => a.achievement_id),
      });

      // ── Shield use achievement ────────────────────────────
      if (streakResult.grace_used) {
        const { data: shieldEarned } = await supabase
          .from("user_achievements")
          .select("achievement_id")
          .eq("user_id", user.id)
          .eq("achievement_id", "streak_shield_use")
          .maybeSingle();

        if (!shieldEarned) {
          await supabase.rpc("award_achievement", {
            p_user_id:        user.id,
            p_achievement_id: "streak_shield_use",
            p_xp:             50,
          });
        }
      }
    }
  }

  const goals           = goalsRes.data ?? [];
  const allAchievementIds = (achievementsRes.data ?? []).map((a: any) => a.achievement_id);
  const recentAchievementsData = (achievementsRes.data ?? []).map((a: any) => ({
    achievement_id: a.achievement_id,
    earned_at:      a.earned_at,
  }));
  const levelInfo       = getLevelFromXP(profile.xp_total);
  const totalSaved      = goals.reduce((sum: number, g: any) => sum + Number(g.current_amount), 0);
  const activeGoals     = goals.filter((g: any) => !g.is_complete);
  const completedGoals  = goals.filter((g: any) => g.is_complete);
  const userStage       = getUserStage(profile.created_at);

  const almostMessages = userStage !== "new"
    ? getAlmostMessages({
        streakDays:          profile.streak_days,
        totalSaved,
        goalsCompleted:      completedGoals.length,
        challengesCompleted: (activeChallengesRes.data ?? []).filter((uc: any) => uc.status === "completed").length,
        dailyQuestsCompleted: profile.daily_quests_completed ?? 0,
        earnedIds:           allAchievementIds,
      })
    : [];

  const chainProgress = chainProgressRes.data ?? [];
  const activeChain   = userStage !== "new"
    ? (chainProgress.find((c: any) => c.status === "active") ?? null)
    : null;

  const dashboardEvents = userStage !== "new"
    ? getEventsForUser(profile.country_code ?? "ZA").slice(0, 3)
    : [];

  const timelinePreview = userStage !== "new"
    ? await fetchTimelineEvents(supabase, user.id, { limit: 5 })
    : [];

  const streakBroken =
    profile.streak_days === 1 &&
    (profile.longest_streak ?? 0) > 3 &&
    profile.last_active_date === getUTCDateString();

  return (
    <DashboardClient
      profile={profile}
      levelInfo={levelInfo}
      totalSaved={totalSaved}
      activeGoals={activeGoals}
      completedGoals={completedGoals}
      activeChallenges={activeChallengesRes.data ?? []}
      recentAchievements={allAchievementIds}
      recentAchievementsData={recentAchievementsData}
      activityLog={activityRes.data ?? []}
      dailyQuestCompletedToday={!!dailyQuestRes.data}
      todayQuestId={dailyQuestRes.data?.quest_id}
      almostMessages={almostMessages}
      activeChain={activeChain}
      streakBroken={streakBroken}
      userStage={userStage}
      streakPaused={streakCurrentlyPaused}
      streakPausedUntil={profile.streak_paused_until ?? null}
      dashboardEvents={dashboardEvents}
      timelinePreview={timelinePreview}
    />
  );
}
