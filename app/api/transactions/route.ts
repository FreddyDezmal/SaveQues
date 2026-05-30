import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getXPForAction } from "@/lib/xp";
import { checkAchievements, ACHIEVEMENTS } from "@/lib/achievements";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { goal_id, amount, note } = body;

  if (!goal_id || !amount || amount <= 0) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Insert transaction (trigger updates goal.current_amount automatically)
  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .insert({ user_id: user.id, goal_id, amount, note: note ?? null })
    .select()
    .single();

  if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });

  // Fetch updated profile and goal
  const [profileRes, goalRes, txCountRes, achievementsRes, goalsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("savings_goals").select("*").eq("id", goal_id).single(),
    supabase.from("transactions").select("id").eq("user_id", user.id),
    supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id),
    supabase.from("savings_goals").select("current_amount, is_complete").eq("user_id", user.id),
  ]);

  const profile = profileRes.data;
  const goal = goalRes.data;
  if (!profile || !goal) return NextResponse.json({ error: "Data error" }, { status: 500 });

  const isGoalComplete = goal.is_complete;
  const earnedIds = (achievementsRes.data ?? []).map((a: any) => a.achievement_id);
  const totalSaved = (goalsRes.data ?? []).reduce((sum: number, g: any) => sum + Number(g.current_amount), 0);
  const completedGoals = (goalsRes.data ?? []).filter((g: any) => g.is_complete).length;

  // Award XP
  const action = isGoalComplete ? "GOAL_COMPLETE" : "LOG_SAVING";
  const xpGained = getXPForAction(action, profile.streak_days);
  const newXP = profile.xp_total + xpGained;

  // Check for new achievements
  const hour = new Date().getHours();
  const newAchievements = checkAchievements({
    streakDays: profile.streak_days,
    totalSaved,
    goalsCompleted: completedGoals,
    activeGoals: (goalsRes.data ?? []).filter((g: any) => !g.is_complete).length,
    challengesCompleted: 0,
    transactionAmount: amount,
    transactionHour: hour,
    earnedIds,
  });

  // Update profile XP
  await supabase.from("profiles").update({ xp_total: newXP }).eq("id", user.id);

  // Award new achievements
  if (newAchievements.length > 0) {
    await supabase.from("user_achievements").insert(
      newAchievements.map(a => ({
        user_id: user.id,
        achievement_id: a.id,
      }))
    );
  }

  return NextResponse.json({
    xpGained,
    newXP,
    newAchievements,
    isGoalComplete,
  });
}
