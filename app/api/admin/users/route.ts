/**
 * app/api/admin/users/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 13 P1-B: Admin data endpoint with rate limiting, audit logging,
 * and anomaly detection.
 *
 * WHY A SERVER ROUTE?
 *   The admin page previously made direct client-side Supabase queries.
 *   RLS correctly restricted access (is_admin = true), but there was no
 *   rate limiting, audit logging, or anomaly detection. A compromised admin
 *   account could enumerate all user data at high speed with no monitoring.
 *
 *   This route wraps admin data access with:
 *   - Rate limiting: 100 requests per 10 minutes (never reached by manual use)
 *   - Anomaly alerting: Sentry warning at 50% of rate limit
 *   - Audit log: every admin data access is permanently logged
 *   - Structured logging: searchable by admin_user_id and request_id
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse }          from "next/server";
import { createLogger }                        from "@/lib/logger";
import { captureWarning }                      from "@/lib/monitoring";
import { writeAuditLog }                       from "@/lib/auditLog";

const log = createLogger("admin.users");

// 100 requests / 10 minutes.
// A legitimate admin browsing the dashboard generates ~5–10 req/min.
// This catches runaway scripts while never affecting manual use.
const RATE_LIMIT     = 100;
const WINDOW_MINUTES = 10;

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Admin check ────────────────────────────────────────────────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) {
    log.warn("Non-admin attempted admin data access", {
      user_id: user.id, request_id: requestId,
    });
    // Alert on non-admin probing — may indicate credential stuffing
    captureWarning("Non-admin attempted admin data access", {
      user_id: user.id, request_id: requestId ?? "",
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── 3. Rate limiting ──────────────────────────────────────────────────────
  const serviceClient = createServiceClient();
  const windowStart   = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count } = await serviceClient
    .from("rate_limit_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("endpoint", "admin.users")
    .gte("created_at", windowStart);

  // Record this attempt (fire-and-forget)
  serviceClient
    .from("rate_limit_attempts")
    .insert({ user_id: user.id, endpoint: "admin.users" })
    .then(() => {});

  // Anomaly alert at 50% of limit — warn before blocking
  if ((count ?? 0) >= RATE_LIMIT * 0.5) {
    captureWarning("Admin access frequency approaching rate limit", {
      user_id: user.id,
      request_id: requestId ?? "",
      count: String(count ?? 0),
      limit: String(RATE_LIMIT),
    });
  }

  if ((count ?? 0) >= RATE_LIMIT) {
    log.warn("Admin rate limit exceeded", {
      user_id: user.id, request_id: requestId,
      count: count ?? 0, limit: RATE_LIMIT,
    });
    captureWarning("Admin rate limit exceeded", {
      user_id: user.id, request_id: requestId ?? "",
      count: String(count ?? 0),
    });
    return NextResponse.json(
      { error: "Too many admin requests. Please wait 10 minutes." },
      { status: 429 }
    );
  }

  // ── 4. Audit log ──────────────────────────────────────────────────────────
  // Every admin data access is permanently recorded.
  await writeAuditLog({
    userId:     user.id,
    eventType:  "ADMIN_DATA_ACCESS",
    entityType: "admin_query",
    entityId:   "users_list",
    metadata:   { request_id: requestId, endpoint: "admin.users" },
    requestId,
  });

  // ── 5. Fetch data ─────────────────────────────────────────────────────────
  // Use service client — we've verified is_admin above.
  // This avoids the N+1 pattern of the old client-side approach which hit
  // the DB once per user for activity data.
  const { data: users, error } = await serviceClient
    .from("profiles")
    .select(`
      id,
      display_name,
      created_at,
      xp_total,
      streak_days,
      country_code,
      is_admin,
      onboarding_completed_at,
      notifications_enabled,
      last_active_date,
      current_level,
      currency_code,
      locale,
      timezone
    `)
    .order("created_at", { ascending: false });

  if (error) {
    log.error("Admin users fetch failed", {
      user_id: user.id, request_id: requestId, error: error.message,
    });
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }

  log.info("Admin data accessed", {
    admin_user_id: user.id,
    request_id:    requestId,
    user_count:    users?.length ?? 0,
  });

  return NextResponse.json({ users: users ?? [] });
}