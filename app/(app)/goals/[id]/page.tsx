import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import GoalDetailClient from "./GoalDetailClient";
import { fetchTimelineEvents } from "@/lib/timeline";

export default async function GoalDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Sprint 28.5 — Phase 9 (Security): explicit user_id scoping added here
  // as defense-in-depth. This wasn't independently exploitable before —
  // the transactions table's RLS policy ("Users can read own transactions",
  // migration 031) already enforces `auth.uid() = user_id` at the database
  // level regardless of this query's own filters, and `notFound()` below
  // fires before GoalDetailClient ever renders if `params.id` isn't the
  // caller's own goal, so a foreign goal_id was never reachable end-to-end.
  // But every other query on this page (and every other page in the
  // intelligence surface) is explicitly scoped to `user.id` too — this was
  // the one query relying solely on RLS rather than both layers agreeing,
  // so it's tightened to match rather than left as the outlier.
  const [goalRes, txRes, profileRes, timelineGroups] = await Promise.all([
    supabase.from("savings_goals").select("*").eq("id", params.id).eq("user_id", user.id).single(),
    supabase.from("transactions").select("*").eq("goal_id", params.id).eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("streak_days, currency_code, locale, xp_total").eq("id", user.id).single(),
    fetchTimelineEvents(supabase, user.id, { goalId: params.id }),
  ]);

  if (!goalRes.data) notFound();

  return (
    <GoalDetailClient
      goal={goalRes.data}
      transactions={txRes.data ?? []}
      streakDays={profileRes.data?.streak_days ?? 0}
      xpTotal={profileRes.data?.xp_total ?? 0}
      currencyCode={profileRes.data?.currency_code ?? "ZAR"}
      locale={profileRes.data?.locale ?? "en-ZA"}
      timelineGroups={timelineGroups}
    />
  );
}