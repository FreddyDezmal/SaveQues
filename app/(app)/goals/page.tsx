import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import GoalCard from "@/components/goals/GoalCard";
import EmptyState from "@/components/ui/EmptyState";
import { Plus, ChevronRight } from "lucide-react";

export default async function GoalsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: goals } = await supabase
    .from("savings_goals")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const active    = (goals ?? []).filter(g => !g.is_complete);
  const completed = (goals ?? []).filter(g => g.is_complete);

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Your Goals</h1>
          <p className="text-white/40 text-sm mt-0.5">{active.length} active · {completed.length} completed</p>
        </div>
        <Link href="/goals/new" className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2.5">
          <Plus size={16} /> New
        </Link>
      </div>

      {active.length === 0 && completed.length === 0 ? (
        <EmptyState
          emoji="🎯"
          title="No goals yet"
          description="Create your first savings goal and start earning XP!"
          action={{ label: "Create My First Goal", href: "/goals/new" }}
        />
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
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display font-semibold text-white/60 text-xs uppercase tracking-wider">
                  Completed ({completed.length}) ✅
                </h2>
                <Link
                  href="/goals/history"
                  className="text-brand-400 text-xs flex items-center gap-0.5 hover:text-brand-300 transition-colors"
                >
                  Full history <ChevronRight size={12} />
                </Link>
              </div>
              <div className="space-y-3 opacity-70">
                {completed.slice(0, 2).map(goal => <GoalCard key={goal.id} goal={goal} />)}
                {completed.length > 2 && (
                  <Link
                    href="/goals/history"
                    className="block text-center text-brand-400 text-sm py-2 hover:text-brand-300 transition-colors"
                  >
                    See all {completed.length} completed goals →
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}