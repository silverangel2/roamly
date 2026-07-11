import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { safeAuthNextPath } from "@/lib/navigation";
import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseConfig } from "@/lib/supabase/config";

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token") && cookie.value.length > 0);
}

function isProtectedPage(pathname: string) {
  return [
    "/account",
    "/admin",
    "/dashboard",
    "/notifications",
    "/preview",
    "/trip"
  ].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function loginRedirectUrl(request: NextRequest) {
  const next = safeAuthNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`, "/plan");
  const url = new URL("/login", request.url);
  url.searchParams.set("next", next);
  return url;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!hasSupabaseConfig()) {
    return response;
  }

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (isProtectedPage(request.nextUrl.pathname) && !user && !hasSupabaseAuthCookie(request)) {
    return NextResponse.redirect(loginRedirectUrl(request));
  }

  if (isProtectedPage(request.nextUrl.pathname) && !user) {
    return NextResponse.redirect(loginRedirectUrl(request));
  }

  return response;
}

export const config = {
  matcher: [
    "/account/:path*",
    "/admin/:path*",
    "/dashboard/:path*",
    "/notifications/:path*",
    "/preview/:path*",
    "/trip/:path*",
    "/api/account/:path*",
    "/api/roamly/:path*",
    "/api/trips/:path*",
    "/api/stripe/checkout/:path*",
    "/api/stripe/create-trip-checkout"
  ]
};
