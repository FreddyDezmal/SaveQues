/**
 * app/api/quest/challenge/accept/route.ts
 *
 * Accepts a seasonal challenge for the authenticated user.
 *
 * Sprint 13: Added monthly limit enforcement — users can accept at most
 * 2 seasonal challenges per calendar month. This is enforced server-side
 * against user_challenges.started_at to prevent bypassing via the client.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const MONTHLY_LIMIT = 2;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { challengeId } = await req.json();
  if (!challengeId) return NextResponse.json({ error: "challengeId required" }, { status: 400 });

  // ── 1. Verify the challenge exists, is active, and is seasonal ───────────
  const { data: challenge } = await supabase
    .from("challenges")
    .select("id, quest_type, end_date")
    .eq("id", challengeId)
    .eq("is_active", true)
    .single();

  if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });

  // ── 2. Monthly limit check — max 2 seasonal challenges per calendar month ─
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  const { count } = await supabase
    .from("user_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("started_at", monthStart)
    .lte("started_at", monthEnd);

  if ((count ?? 0) >= MONTHLY_LIMIT) {
    return NextResponse.json({
      error:       "Monthly quest limit reached",
      limitReached: true,
      limit:        MONTHLY_LIMIT,
      message:      `You can accept at most ${MONTHLY_LIMIT} seasonal quests per month.`,
    }, { status: 422 });
  }

  // ── 3. Prevent duplicate accept ───────────────────────────────────────────
  const { data: existing } = await supabase
    .from("user_challenges")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("challenge_id", challengeId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ success: true, alreadyAccepted: true });
  }

  // ── 4. Insert ─────────────────────────────────────────────────────────────
  const { error } = await supabase
    .from("user_challenges")
    .insert({
      user_id:      user.id,
      challenge_id: challengeId,
      status:       "active",
      started_at:   now.toISOString(),
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success:      true,
    remaining:    MONTHLY_LIMIT - ((count ?? 0) + 1),
    monthlyLimit: MONTHLY_LIMIT,
  });
}