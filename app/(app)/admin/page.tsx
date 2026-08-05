import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminClient from "./AdminClient";
import { convertAmountsTo } from "@/lib/currencyConversion";

export default async function AdminPage() {
  // Auth check via RLS client
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, display_name")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) redirect("/dashboard");

  // Use service client to bypass RLS for admin data access
  const service = createServiceClient();

  const [
    usersRes,
    goalsRes,
    txRes,
    challengesRes,
    userChallengesRes,
    achievementsRes,
    activityRes,
    eventsRes,
    engagementRes,
    dailyActivityRes,
    dailyQuestsRes,
    weeklyQuestsRes,
    questChainsRes,
    questChainStepsRes,
    badgesRes,
    dailyQuestLogsRes,
    chainProgressRes,
  ] = await Promise.all([
    service.from("profiles").select("id, display_name, avatar_emoji, xp_total, current_level, streak_days, longest_streak, last_active_date, is_admin, country_code, currency_code, locale, created_at").order("created_at", { ascending: false }),
    service.from("savings_goals").select("id, user_id, title, category, target_amount, current_amount, is_complete, created_at"),
    service.from("transactions").select("id, user_id, amount, created_at, transaction_type"),
    service.from("challenges").select("*").order("xp_reward", { ascending: false }),
    service.from("user_challenges").select("id, user_id, challenge_id, status, started_at, completed_at"),
    service.from("user_achievements").select("user_id, achievement_id, earned_at"),
    service.from("activity_log").select("activity_date, xp_earned, actions_count, user_id").gte(
      "activity_date",
      new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]
    ),
    service.from("events").select("*, event_regions(region)").order("created_at", { ascending: false }),
    // Analytics: engagement status counts
    service.from("user_engagement_status").select("status").then(res => {
      if (res.error) return { data: [] };
      const counts = new Map<string, number>();
      for (const row of res.data ?? []) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      }
      return { data: Array.from(counts.entries()).map(([status, count]) => ({ status, count })) };
    }),
    // Analytics: daily activity last 35 days (enough for D30 retention)
    service.from("analytics_daily_activity")
      .select("date, user_id, deposit_count, xp_gained, quests_completed")
      .gte("date", new Date(Date.now() - 35 * 86400000).toISOString().split("T")[0])
      .order("date", { ascending: true })
      .then(res => ({ data: res.data ?? [], error: res.error })),
    // ── Task 3: Admin CRUD content tables ──────────────────────
    service.from("daily_quests").select("*").order("created_at"),
    service.from("weekly_quests").select("*").order("created_at"),
    service.from("quest_chains").select("*").order("created_at"),
    service.from("quest_chain_steps").select("*").order("chain_id").order("step_number"),
    service.from("badges").select("*").order("created_at"),
    // Counts used to disable delete / show "X users" warnings client-side
    service.from("daily_quest_logs").select("quest_id"),
    service.from("quest_chain_progress").select("chain_id, status"),
  ]);

  // Fetch auth emails via admin API — only available with service role
  let authUsers: { id: string; email: string }[] = [];
  try {
    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    authUsers = (data?.users ?? []).map(u => ({ id: u.id, email: u.email ?? "" }));
  } catch {
    // Service role may not have admin auth access in all environments
  }

  // Merge email into profiles
  const emailMap = new Map(authUsers.map(u => [u.id, u.email]));
  const usersWithEmail = (usersRes.data ?? []).map(u => ({
    ...u,
    email: emailMap.get(u.id) ?? "",
  }));

  // Merge quest_chain_steps into their parent quest_chains
  const chainSteps = questChainStepsRes.data ?? [];
  const questChainsWithSteps = (questChainsRes.data ?? []).map(chain => ({
    ...chain,
    steps: chainSteps.filter(s => s.chain_id === chain.id),
  }));

  // Usage counts for delete-safety hints in the Admin UI
  const dailyQuestUsage = new Map<string, number>();
  for (const row of dailyQuestLogsRes.data ?? []) {
    dailyQuestUsage.set(row.quest_id, (dailyQuestUsage.get(row.quest_id) ?? 0) + 1);
  }
  const chainUsage = new Map<string, number>();
  for (const row of chainProgressRes.data ?? []) {
    chainUsage.set(row.chain_id, (chainUsage.get(row.chain_id) ?? 0) + 1);
  }
  const badgeUsage = new Map<string, number>();
  for (const row of achievementsRes.data ?? []) {
    badgeUsage.set(row.achievement_id, (badgeUsage.get(row.achievement_id) ?? 0) + 1);
  }

  // Sprint 31 — Phase 17 (Final Audit): the "Platform Saved" KPI used to
  // sum every deposit's raw `amount` across every user regardless of
  // their currency — a ZAR user's 500 and a USD user's 500 silently
  // added as if they were the same money, the exact bug class Phase 9
  // fixed for shared-goal contributions, just not caught here until this
  // final sweep. Same fix shape: group by each depositing user's real
  // currency, convert each group's subtotal into ZAR (the platform's
  // historical/majority currency) via the Phase 7 engine, sum those.
  const currencyByUserId = new Map((usersRes.data ?? []).map((u) => [u.id, u.currency_code ?? "ZAR"]));
  const depositsByCurrency = new Map<string, number>();
  for (const t of txRes.data ?? []) {
    const amount = Number(t.amount);
    if (amount <= 0) continue;
    const code = currencyByUserId.get(t.user_id) ?? "ZAR";
    depositsByCurrency.set(code, (depositsByCurrency.get(code) ?? 0) + amount);
  }
  let totalSavedZAR = 0;
  try {
    const converted = await convertAmountsTo(
      Array.from(depositsByCurrency, ([currencyCode, amount]) => ({ amount, currencyCode })),
      "ZAR"
    );
    totalSavedZAR = converted.reduce((sum, c) => sum + c.amount, 0);
  } catch {
    // Rate lookup failed with no fallback available (see
    // lib/exchangeRates/cache.ts) — fall back to the pre-Phase-17 raw
    // sum rather than showing a blank/zero KPI. Inaccurate the same way
    // it always was for non-ZAR deposits, not a new failure mode.
    totalSavedZAR = Array.from(depositsByCurrency.values()).reduce((sum, v) => sum + v, 0);
  }

  return (
    <AdminClient
      users={usersWithEmail}
      goals={goalsRes.data ?? []}
      transactions={txRes.data ?? []}
      totalSavedZAR={totalSavedZAR}
      challenges={challengesRes.data ?? []}
      userChallenges={userChallengesRes.data ?? []}
      userAchievements={achievementsRes.data ?? []}
      activityLog={activityRes.data ?? []}
      adminName={profile.display_name}
      dbEvents={eventsRes.data ?? []}
      engagementStatuses={engagementRes.data ?? []}
      dailyActivity={dailyActivityRes.data ?? []}
      dailyQuests={dailyQuestsRes.data ?? []}
      weeklyQuests={weeklyQuestsRes.data ?? []}
      questChains={questChainsWithSteps}
      badges={badgesRes.data ?? []}
      dailyQuestUsage={Object.fromEntries(dailyQuestUsage)}
      chainUsage={Object.fromEntries(chainUsage)}
      badgeUsage={Object.fromEntries(badgeUsage)}
    />
  );
}
