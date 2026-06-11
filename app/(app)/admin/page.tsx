import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminClient from "./AdminClient";

export default async function AdminPage() {
  // Auth check via RLS client
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, display_name")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) redirect("/dashboard");

  // Use service client to bypass RLS for admin data access
  const service = createServiceClient();

  const [
    usersRes,
    goalsRes,
    txRes,
    challengesRes,
    userChallengesRes,
    achievementsRes,
    activityRes,
    eventsRes,
  ] = await Promise.all([
    service.from("profiles").select("id, display_name, avatar_emoji, xp_total, current_level, streak_days, longest_streak, last_active_date, is_admin, country_code, created_at").order("created_at", { ascending: false }),
    service.from("savings_goals").select("id, user_id, title, category, target_amount, current_amount, is_complete, created_at"),
    service.from("transactions").select("id, user_id, amount, created_at, transaction_type"),
    service.from("challenges").select("*").order("xp_reward", { ascending: false }),
    service.from("user_challenges").select("id, user_id, challenge_id, status, started_at, completed_at"),
    service.from("user_achievements").select("user_id, achievement_id, earned_at"),
    service.from("activity_log").select("activity_date, xp_earned, actions_count, user_id").gte(
      "activity_date",
      new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]
    ),
    service.from("events").select("*, event_regions(region)").order("created_at", { ascending: false }),
  ]);

  // Fetch auth emails via admin API — only available with service role
  let authUsers: { id: string; email: string }[] = [];
  try {
    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    authUsers = (data?.users ?? []).map(u => ({ id: u.id, email: u.email ?? "" }));
  } catch {
    // Service role may not have admin auth access in all environments
  }

  // Merge email into profiles
  const emailMap = new Map(authUsers.map(u => [u.id, u.email]));
  const usersWithEmail = (usersRes.data ?? []).map(u => ({
    ...u,
    email: emailMap.get(u.id) ?? "",
  }));

  return (
    <AdminClient
      users={usersWithEmail}
      goals={goalsRes.data ?? []}
      transactions={txRes.data ?? []}
      challenges={challengesRes.data ?? []}
      userChallenges={userChallengesRes.data ?? []}
      userAchievements={achievementsRes.data ?? []}
      activityLog={activityRes.data ?? []}
      adminName={profile.display_name}
      dbEvents={eventsRes.data ?? []}
    />
  );
}
