/**
 * app/api/onboarding/dismiss-notification-prompt/route.ts
 *
 * Persists notification_prompt_dismissed=true on the user's profile.
 * Called fire-and-forget by NotificationPromptBanner.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabase
    .from("profiles")
    .update({ notification_prompt_dismissed: true })
    .eq("id", user.id);

  return NextResponse.json({ ok: true });
}