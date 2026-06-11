import { format, isToday, isYesterday } from "date-fns";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { getCategoryById } from "@/lib/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimelineEvent, TimelineEventGroup } from "@/lib/types";

// ─── Progress milestone helpers ─────────────────────────────────────────────

const MILESTONES = [25, 50, 75] as const;
type Milestone = typeof MILESTONES[number];

function detectMilestoneCrossings(
  txsAsc: { id: string; amount: number; created_at: string }[],
  targetAmount: number
): { milestone: Milestone; transactionId: string; timestamp: string }[] {
  const crossings: { milestone: Milestone; transactionId: string; timestamp: string }[] = [];
  let running = 0;
  for (const tx of txsAsc) {
    const before = (running / targetAmount) * 100;
    running += tx.amount;
    const after = (running / targetAmount) * 100;
    for (const m of MILESTONES) {
      if (before < m && after >= m) {
        crossings.push({ milestone: m, transactionId: tx.id, timestamp: tx.created_at });
      }
    }
  }
  return crossings;
}

// ─── Date group label ────────────────────────────────────────────────────────

function dateLabel(isoString: string): string {
  const d = new Date(isoString);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE MMM d");
}

// ─── Main fetch function ─────────────────────────────────────────────────────

export async function fetchTimelineEvents(
  supabase: SupabaseClient,
  userId: string,
  options?: { goalId?: string; limit?: number }
): Promise<TimelineEventGroup[]> {
  const { goalId, limit } = options ?? {};
  const goalScoped = !!goalId;

  // ── 1. Parallel fetch ─────────────────────────────────────────────────────
  const txQuery = supabase
    .from("transactions")
    .select("id, amount, note, created_at, goal_id, transaction_type")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const goalsQuery = supabase
    .from("savings_goals")
    .select("id, title, category, goal_emoji, target_amount, current_amount, is_complete, created_at")
    .eq("user_id", userId);

  const achievementsQuery = goalScoped
    ? null
    : supabase
        .from("user_achievements")
        .select("id, achievement_id, earned_at")
        .eq("user_id", userId)
        .order("earned_at", { ascending: false });

  const questsQuery = goalScoped
    ? null
    : supabase
        .from("user_challenges")
        .select("id, challenge_id, completed_at, challenges(title, xp_reward)")
        .eq("user_id", userId)
        .eq("status", "completed")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false });

  const [txRes, goalsRes, achievementsRes, questsRes] = await Promise.all([
    txQuery,
    goalsQuery,
    achievementsQuery ?? Promise.resolve({ data: [] as any[], error: null }),
    questsQuery ?? Promise.resolve({ data: [] as any[], error: null }),
  ]);

  const allTransactions: any[] = txRes.data ?? [];
  const allGoals: any[] = goalsRes.data ?? [];
  const achievements: any[] = achievementsRes.data ?? [];
  const quests: any[] = questsRes.data ?? [];

  // ── 2. Build goal lookup ───────────────────────────────────────────────────
  const goalMap = new Map<string, any>(allGoals.map((g: any) => [g.id, g]));

  // ── 3. Filter to requested goal if scoped ─────────────────────────────────
  const transactions = goalScoped
    ? allTransactions.filter((tx: any) => tx.goal_id === goalId)
    : allTransactions;

  const goals = goalScoped
    ? allGoals.filter((g: any) => g.id === goalId)
    : allGoals;

  // ── 4. Map transactions → events ──────────────────────────────────────────
  const events: TimelineEvent[] = [];

  for (const tx of transactions) {
    const goal = goalMap.get(tx.goal_id);
    if (!goal) continue;

    const cat = getCategoryById(goal.category);

    // This version has transaction_type column — use it directly.
    // Fall back to amount sign for rows that predate the column.
    let type: "deposit" | "withdrawal" | "goal_purchase";
    if (tx.transaction_type === "withdrawal") {
      type = "withdrawal";
    } else if (tx.transaction_type === "goal_purchase") {
      type = "goal_purchase";
    } else if (tx.transaction_type === "deposit" || Number(tx.amount) > 0) {
      type = "deposit";
    } else if (goal.is_complete) {
      type = "goal_purchase";
    } else {
      type = "withdrawal";
    }

    events.push({
      id: `tx_${tx.id}`,
      type,
      timestamp: tx.created_at,
      meta: {
        type,
        goalId: goal.id,
        goalTitle: goal.title,
        goalCategory: cat.id,
        amount: Number(tx.amount),
        ...(tx.note ? { note: tx.note } : {}),
      },
    });
  }

  // ── 5. Goal created events ────────────────────────────────────────────────
  for (const goal of goals) {
    const cat = getCategoryById(goal.category);
    events.push({
      id: `goal_created_${goal.id}`,
      type: "goal_created",
      timestamp: goal.created_at,
      meta: {
        type: "goal_created",
        goalId: goal.id,
        goalTitle: goal.title,
        goalCategory: cat.id,
        targetAmount: Number(goal.target_amount),
      },
    });
  }

  // ── 6. Goal completed events ──────────────────────────────────────────────
  for (const goal of goals.filter((g: any) => g.is_complete)) {
    const cat = getCategoryById(goal.category);
    const goalTxs = allTransactions.filter((tx: any) => tx.goal_id === goal.id);
    const latestTx = goalTxs[0]; // already sorted descending
    const timestamp = latestTx ? latestTx.created_at : goal.created_at;

    events.push({
      id: `goal_completed_${goal.id}`,
      type: "goal_completed",
      timestamp,
      meta: {
        type: "goal_completed",
        goalId: goal.id,
        goalTitle: goal.title,
        goalCategory: cat.id,
        targetAmount: Number(goal.target_amount),
      },
    });
  }

  // ── 7. Progress milestone events ──────────────────────────────────────────
  for (const goal of goals) {
    const goalTxs = allTransactions
      .filter((tx: any) => tx.goal_id === goal.id && Number(tx.amount) > 0)
      .slice()
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const crossings = detectMilestoneCrossings(goalTxs, Number(goal.target_amount));
    const cat = getCategoryById(goal.category);

    for (const crossing of crossings) {
      events.push({
        id: `milestone_${goal.id}_${crossing.milestone}`,
        type: "progress_milestone",
        timestamp: crossing.timestamp,
        meta: {
          type: "progress_milestone",
          goalId: goal.id,
          goalTitle: goal.title,
          goalCategory: cat.id,
          milestone: crossing.milestone,
          targetAmount: Number(goal.target_amount),
        },
      });
    }
  }

  // ── 8. Achievement earned events ──────────────────────────────────────────
  for (const ua of achievements) {
    const def = ACHIEVEMENTS.find((a) => a.id === ua.achievement_id);
    if (!def) continue;
    events.push({
      id: `achievement_${ua.id}`,
      type: "achievement_earned",
      timestamp: ua.earned_at,
      xpGained: def.xpReward,
      meta: {
        type: "achievement_earned",
        achievementId: def.id,
        achievementTitle: def.title,
        achievementIcon: def.icon,
        achievementCategory: def.category,
        xpReward: def.xpReward,
      },
    });
  }

  // ── 9. Quest completed events ─────────────────────────────────────────────
  for (const uc of quests) {
    const ch = (uc as any).challenges;
    if (!ch || !uc.completed_at) continue;
    events.push({
      id: `quest_${uc.id}`,
      type: "quest_completed",
      timestamp: uc.completed_at,
      xpGained: ch.xp_reward,
      meta: {
        type: "quest_completed",
        challengeId: uc.challenge_id,
        challengeTitle: ch.title,
        xpReward: ch.xp_reward,
      },
    });
  }

  // ── 10. Sort descending ────────────────────────────────────────────────────
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // ── 11. Apply limit ────────────────────────────────────────────────────────
  const limited = limit ? events.slice(0, limit) : events;

  // ── 12. Group by date ─────────────────────────────────────────────────────
  const groupMap = new Map<string, TimelineEvent[]>();
  for (const event of limited) {
    const label = dateLabel(event.timestamp);
    if (!groupMap.has(label)) groupMap.set(label, []);
    groupMap.get(label)!.push(event);
  }

  return Array.from(groupMap.entries()).map(([date, evts]) => ({ date, events: evts }));
}
