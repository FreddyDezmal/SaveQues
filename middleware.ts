import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Request correlation ID.
 *
 * Reuses an incoming x-request-id (e.g. from a load balancer or future
 * client instrumentation) if present, otherwise generates a short random
 * ID. Set on both the outgoing request headers (so route handlers can
 * read it via req.headers.get("x-request-id")) and the response headers
 * (so it's visible in browser devtools / can be echoed back in a bug report).
 *
 * No external dependency — uses crypto.randomUUID() truncated to 10 chars,
 * which is already available in the Next.js Edge Runtime.
 */
function getOrCreateRequestId(request: NextRequest): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID().slice(0, 10);
}

export async function middleware(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);

  // Clone headers so the request ID is available to route handlers via
  // req.headers.get("x-request-id"), even when the incoming request
  // didn't supply one.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });
  supabaseResponse.headers.set("x-request-id", requestId);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );

          // Rebuild the response (required so Supabase's refreshed cookies
          // attach correctly) — re-apply the request ID header here too,
          // since NextResponse.next({ request }) does not carry over headers
          // set on a previous response instance.
          supabaseResponse = NextResponse.next({ request });
          supabaseResponse.headers.set("x-request-id", requestId);

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        }
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  const isAuthPage  = pathname.startsWith("/auth");
  const isApiRoute  = pathname.startsWith("/api");
  const isPublicPage = pathname === "/" || isAuthPage || isApiRoute;

  // API routes handle their own authentication (createClient().auth.getUser()
  // + explicit 401/403 JSON responses in each route) and must remain reachable
  // without a browser session — e.g. /api/cron/notifications is called by an
  // external cron service using only an `Authorization: Bearer <CRON_SECRET>`
  // header, with no Supabase session cookie. Previously this middleware
  // redirected such requests to /auth/login (307) BEFORE the route's own
  // CRON_SECRET check ever ran, making the cron endpoint completely
  // unreachable. Redirecting any unauthenticated /api/* request to an HTML
  // login page is also wrong for browser fetch() callers expecting JSON.
  if (!user && !isPublicPage) {
    const redirect = NextResponse.redirect(new URL("/auth/login", request.url));
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  // If the user has a session but hasn't confirmed their email yet, send them
  // to the verify-email page rather than letting them reach protected routes.
  // Without this, unconfirmed users can reach /dashboard, the RPC fails
  // (profile may be incomplete), and Next.js throws a Server Component error.
  const isVerifyPage = pathname === "/auth/verify-email";
  if (user && !user.email_confirmed_at && !isPublicPage && !isVerifyPage) {
    const redirect = NextResponse.redirect(new URL("/auth/verify-email", request.url));
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  if (user && isAuthPage) {
    const redirect = NextResponse.redirect(new URL("/dashboard", request.url));
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};