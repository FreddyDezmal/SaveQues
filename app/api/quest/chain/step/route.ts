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
