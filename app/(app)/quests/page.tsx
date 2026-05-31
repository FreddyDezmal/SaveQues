import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getTodaysDailyQuest, getThisWeeksQuest } from "@/lib/quests";
import QuestsClient from "./QuestsClient";

export default async function QuestsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const today = new Date().toISOString().split("T")[0];

  const [challengesRes, userChallengesRes, dailyLogRes, profileRes] = await Promise.all([
    supabase.from("challenges").select("*").eq("is_active", true).order("xp_reward", { ascending: false }),
    supabase.from("user_challenges").select("*, challenges(*)").eq("user_id", user.id),
    supabase.from("daily_quest_logs").select("quest_id, quest_date").eq("user_id", user.id).eq("quest_date", today).maybeSingle(),
    supabase.from("profiles").select("streak_days, xp_total, daily_quests_completed, weekly_quests_completed").eq("id", user.id).single(),
  ]);

  return (
    <QuestsClient
      allChallenges={challengesRes.data ?? []}
      userChallenges={userChallengesRes.data ?? []}
      userId={user.id}
      profile={profileRes.data ?? { streak_days: 0, xp_total: 0, daily_quests_completed: 0, weekly_quests_completed: 0 }}
      todaysDailyQuest={getTodaysDailyQuest()}
      thisWeeksQuest={getThisWeeksQuest()}
      dailyCompletedToday={!!dailyLogRes.data}
    />
  );
}
