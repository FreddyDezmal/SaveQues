import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import QuestsClient from "./QuestsClient";

export default async function QuestsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [challengesRes, userChallengesRes] = await Promise.all([
    supabase.from("challenges").select("*").eq("is_active", true).order("xp_reward", { ascending: false }),
    supabase.from("user_challenges").select("*, challenges(*)").eq("user_id", user.id),
  ]);

  return (
    <QuestsClient
      allChallenges={challengesRes.data ?? []}
      userChallenges={userChallengesRes.data ?? []}
      userId={user.id}
    />
  );
}
