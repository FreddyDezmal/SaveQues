import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { NotificationMetrics } from "@/lib/types.notifications";
import { computeEngagementBreakdown, computeEngagementByType } from "@/lib/notificationAnalytics";

// Sprint 27, Phase 13: bounded default window, was previously an
// unconditional SELECT of the entire table — flagged as a real memory
// concern in Phase 11's own doc ("fine at this app's current scale, a
// real scaling concern once the table grows large enough"). 90 days is
// generous for "recent trends" (the only thing this route's one caller,
// the admin dashboard, currently shows) while keeping the row count and
// response payload bounded regardless of how old this table's oldest
// rows are. `days` is accepted as an optional override, capped at 365 —
// callers that genuinely need a longer look-back can ask for it
// explicitly, but the unconditional case is never unbounded again.
const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 365;

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!profile?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const service = createServiceClient();

    const daysParam = Number(req.nextUrl.searchParams.get("days"));
    const windowDays = Number.isFinite(daysParam) && daysParam > 0
      ? Math.min(daysParam, MAX_WINDOW_DAYS)
      : DEFAULT_WINDOW_DAYS;
    const sinceISO = new Date(Date.now() - windowDays * 86400000).toISOString();

    // Sprint 27, Phase 11: select every engagement column, not just
    // sent/delivered/clicked — the shared lib/notificationAnalytics.ts
    // module (also used by the pure unit tests) computes the full
    // Delivered/Opened/Dismissed/Clicked/Converted/Ignored breakdown
    // from these rows, rather than this route recomputing a subset of
    // it inline the way it used to.
    const { data: rows } = await service
      .from("notification_logs")
      .select("notification_type, sent_at, delivered_at, clicked_at, read_at, dismissed_at, converted_at")
      .gte("sent_at", sinceISO);

    if (!rows) return NextResponse.json({ error: "Query failed" }, { status: 500 });

    const overall = computeEngagementBreakdown(rows);
    const byType = computeEngagementByType(rows);

    const metrics: NotificationMetrics = {
      total_sent: overall.sent,
      total_delivered: overall.delivered,
      total_clicked: overall.clicked,
      delivery_rate: overall.delivery_rate,
      click_rate: overall.click_rate,
      total_opened: overall.opened,
      total_dismissed: overall.dismissed,
      total_converted: overall.converted,
      total_ignored: overall.ignored,
      open_rate: overall.open_rate,
      dismiss_rate: overall.dismiss_rate,
      conversion_rate: overall.conversion_rate,
      ignored_rate: overall.ignored_rate,
      by_type: byType.map((t) => ({
        type: t.type as any,
        sent: t.sent,
        delivered: t.delivered,
        clicked: t.clicked,
        opened: t.opened,
        dismissed: t.dismissed,
        converted: t.converted,
        ignored: t.ignored,
      })),
    };

    // Active subscribers count
    const { count: subscriberCount } = await service
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    return NextResponse.json({ metrics, subscriberCount: subscriberCount ?? 0, windowDays });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
