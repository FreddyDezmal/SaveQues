/**
 * app/api/quest/challenge/accept/route.ts
 * Accepts a seasonal challenge. No XP at accept time.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { challengeId } = await req.json();
  if (!challengeId) return NextResponse.json({ error: "challengeId required" }, { status: 400 });

  // Verify the challenge exists and is active
  const { data: challenge } = await supabase
    .from("challenges")
    .select("id")
    .eq("id", challengeId)
    .eq("is_active", true)
    .single();

  if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });

  const { error } = await supabase
    .from("user_challenges")
    .insert({
      user_id:      user.id,
      challenge_id: challengeId,
      status:       "active",
      started_at:   new Date().toISOString(),
    });

  // Ignore duplicate (user already accepted)
  if (error && !error.message.includes("duplicate")) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
