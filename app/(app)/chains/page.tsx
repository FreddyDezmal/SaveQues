import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { QUEST_CHAINS } from "@/lib/quests";
import QuestChainsClient from "./QuestChainsClient";

export default async function QuestChainsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: chainProgress } = await supabase
    .from("quest_chain_progress")
    .select("*")
    .eq("user_id", user.id);

  return (
    <QuestChainsClient
      chains={QUEST_CHAINS}
      progress={chainProgress ?? []}
      userId={user.id}
    />
  );
}
