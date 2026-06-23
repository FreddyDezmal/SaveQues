import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";

const log = createLogger("auth.callback");

/**
 * /auth/callback
 *
 * Supabase redirects here after:
 *  - Email confirmation (signup)
 *  - Magic link login
 *  - OAuth (if added later)
 *
 * The ?code= query parameter is a PKCE code that must be exchanged
 * server-side for a session. Without this route, email confirmation
 * links land on a 404 and the user can never log in.
 *
 * Starter goal creation:
 *   We create the starter goal here (after the session is guaranteed)
 *   rather than in signup/page.tsx, which races with the session cookie
 *   when email confirmation is enabled. The saving_for intent is stored
 *   in user metadata (raw_user_meta_data.saving_for) at signup time and
 *   read here. The starter-goal route is idempotent — if the goal already
 *   exists (onboarding_goal_created = true), it returns early safely.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Validate the `next` redirect target before using it.
  //
  // SECURITY: `new URL(userSuppliedString, origin)` resolves absolute URLs
  // (e.g. "https://evil.com") against the origin, returning the absolute
  // URL unchanged — creating an open redirect. This was identified as a
  // confirmed vulnerability in the Sprint 12 independent audit:
  //   /auth/callback?code=VALID_CODE&next=https://evil.com
  // would redirect users to evil.com after a legitimate auth flow, enabling
  // phishing via a trusted domain.
  //
  // Fix: only accept next values that are relative paths starting with a
  // single "/" — this covers all legitimate in-app destinations while
  // blocking any absolute URL, protocol-relative URL (//evil.com), and
  // path-traversal attempts.
  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//")
    ? rawNext
    : "/dashboard";

  if (!code) {
    return NextResponse.redirect(
      new URL("/auth/login?reason=missing_code", request.url)
    );
  }

  const supabase = createClient();
  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    log.error("exchangeCodeForSession failed", { error: error.message });
    return NextResponse.redirect(
      new URL(`/auth/login?reason=confirmation_failed&detail=${encodeURIComponent(error.message)}`, request.url)
    );
  }

  // ── Starter goal creation ─────────────────────────────────────────────────
  // Session is now established. Read saving_for from user metadata (set at
  // signup time) and call the starter-goal route. Non-blocking — any failure
  // is logged but must not prevent the user from reaching the dashboard.
  const savingFor = sessionData?.user?.user_metadata?.saving_for ?? "custom";
  const userId    = sessionData?.user?.id;

  if (userId) {
    try {
      // Build an absolute URL for the internal fetch since we're in a Route Handler
      const starterGoalUrl = new URL("/api/onboarding/starter-goal", origin);
      const starterRes = await fetch(starterGoalUrl.toString(), {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          // Forward the session cookie so the route can authenticate the user
          "Cookie": request.headers.get("cookie") ?? "",
        },
        body: JSON.stringify({ saving_for: savingFor }),
      });

      if (!starterRes.ok && starterRes.status !== 401) {
        const body = await starterRes.text().catch(() => "");
        log.warn("Starter goal creation returned non-OK status", {
          user_id: userId,
          status:  starterRes.status,
          body:    body.slice(0, 200),
        });
      } else {
        log.info("Starter goal creation completed", {
          user_id:    userId,
          saving_for: savingFor,
          status:     starterRes.status,
        });
      }
    } catch (err: any) {
      // Never block the redirect — log and move on
      log.error("Starter goal creation threw", {
        user_id: userId,
        error:   err.message ?? String(err),
      });
      captureError(err, {
        route:      "GET /auth/callback → starter-goal",
        user_id:    userId,
        saving_for: savingFor,
      });
    }
  }

  // Code exchanged successfully — session cookie is now set.
  // Redirect to the intended destination (default: dashboard).
  return NextResponse.redirect(new URL(next, origin));
}