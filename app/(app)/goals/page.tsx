import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import GoalCard from "@/components/goals/GoalCard";
import { Plus } from "lucide-react";

export default async function GoalsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: goals } = await supabase
    .from("savings_goals")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const active = (goals ?? []).filter(g => !g.is_complete);
  const completed = (goals ?? []).filter(g => g.is_complete);

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Your Goals</h1>
          <p className="text-white/40 text-sm mt-0.5">{active.length} active, {completed.length} completed</p>
        </div>
        <Link href="/goals/new" className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2.5">
          <Plus size={16} /> New
        </Link>
      </div>

      {active.length === 0 && completed.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-5xl mb-4">🎯</div>
          <h2 className="font-display text-xl font-semibold text-white mb-2">No goals yet</h2>
          <p className="text-white/40 text-sm mb-6">Create your first savings goal and start earning XP!</p>
          <Link href="/goals/new" className="btn-primary inline-flex items-center gap-2">
            <Plus size={16} /> Create My First Goal
          </Link>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="mb-6">
              <h2 className="font-display font-semibold text-white/60 text-xs uppercase tracking-wider mb-3">Active</h2>
              <div className="space-y-3">
                {active.map(goal => <GoalCard key={goal.id} goal={goal} />)}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <div className="mb-6">
              <h2 className="font-display font-semibold text-white/60 text-xs uppercase tracking-wider mb-3">Completed ✅</h2>
              <div className="space-y-3 opacity-70">
                {completed.map(goal => <GoalCard key={goal.id} goal={goal} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
