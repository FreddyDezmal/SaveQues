import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { WebPushSubscription } from "@/lib/types.notifications";

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      subscription: WebPushSubscription;
      timezone?: string;
    };

    const { subscription, timezone = "UTC" } = body;

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription object" }, { status: 400 });
    }

    // Upsert (same user+endpoint combo)
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert({
        user_id:    user.id,
        endpoint:   subscription.endpoint,
        p256dh:     subscription.keys.p256dh,
        auth:       subscription.keys.auth,
        user_agent: req.headers.get("user-agent") ?? null,
        timezone,
        is_active:  true,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id,endpoint",
      });

    if (error) throw error;

    // Mark notifications enabled on profile
    await supabase
      .from("profiles")
      .update({ notifications_enabled: true })
      .eq("id", user.id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[push/subscribe]", err);
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}
