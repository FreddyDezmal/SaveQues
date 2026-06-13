import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Called by the service worker when a push is received or clicked.
 * The notification ID is stored in the push payload and passed here.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { notificationId, event } = await req.json() as {
      notificationId: string;
      event: "delivered" | "clicked";
    };

    if (!notificationId || !["delivered", "clicked"].includes(event)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }

    const column = event === "delivered" ? "delivered_at" : "clicked_at";

    await supabase
      .from("notification_logs")
      .update({ [column]: new Date().toISOString() })
      .eq("id", notificationId)
      .is(column, null); // only set once

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
