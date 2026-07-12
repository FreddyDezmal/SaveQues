/**
 * app/api/quest/chain/step/route.ts
 *
 * Security guarantees:
 *  • Step guard      — complete_chain_step() only advances when
 *                      current_step = p_step AND status = 'active'
 *  • Idempotency     — step XP: source_id = "chain_id:step_number"
 *                      chain bonus: source_id = chain_id
 *  • No client XP    — xpReward values come from QUEST_CHAINS constant (server)
 *  • Ownership       — RLS on quest_chain_progress enforces auth.uid() = user_id
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { QUEST_CHAINS } from "@/lib/quests";
import { checkChainStepRequirement } from "@/lib/questRequirements";
import { createLogger } from "@/lib/logger";

const log = createLogger("quest-chain-step");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chainId, stepNumber } = await req.json();
  if (!chainId || stepNumber == null) {
    return NextResponse.json({ error: "chainId and stepNumber required" }, { status: 400 });
  }

  // ── 1. Verify chain + step exist in the authoritative config ──
  const chain = QUEST_CHAINS.find(c => c.id === chainId);
  if (!chain) return NextResponse.json({ error: "Chain not found" }, { status: 404 });

  const step = chain.steps.find(s => s.stepNumber === stepNumber);
  if (!step) return NextResponse.json({ error: "Step not found" }, { status: 404 });

  // FIX (admin CRUD audit, docs/ADMIN_CRUD_AUDIT.md): this route used to
  // advance a chain step for any authenticated user regardless of whether
  // step.requiresType/requiresValue were actually true for them — the DB
  // schema (quest_chain_steps.requires_type/value, migration 016) even
  // has columns for this, but nothing ever read them. lib/quests.ts's
  // QUEST_CHAINS is the real runtime source (see docs/ADMIN_CRUD_AUDIT.md
  // for why), so validation is applied to *its* requiresType/requiresValue
  // here, using real data fetched below.
  const [{ data: profile }, { data: allTxs }, { data: dailyLogs }, { data: weeklyLogs }, { data: goals }] = await Promise.all([
    supabase.from("profiles").select("streak_days, daily_quests_completed").eq("id", user.id).single(),
    supabase.from("transactions").select("amount, transaction_type").eq("user_id", user.id).eq("transaction_type", "deposit"),
    supabase.from("daily_quest_logs").select("quest_id").eq("user_id", user.id),
    supabase.from("user_weekly_quests").select("quest_id").eq("user_id", user.id).eq("status", "completed"),
    supabase.from("savings_goals").select("id").eq("user_id", user.id).eq("is_complete", true),
  ]);

  const totalSaved = (allTxs ?? []).reduce((sum, t) => sum + Math.max(0, Number(t.amount)), 0);
  const completedQuestIds = new Set<string>([
    ...(dailyLogs ?? []).map((l) => l.quest_id),
    ...(weeklyLogs ?? []).map((l) => l.quest_id),
  ]);

  const check = checkChainStepRequirement(step.requiresType, step.requiresValue, step.requiresQuestId, {
    streakDays: profile?.streak_days ?? 0,
    totalSaved,
    dailyQuestsCompleted: profile?.daily_quests_completed ?? 0,
    completedQuestIds,
    completedGoalsCount: (goals ?? []).length,
  });

  if (check.unverifiable) {
    // Documented content gap, not a code gap — log it (visible, auditable)
    // rather than either silently trusting the client or silently
    // guessing wrong. See docs/ADMIN_CRUD_AUDIT.md.
    log.warn("Chain step requirement unverifiable — allowing, but flagged", {
      user_id: user.id, chain_id: chainId, step: stepNumber, requires_type: step.requiresType,
    });
  } else if (!check.met) {
    return NextResponse.json({ error: `Requirement not met: ${check.reason}` }, { status: 409 });
  }

  const isLastStep = stepNumber === chain.steps.length;
  const chainBonus = isLastStep ? chain.completionXP : 0;

  // ── 2. Atomic DB function — advances step + awards XP ─────────
  const { data: result, error } = await supabase.rpc("complete_chain_step", {
    p_user_id:  user.id,
    p_chain_id: chainId,
    p_step:     stepNumber,
    p_step_xp:  step.xpReward,
    p_is_last:  isLastStep,
    p_chain_xp: chainBonus,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rpcResult = result as {
    success:    boolean;
    xp_awarded: number;
    new_total:  number;
    reason?:    string;
  };

  if (rpcResult.reason === "already_awarded") {
    return NextResponse.json({ xpGained: 0, alreadyAwarded: true });
  }

  return NextResponse.json({
    xpGained:    rpcResult.xp_awarded,
    newTotal:    rpcResult.new_total,
    isLastStep,
    alreadyAwarded: false,
  });
}
