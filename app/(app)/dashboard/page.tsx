import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getLevelFromXP } from "@/lib/xp";
import { getAlmostMessages } from "@/lib/achievements";
import { isStreakPaused } from "@/lib/streaks";
import { shouldShowReflection, getWeekStart } from "@/lib/reflection";
import { QUEST_CHAINS } from "@/lib/quests";
import DashboardClient from "./DashboardClient";

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
    reflectionRes, weekActivityRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("savings_goals").select("*").eq("user_id", user.id).order("is_primary", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("user_challenges").select("*, challenges(*)").eq("user_id", user.id).eq("status", "active"),
    supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id).order("earned_at", { ascending: false }).limit(5),
    supabase.from("activity_log").select("*").eq("user_id", user.id).gte("activity_date", new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]),
    supabase.from("daily_quest_logs").select("quest_id, quest_date").eq("user_id", user.id).eq("quest_date", new Date().toISOString().split("T")[0]).maybeSingle(),
    supabase.from("quest_chain_progress").select("chain_id, current_step, status").eq("user_id", user.id),
    // Most recent reflection — to know if we should show one
    supabase.from("weekly_reflections").select("*").eq("user_id", user.id).order("week_start", { ascending: false }).limit(1).maybeSingle(),
    // This week's transaction count for reflection data
    supabase.from("transactions").select("id").eq("user_id", user.id).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
  ]);

  const profile = profileRes.data;
  if (!profile) redirect("/auth/login");

  // Record app open for notification timing (fire-and-forget)
  supabase.rpc("record_app_open", { p_user_id: user.id }).then(() => {});

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

  // Primary goal — first by is_primary flag, then by most recently created
  const primaryGoal = goals.find((g: any) => g.is_primary && !g.is_complete)
    ?? activeGoals[0]
    ?? null;

  const userStage = getUserStage(profile.created_at);

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

  const chainProgress = chainProgressRes.data ?? [];
  const activeChain = userStage !== "new"
    ? (chainProgress.find((c: any) => c.status === "active") ?? null)
    : null;

  const streakBroken =
    profile.streak_days === 1 &&
    (profile.longest_streak ?? 0) > 3 &&
    profile.last_active_date === today;

  // ── Weekly reflection ─────────────────────────────────────────
  // Only show for established users (day 7+), once per week
  const lastReflection = reflectionRes.data;
  const showReflection =
    userStage !== "new" &&
    primaryGoal !== null &&
    shouldShowReflection(lastReflection?.viewed_at ?? null);

  // Build or upsert this week's reflection record if it doesn't exist
  let reflectionRecord = lastReflection?.week_start === getWeekStart() ? lastReflection : null;

  if (showReflection && !reflectionRecord && primaryGoal) {
    const primaryPercent = primaryGoal.target_amount > 0
      ? (Number(primaryGoal.current_amount) / Number(primaryGoal.target_amount)) * 100
      : 0;

    const weekActivityCount = await supabase
      .from("activity_log")
      .select("actions_count")
      .eq("user_id", user.id)
      .gte("activity_date", new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]);

    const thisWeekActions = (weekActivityCount.data ?? []).reduce((s: number, a: any) => s + a.actions_count, 0);

    const { data: newReflection } = await supabase
      .from("weekly_reflections")
      .upsert({
        user_id: user.id,
        week_start: getWeekStart(),
        savings_count: weekActivityRes.data?.length ?? 0,
        quests_completed: Math.max(0, thisWeekActions - (weekActivityRes.data?.length ?? 0)),
        streak_days: profile.streak_days,
        xp_earned: 0,
        primary_goal_pct: Math.round(primaryPercent),
      }, { onConflict: "user_id,week_start" })
      .select()
      .single();

    reflectionRecord = newReflection;
  }

  // Reflection data passed to client for modal rendering
  const reflectionData = showReflection && reflectionRecord && primaryGoal
    ? {
        id: reflectionRecord.id,
        displayName: profile.display_name,
        primaryGoalTitle: primaryGoal.title,
        primaryGoalPercent: Number(reflectionRecord.primary_goal_pct ?? 0),
        savingsCount: reflectionRecord.savings_count ?? 0,
        questsCompleted: reflectionRecord.quests_completed ?? 0,
        streakDays: profile.streak_days,
        streakGrew: (profile.streak_days ?? 0) > (reflectionRecord.streak_days ?? 0),
        xpEarned: reflectionRecord.xp_earned ?? 0,
        currencyCode: profile.currency_code ?? "ZAR",
        locale: profile.locale ?? "en-ZA",
      }
    : null;

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
      primaryGoal={primaryGoal}
      reflectionData={reflectionData}
    />
  );
}