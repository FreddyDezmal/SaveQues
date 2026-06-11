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

  // Insert transaction
  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .insert({ user_id: user.id, goal_id, amount, note: note ?? null, transaction_type: "deposit" })
    .select()
    .single();

  if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });

  // Fetch everything needed for achievement checks
  const today = new Date().toISOString().split("T")[0];
  const [profileRes, goalRes, allTxRes, todayTxRes, achievementsRes, goalsRes, questsRes, weeklyRes, chainRes] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("savings_goals").select("*").eq("id", goal_id).single(),
      supabase.from("transactions").select("id, amount").eq("user_id", user.id),
      supabase.from("transactions").select("id").eq("user_id", user.id).gte("created_at", `${today}T00:00:00`),
      supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id),
      supabase.from("savings_goals").select("is_complete, current_amount, target_amount, created_at, completed_at").eq("user_id", user.id),
      supabase.from("daily_quest_logs").select("id").eq("user_id", user.id),
      supabase.from("user_weekly_quests").select("id").eq("user_id", user.id).eq("status", "completed"),
      supabase.from("quest_chain_progress").select("id").eq("user_id", user.id).eq("status", "completed"),
    ]);

  const profile = profileRes.data;
  const goal    = goalRes.data;
  if (!profile || !goal) return NextResponse.json({ error: "Data error" }, { status: 500 });

  const isGoalComplete = goal.is_complete;
  const earnedIds      = (achievementsRes.data ?? []).map((a: any) => a.achievement_id);
  const allGoals       = goalsRes.data ?? [];
  const allTxs         = allTxRes.data ?? [];
  const todayTxs       = todayTxRes.data ?? [];

  // True total saved (sum of all positive transactions)
  const totalSaved = allTxs.reduce((sum, t) => sum + Math.max(0, Number(t.amount)), 0);
  const completedGoals = allGoals.filter((g: any) => g.is_complete).length;
  const activeGoals    = allGoals.filter((g: any) => !g.is_complete).length;

  // Days to complete this goal (if just completed)
  let goalCompletedInDays: number | undefined;
  if (isGoalComplete && goal.completed_at && goal.created_at) {
    const ms = new Date(goal.completed_at).getTime() - new Date(goal.created_at).getTime();
    goalCompletedInDays = Math.max(1, Math.ceil(ms / 86400000));
  }

  // Goal exceeded by %
  let goalExceededByPercent: number | undefined;
  if (isGoalComplete && Number(goal.current_amount) > Number(goal.target_amount)) {
    goalExceededByPercent = ((Number(goal.current_amount) - Number(goal.target_amount)) / Number(goal.target_amount)) * 100;
  }

  // Goal target days away at creation
  let goalTargetDaysAway: number | undefined;
  if (goal.target_date && goal.created_at) {
    goalTargetDaysAway = Math.ceil(
      (new Date(goal.target_date).getTime() - new Date(goal.created_at).getTime()) / 86400000
    );
  }

  // Award XP
  const action   = isGoalComplete ? "GOAL_COMPLETE" : "LOG_SAVING";
  const xpGained = getXPForAction(action, profile.streak_days);
  const newXP    = profile.xp_total + xpGained;

  const hour = new Date().getHours();

  const newAchievements = checkAchievements({
    streakDays:              profile.streak_days,
    totalSaved,
    goalsCompleted:          completedGoals,
    activeGoals,
    challengesCompleted:     (questsRes.data?.length ?? 0) + (weeklyRes.data?.length ?? 0),
    dailyQuestsCompleted:    profile.daily_quests_completed ?? 0,
    weeklyQuestsCompleted:   profile.weekly_quests_completed ?? 0,
    questChainsCompleted:    chainRes.data?.length ?? 0,
    transactionAmount:       amount,
    transactionHour:         hour,
    transactionCount:        todayTxs.length,   // total deposits TODAY (includes this one)
    goalCompletedInDays,
    goalExceededByPercent,
    goalTargetDaysAway,
    earnedIds,
  });

  // Write XP update + achievements atomically-ish
  await supabase.from("profiles").update({ xp_total: newXP }).eq("id", user.id);

  if (newAchievements.length > 0) {
    await supabase.from("user_achievements").insert(
      newAchievements.map(a => ({
        user_id:        user.id,
        achievement_id: a.id,
        earned_at:      new Date().toISOString(),
      }))
    );
    // Award achievement XP on top
    const achievementXP = newAchievements.reduce((s, a) => s + a.xpReward, 0);
    if (achievementXP > 0) {
      await supabase.from("profiles").update({ xp_total: newXP + achievementXP }).eq("id", user.id);
    }
  }

  await supabase.rpc("log_activity", { p_user_id: user.id, p_xp: xpGained });

  return NextResponse.json({
    xpGained,
    newXP,
    newAchievements,
    isGoalComplete,
  });
}
