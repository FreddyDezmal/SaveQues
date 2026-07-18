import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SharedGoalsClient from "./SharedGoalsClient";

export default async function SharedGoalsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Same direct-table-query pattern as app/(app)/goals/page.tsx — RLS
  // (auth.uid() = user_id) already scopes this to the caller, no new API
  // route needed. shared_goals.goal_id is UNIQUE (045), so any goal_id
  // present there is already shared and excluded from "eligible to share".
  const [{ data: goals }, { data: alreadyShared }] = await Promise.all([
    supabase.from("savings_goals").select("id, title, goal_emoji, target_amount, current_amount").eq("user_id", user.id).eq("is_complete", false),
    supabase.from("shared_goals").select("goal_id").eq("owner_id", user.id),
  ]);

  const sharedGoalIds = new Set((alreadyShared ?? []).map((s) => s.goal_id));
  const eligibleGoals = (goals ?? []).filter((g) => !sharedGoalIds.has(g.id));

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <h1 className="font-display text-2xl font-bold text-white mb-5">Shared Goals</h1>
      <SharedGoalsClient eligibleGoals={eligibleGoals} />
    </div>
  );
}
