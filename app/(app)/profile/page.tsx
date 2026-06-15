import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getLevelFromXP } from "@/lib/xp";
import ProfileClient from "./ProfileClient";
import { fetchTimelineEvents } from "@/lib/timeline";

export default async function ProfilePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [profileRes, achievementsRes, txRes, chainProgressRes, timelineGroups] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("user_achievements").select("achievement_id, earned_at").eq("user_id", user.id),
    supabase.from("transactions").select("amount").eq("user_id", user.id),
    supabase.from("quest_chain_progress").select("*").eq("user_id", user.id),
    fetchTimelineEvents(supabase, user.id, { limit: 30 }),
  ]);

  const profile = profileRes.data;
  if (!profile) redirect("/auth/login");

  const totalSaved = (txRes.data ?? []).reduce((s, t) => s + Number(t.amount), 0);
  const levelInfo = getLevelFromXP(profile.xp_total);
  const completedChains = (chainProgressRes.data ?? []).filter(c => c.status === "completed").length;

  return (
    <ProfileClient
      profile={profile}
      levelInfo={levelInfo}
      earnedIds={(achievementsRes.data ?? []).map(a => a.achievement_id)}
      earnedAchievements={achievementsRes.data ?? []}
      totalSaved={totalSaved}
      totalTransactions={(txRes.data ?? []).length}
      completedChains={completedChains}
      timelineGroups={timelineGroups}
    />
  );
}
