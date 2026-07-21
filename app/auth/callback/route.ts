import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";
import { PENDING_INVITE_COOKIE_NAME } from "@/lib/pendingInvite";

const log = createLogger("auth.callback");

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  const rawNext = searchParams.get("next")
    // Sprint 22.5: robustness fallback for any path that reaches this
    // route without an explicit `next` (e.g. a resent confirmation
    // email) — reuses the same pending-invite cookie /invite/{token}
    // sets before sending a visitor to sign up/log in (lib/pendingInvite.ts).
    // The primary path (signup requiring email confirmation) already
    // sets `next` explicitly in signup/page.tsx; this is only a fallback.
    ?? (request.cookies.get(PENDING_INVITE_COOKIE_NAME)?.value
        ? `/invite/${request.cookies.get(PENDING_INVITE_COOKIE_NAME)!.value}`
        : "/dashboard");
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//")
    ? rawNext
    : "/dashboard";

  if (!code) {
    return NextResponse.redirect(
      new URL("/auth/login?reason=missing_code", request.url)
    );
  }

  // Build the redirect response first so we can attach session cookies to it.
  // Previously we used createClient() (next/headers based) and then created a
  // separate NextResponse.redirect — the session cookies Supabase wrote via
  // setAll() never made it onto the redirect response, so the user landed on
  // /dashboard with no session cookie and getUser() returned null.
  const redirectTo  = new URL(next, origin);
  const response    = NextResponse.redirect(redirectTo);
  // Defense in depth (Phase 7): /invite/{token} already clears this
  // cookie unconditionally on mount, but clearing it here too means a
  // stale token can't linger even if that client-side code never runs.
  response.cookies.set(PENDING_INVITE_COOKIE_NAME, "", { path: "/", maxAge: 0 });

  // Create a Supabase client that reads cookies from the request and writes
  // them directly onto our redirect response.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          // Write every session cookie straight onto the redirect response
          // so the browser receives them in the same round-trip.
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options ?? {});
          });
        },
      },
    }
  );

  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    log.error("exchangeCodeForSession failed", { error: error.message });
    return NextResponse.redirect(
      new URL(
        `/auth/login?reason=confirmation_failed&detail=${encodeURIComponent(error.message)}`,
        request.url
      )
    );
  }

  // ── Starter goal creation ─────────────────────────────────────────────────
  const savingFor = sessionData?.user?.user_metadata?.saving_for ?? "custom";
  const userId    = sessionData?.user?.id;

  if (userId) {
    try {
      // Extract the session cookies we just set on the response so the
      // internal fetch to starter-goal can authenticate as this user.
      const sessionCookies = response.cookies
        .getAll()
        .map(c => `${c.name}=${c.value}`)
        .join("; ");

      const starterGoalUrl = new URL("/api/onboarding/starter-goal", origin);
      const starterRes = await fetch(starterGoalUrl.toString(), {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": sessionCookies,
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

  return response;
}