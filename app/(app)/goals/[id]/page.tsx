import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import GoalDetailClient from "./GoalDetailClient";

export default async function GoalDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [goalRes, txRes, profileRes] = await Promise.all([
    supabase.from("savings_goals").select("*").eq("id", params.id).eq("user_id", user.id).single(),
    supabase.from("transactions").select("*").eq("goal_id", params.id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("streak_days, xp_total").eq("id", user.id).single(),
  ]);

  if (!goalRes.data) notFound();

  return (
    <GoalDetailClient
      goal={goalRes.data}
      transactions={txRes.data ?? []}
      streakDays={profileRes.data?.streak_days ?? 0}
    />
  );
}
