import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminClient from "./AdminClient";

export default async function AdminPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Check admin flag
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, display_name")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) redirect("/dashboard");

  // Fetch all platform stats in parallel
  const [
    usersRes,
    goalsRes,
    txRes,
    challengesRes,
    userChallengesRes,
    achievementsRes,
    activityRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: false }),
    supabase.from("savings_goals").select("id, user_id, title, category, target_amount, current_amount, is_complete, created_at"),
    supabase.from("transactions").select("id, user_id, amount, created_at"),
    supabase.from("challenges").select("*").order("xp_reward", { ascending: false }),
    supabase.from("user_challenges").select("id, user_id, challenge_id, status, started_at, completed_at"),
    supabase.from("user_achievements").select("user_id, achievement_id, earned_at"),
    supabase.from("activity_log").select("activity_date, xp_earned, actions_count").gte(
      "activity_date",
      new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]
    ),
  ]);

  return (
    <AdminClient
      users={usersRes.data ?? []}
      goals={goalsRes.data ?? []}
      transactions={txRes.data ?? []}
      challenges={challengesRes.data ?? []}
      userChallenges={userChallengesRes.data ?? []}
      userAchievements={achievementsRes.data ?? []}
      activityLog={activityRes.data ?? []}
      adminName={profile.display_name}
    />
  );
}
