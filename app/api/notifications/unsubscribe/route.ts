import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { endpoint } = await req.json() as { endpoint?: string };

    if (endpoint) {
      // Deactivate specific subscription
      await supabase
        .from("push_subscriptions")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("endpoint", endpoint);
    } else {
      // Deactivate ALL subscriptions for this user
      await supabase
        .from("push_subscriptions")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);

      await supabase
        .from("profiles")
        .update({ notifications_enabled: false })
        .eq("id", user.id);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[push/unsubscribe]", err);
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}
