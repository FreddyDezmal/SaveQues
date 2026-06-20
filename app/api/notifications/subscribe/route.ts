import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { WebPushSubscription } from "@/lib/types.notifications";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";

const log = createLogger("push.subscribe");

export async function POST(req: NextRequest) {
  const end = log.time("push subscription registration");

  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      log.warn("Unauthenticated subscription attempt", { action: "auth_check" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    setSentryUser(user.id);

    const body = await req.json() as {
      subscription: WebPushSubscription;
      timezone?: string;
    };

    const { subscription, timezone = "UTC" } = body;

    // ── Timezone validation ─────────────────────────────────────────────────
    // Intl.supportedValuesOf("timeZone") returns the full IANA timezone
    // database supported by the runtime. Reject anything not in that list
    // with a clear 400 rather than silently storing a malformed value.
    //
    // This is a FIRST layer of defence, not a replacement for the existing
    // try/catch fallback to UTC in lib/notifications.ts (todayInTZ /
    // currentHourInTZ) — that fallback stays in place unchanged as a second
    // safeguard in case a value somehow gets into the table through another
    // path (e.g. a future admin tool, or a different client version that
    // predates this check).
    if (typeof timezone !== "string" || !Intl.supportedValuesOf("timeZone").includes(timezone)) {
      log.warn("Invalid timezone rejected", { user_id: user.id, timezone });
      return NextResponse.json(
        { error: `Invalid timezone: "${timezone}". Must be a valid IANA timezone identifier (e.g. "Africa/Johannesburg").` },
        { status: 400 }
      );
    }

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      log.warn("Invalid subscription object received", {
        user_id:      user.id,
        has_endpoint: !!subscription?.endpoint,
        has_p256dh:   !!subscription?.keys?.p256dh,
        has_auth:     !!subscription?.keys?.auth,
      });
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

    if (error) {
      log.error("Push subscription upsert failed", {
        user_id:    user.id,
        error:      error.message,
        error_code: error.code,
      });
      captureError(error, {
        route:   "POST /api/notifications/subscribe",
        user_id: user.id,
      });
      throw error;
    }

    // Mark notifications enabled on profile
    await supabase
      .from("profiles")
      .update({ notifications_enabled: true })
      .eq("id", user.id);

    end({ user_id: user.id, timezone });
    return NextResponse.json({ ok: true });

  } catch (err: any) {
    log.error("Unexpected error registering push subscription", {
      error: err.message ?? String(err),
    });
    captureError(err, { route: "POST /api/notifications/subscribe" });
    return NextResponse.json({ error: err.message ?? "Failed" }, { status: 500 });
  }
}