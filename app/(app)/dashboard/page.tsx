import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getLevelFromXP } from "@/lib/xp";
import { getAlmostMessages } from "@/lib/achievements";
import { isStreakPaused } from "@/lib/streaks";
import DashboardClient from "./DashboardClient";
import { QUEST_CHAINS } from "@/lib/quests";
import { getEventsForUser } from "@/lib/events";
import { fetchTimelineEvents } from "@/lib/timeline";

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
    supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id).order("earned_at", { ascending: false }).limit(5),
    supabase.from("activity_log").select("*").eq("user_id", user.id).gte("activity_date", new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]),
    supabase.from("daily_quest_logs").select("quest_id, quest_date").eq("user_id", user.id).eq("quest_date", new Date().toISOString().split("T")[0]).maybeSingle(),
    supabase.from("quest_chain_progress").select("chain_id, current_step, status").eq("user_id", user.id),
  ]);

  const profile = profileRes.data;
  if (!profile) redirect("/auth/login");

  // Record app open for notification timing (fire-and-forget, no await)
  supabase.rpc("record_app_open", { p_user_id: user.id }).then(() => {});

  // Evaluate streak — skip if paused
  const today = new Date().toISOString().split("T")[0];
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
      await supabase.from("profiles").update({
        streak_shields: (profile.streak_shields ?? 0) - 1,
        total_shields_used: (profile.total_shields_used ?? 0) + 1,
      }).eq("id", user.id);
    } else if (diff > 1) {
      newStreak = 1;
    }

    const longestStreak = Math.max(newStreak, profile.longest_streak ?? 0);
    await supabase.from("profiles").update({
      last_active_date: today,
      streak_days: newStreak,
      longest_streak: longestStreak,
    }).eq("id", user.id);
    profile.streak_days = newStreak;
    profile.last_active_date = today;
  }

  const goals = goalsRes.data ?? [];
  const allAchievementIds = (achievementsRes.data ?? []).map((a: any) => a.achievement_id);
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
