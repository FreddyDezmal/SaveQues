import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { NotificationMetrics } from "@/lib/types.notifications";

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

    // Overall totals
    const { data: totals } = await service
      .from("notification_logs")
      .select("sent_at, delivered_at, clicked_at, notification_type");

    if (!totals) return NextResponse.json({ error: "Query failed" }, { status: 500 });

    const total_sent      = totals.length;
    const total_delivered = totals.filter(r => r.delivered_at).length;
    const total_clicked   = totals.filter(r => r.clicked_at).length;

    const typeMap = new Map<string, { sent: number; delivered: number; clicked: number }>();
    for (const row of totals) {
      const t = row.notification_type;
      if (!typeMap.has(t)) typeMap.set(t, { sent: 0, delivered: 0, clicked: 0 });
      const entry = typeMap.get(t)!;
      entry.sent++;
      if (row.delivered_at) entry.delivered++;
      if (row.clicked_at)   entry.clicked++;
    }

    const metrics: NotificationMetrics = {
      total_sent,
      total_delivered,
      total_clicked,
      delivery_rate: total_sent > 0 ? ((total_delivered / total_sent) * 100).toFixed(1) : "0",
      click_rate:    total_delivered > 0 ? ((total_clicked / total_delivered) * 100).toFixed(1) : "0",
      by_type: Array.from(typeMap.entries()).map(([type, stats]) => ({
        type: type as any,
        ...stats,
      })),
    };

    // Active subscribers count
    const { count: subscriberCount } = await service
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    return NextResponse.json({ metrics, subscriberCount: subscriberCount ?? 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
