import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

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

          supabaseResponse = NextResponse.next({ request });

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
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  if (user && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
