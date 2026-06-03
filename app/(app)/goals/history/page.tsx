import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import GoalHistoryClient from "./GoalHistoryClient";

export default async function GoalHistoryPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [profileRes, completedGoalsRes] = await Promise.all([
    supabase.from("profiles").select("currency_code, locale, display_name").eq("id", user.id).single(),
    supabase
      .from("savings_goals")
      .select("*, transactions(amount, transaction_type, created_at)")
      .eq("user_id", user.id)
      .eq("is_complete", true)
      .order("completed_at", { ascending: false }),
  ]);

  const completedGoals = completedGoalsRes.data ?? [];

  const totalSaved = completedGoals.reduce((sum, g) =>
    sum + (g.transactions ?? [])
      .filter((t: any) => t.transaction_type === "deposit" || !t.transaction_type)
      .reduce((s: number, t: any) => s + Number(t.amount), 0), 0);

  return (
    <GoalHistoryClient
      goals={completedGoals}
      totalLifetimeSaved={totalSaved}
      profile={profileRes.data}
    />
  );
}