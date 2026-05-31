import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getLevelFromXP } from "@/lib/xp";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [profileRes, goalsRes, activeChallengesRes, achievementsRes, activityRes, dailyQuestRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("savings_goals").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("user_challenges").select("*, challenges(*)").eq("user_id", user.id).eq("status", "active"),
    supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id).order("earned_at", { ascending: false }).limit(5),
    supabase.from("activity_log").select("*").eq("user_id", user.id).gte("activity_date", new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]),
    supabase.from("daily_quest_logs").select("quest_id, quest_date").eq("user_id", user.id).eq("quest_date", new Date().toISOString().split("T")[0]).maybeSingle(),
  ]);

  const profile = profileRes.data;
  if (!profile) redirect("/auth/login");

  // Update streak on page load
  const today = new Date().toISOString().split("T")[0];
  if (profile.last_active_date !== today) {
    const lastDate = profile.last_active_date;
    const diff = lastDate ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000) : 999;
    let newStreak = profile.streak_days;

    if (diff === 1) {
      newStreak = profile.streak_days + 1;
    } else if (diff === 2 && (profile.streak_shields ?? 0) > 0) {
      // Use shield
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
  const levelInfo = getLevelFromXP(profile.xp_total);
  const totalSaved = goals.reduce((sum, g) => sum + Number(g.current_amount), 0);
  const activeGoals = goals.filter(g => !g.is_complete);
  const completedGoals = goals.filter(g => g.is_complete);

  return (
    <DashboardClient
      profile={profile}
      levelInfo={levelInfo}
      totalSaved={totalSaved}
      activeGoals={activeGoals}
      completedGoals={completedGoals}
      activeChallenges={activeChallengesRes.data ?? []}
      recentAchievements={(achievementsRes.data ?? []).map(a => a.achievement_id)}
      activityLog={activityRes.data ?? []}
      dailyQuestCompletedToday={!!dailyQuestRes.data}
      todayQuestId={dailyQuestRes.data?.quest_id}
    />
  );
}
