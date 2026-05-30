import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getLevelFromXP } from "@/lib/xp";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { formatCurrency } from "@/lib/utils";
import ProfileClient from "./ProfileClient";

export default async function ProfilePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [profileRes, achievementsRes, goalsRes, txRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("user_achievements").select("achievement_id, earned_at").eq("user_id", user.id),
    supabase.from("savings_goals").select("is_complete, current_amount").eq("user_id", user.id),
    supabase.from("transactions").select("amount").eq("user_id", user.id),
  ]);

  const profile = profileRes.data;
  if (!profile) redirect("/auth/login");

  const earnedIds = (achievementsRes.data ?? []).map(a => a.achievement_id);
  const totalSaved = (txRes.data ?? []).reduce((sum, t) => sum + Number(t.amount), 0);
  const completedGoals = (goalsRes.data ?? []).filter(g => g.is_complete).length;
  const levelInfo = getLevelFromXP(profile.xp_total);

  return (
    <ProfileClient
      profile={profile}
      levelInfo={levelInfo}
      earnedIds={earnedIds}
      totalSaved={totalSaved}
      completedGoals={completedGoals}
      totalTransactions={(txRes.data ?? []).length}
    />
  );
}
