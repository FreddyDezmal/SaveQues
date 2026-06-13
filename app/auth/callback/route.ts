import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code  = searchParams.get("code");
  const next  = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    // No code — redirect to login with an error hint
    return NextResponse.redirect(
      new URL("/auth/login?reason=missing_code", request.url)
    );
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession error:", error.message);
    return NextResponse.redirect(
      new URL(`/auth/login?reason=confirmation_failed&detail=${encodeURIComponent(error.message)}`, request.url)
    );
  }

  // Code exchanged successfully — session cookie is now set.
  // Redirect to the intended destination (default: dashboard).
  return NextResponse.redirect(new URL(next, origin));
}