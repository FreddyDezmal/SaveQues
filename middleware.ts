import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function getOrCreateRequestId(request: NextRequest): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID().slice(0, 10);
}

export async function middleware(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);

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

  const isAuthPage   = pathname.startsWith("/auth");
  const isApiRoute   = pathname.startsWith("/api");
  const isErrorPage  = pathname === "/error";
  const isSettingUp  = pathname === "/auth/setting-up";
  const isVerifyPage = pathname === "/auth/verify-email";
  const isPublicPage = pathname === "/" || isAuthPage || isApiRoute || isErrorPage;

  // Unauthenticated users can't access protected routes
  if (!user && !isPublicPage) {
    const redirect = NextResponse.redirect(new URL("/auth/login", request.url));
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  // Unconfirmed users are held at verify-email or setting-up only
  if (user && !user.email_confirmed_at && !isPublicPage && !isVerifyPage && !isSettingUp) {
    const redirect = NextResponse.redirect(new URL("/auth/verify-email", request.url));
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  // Confirmed+authenticated users don't need auth pages —
  // EXCEPT /auth/setting-up which they visit while their profile row is being created.
  if (user && isAuthPage && !isSettingUp) {
    const redirect = NextResponse.redirect(new URL("/dashboard", request.url));
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json)$).*)"],
};