import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getXPForAction, type XPAction } from "@/lib/xp";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action }: { action: XPAction } = await req.json();

  const { data: profile } = await supabase
    .from("profiles")
    .select("xp_total, streak_days")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const xpGained = getXPForAction(action, profile.streak_days);
  const newXP = profile.xp_total + xpGained;

  await supabase.from("profiles").update({ xp_total: newXP }).eq("id", user.id);

  return NextResponse.json({ xpGained, newXP });
}
