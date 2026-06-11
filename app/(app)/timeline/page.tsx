import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { fetchTimelineEvents } from "@/lib/timeline";
import TimelineClient from "./TimelineClient";

interface Props {
  searchParams: { goalId?: string };
}

export default async function TimelinePage({ searchParams }: Props) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const goalId = searchParams.goalId;

  const [profileRes, goalRes, groups] = await Promise.all([
    supabase.from("profiles").select("currency_code, locale").eq("id", user.id).single(),
    goalId
      ? supabase.from("savings_goals").select("title").eq("id", goalId).eq("user_id", user.id).single()
      : Promise.resolve({ data: null }),
    fetchTimelineEvents(supabase, user.id, { goalId }),
  ]);

  const currencyCode = profileRes.data?.currency_code ?? "ZAR";
  const locale       = profileRes.data?.locale        ?? "en-ZA";
  const goalTitle    = (goalRes as any).data?.title;
  const backHref     = goalId ? `/goals/${goalId}` : "/dashboard";

  return (
    <TimelineClient
      groups={groups}
      goalTitle={goalTitle}
      backHref={backHref}
      currencyCode={currencyCode}
      locale={locale}
    />
  );
}
