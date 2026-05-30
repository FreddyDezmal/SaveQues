import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getLevelFromXP } from "@/lib/xp";
import { formatCurrency } from "@/lib/utils";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Fetch all dashboard data in parallel
  const [profileRes, goalsRes, challengesRes, achievementsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("savings_goals").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("user_challenges").select("*, challenges(*)").eq("user_id", user.id).eq("status", "active"),
    supabase.from("user_achievements").select("*").eq("user_id", user.id).order("earned_at", { ascending: false }).limit(5),
  ]);

  const profile = profileRes.data;
  const goals = goalsRes.data ?? [];
  const activeChallenges = challengesRes.data ?? [];
  const recentAchievements = achievementsRes.data ?? [];

  if (!profile) redirect("/auth/login");

  // Update streak on page load
  const today = new Date().toISOString().split("T")[0];
  if (profile.last_active_date !== today) {
    const lastDate = profile.last_active_date;
    const diff = lastDate
      ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000)
      : 999;
    const newStreak = diff === 1 ? profile.streak_days + 1 : diff > 1 ? 1 : profile.streak_days;
    await supabase
      .from("profiles")
      .update({ last_active_date: today, streak_days: newStreak })
      .eq("id", user.id);
    profile.streak_days = newStreak;
    profile.last_active_date = today;
  }

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
      activeChallenges={activeChallenges}
      recentAchievements={recentAchievements}
    />
  );
}
