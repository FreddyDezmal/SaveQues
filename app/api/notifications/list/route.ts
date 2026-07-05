import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Returns the current user's most recent notification_logs rows for the
 * in-app Notification Center (Sprint 15, Phase 4).
 *
 * Reuses the existing notification_logs table rather than a new one —
 * "recent notifications", "achievement notifications", "goal reminders",
 * and "streak reminders" all already land in this table via
 * notification_type (streak_at_risk | daily_quest | weekly_expiry |
 * seasonal_expiry | inactive), since they're the same events that trigger
 * a push notification. Read here via the RLS-scoped user client (not the
 * service client) — the existing "notification_logs_read_own" SELECT
 * policy already covers this, unchanged.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitParam) || 30, 1), 50);

    const { data, error } = await supabase
      .from("notification_logs")
      .select("id, notification_type, title, body, sent_at, clicked_at, read_at")
      .eq("user_id", user.id)
      .order("sent_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const unreadCount = (data ?? []).filter((n) => !n.read_at).length;

    return NextResponse.json({ notifications: data ?? [], unreadCount });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
