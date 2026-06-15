import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getLevelFromXP, getXPForAction } from "@/lib/xp";
import { getAlmostMessages } from "@/lib/achievements";
import { isStreakPaused } from "@/lib/streaks";
import DashboardClient from "./DashboardClient";
import { QUEST_CHAINS } from "@/lib/quests";
import { getEventsForUser } from "@/lib/events";
import { fetchTimelineEvents } from "@/lib/timeline";
import { getUTCDateString } from "@/lib/dateUtils";

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

  // Record app open for notification timing (fire-and-forget, no await)
  supabase.rpc("record_app_open", { p_user_id: user.id }).then(() => {});

  // Evaluate streak — skip if paused
  const today = getUTCDateString();
  const streakCurrentlyPaused = isStreakPaused(profile.streak_paused_until);

  if (profile.last_active_date !== today && !streakCurrentlyPaused) {
    const lastDate = profile.last_active_date;
    const diff = lastDate
      ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000)
      : 999;
    let newStreak = profile.streak_days;

    if (diff === 1) {
      newStreak = profile.streak_days + 1;
    } else if (diff === 2 && (profile.streak_shields ?? 0) > 0) {
      // Grace day absorbs the missed day
      newStreak = profile.streak_days + 1;
    } else if (diff > 1) {
      newStreak = 1;
    }

    const usedShield     = diff === 2 && (profile.streak_shields ?? 0) > 0;
    const newShields     = usedShield ? (profile.streak_shields ?? 0) - 1 : (profile.streak_shields ?? 0);
    const newShieldsUsed = usedShield ? (profile.total_shields_used ?? 0) + 1 : (profile.total_shields_used ?? 0);
    const longestStreak  = Math.max(newStreak, profile.longest_streak ?? 0);

    // update_streak() is SECURITY DEFINER — bypasses the hardened RLS on
    // streak_days and related columns. Direct .update() is no longer allowed
    // since those columns are now protected from browser writes.
    await supabase.rpc("update_streak", {
      p_user_id:      user.id,
      p_today:        today,
      p_new_streak:   newStreak,
      p_longest:      longestStreak,
      p_shields:      newShields,
      p_shields_used: newShieldsUsed,
    });
    profile.streak_days      = newStreak;
    profile.last_active_date = today;

    // ── Day Momentum fix: record the daily check-in ──────────────
    // This block runs at most once per UTC calendar day per user
    // (gated by last_active_date !== today above). It both logs an
    // activity_log entry for today (so the check-in counts toward
    // momentum, even if the user does nothing else) and awards the
    // DAILY_CHECKIN XP exactly once per day via the idempotent
    // record_checkin() RPC.
    const checkinXP = getXPForAction("DAILY_CHECKIN", newStreak);
    const { data: checkinResult } = await supabase.rpc("record_checkin", {
      p_user_id: user.id,
      p_date:    today,
      p_xp:      checkinXP,
    });
    const checkinXpAwarded = (checkinResult as { xp_awarded?: number } | null)?.xp_awarded ?? 0;
    if (checkinXpAwarded > 0) {
      profile.xp_total = (profile.xp_total ?? 0) + checkinXpAwarded;
    }
  }

  const goals = goalsRes.data ?? [];
  const allAchievementIds = (achievementsRes.data ?? []).map((a: any) => a.achievement_id);
  const recentAchievementsData = (achievementsRes.data ?? []).map((a: any) => ({
    achievement_id: a.achievement_id,
    earned_at:      a.earned_at,
  }));
  const levelInfo = getLevelFromXP(profile.xp_total);
  const totalSaved = goals.reduce((sum: number, g: any) => sum + Number(g.current_amount), 0);
  const activeGoals = goals.filter((g: any) => !g.is_complete);
  const completedGoals = goals.filter((g: any) => g.is_complete);

  // User experience stage — drives progressive dashboard disclosure
  const userStage = getUserStage(profile.created_at);

  // "Almost" messages — only show for building/established users
  const almostMessages = userStage !== "new"
    ? getAlmostMessages({
        streakDays: profile.streak_days,
        totalSaved,
        goalsCompleted: completedGoals.length,
        challengesCompleted: (activeChallengesRes.data ?? []).filter((uc: any) => uc.status === "completed").length,
        dailyQuestsCompleted: profile.daily_quests_completed ?? 0,
        earnedIds: allAchievementIds,
      })
    : [];

  // Active quest chain for dashboard nudge — only building/established
  const chainProgress = chainProgressRes.data ?? [];
  const activeChain = userStage !== "new"
    ? (chainProgress.find((c: any) => c.status === "active") ?? null)
    : null;

  // Events for this user's region — shown on dashboard for building/established users
  const dashboardEvents = userStage !== "new"
    ? getEventsForUser(profile.country_code ?? "ZA").slice(0, 3)
    : [];

  // Timeline preview — shown for building/established users
  const timelinePreview = userStage !== "new"
    ? await fetchTimelineEvents(supabase, user.id, { limit: 5 })
    : [];

  // Comeback detection — streak is 1 but they had a longer one before
  const streakBroken =
    profile.streak_days === 1 &&
    (profile.longest_streak ?? 0) > 3 &&
    profile.last_active_date === today;

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
