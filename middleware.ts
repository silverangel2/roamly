import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { safeAuthNextPath } from "@/lib/navigation";
import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseConfig } from "@/lib/supabase/config";

const AUTH_NEXT_COOKIE = "roamly_auth_next";

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

function isTripPage(pathname: string) {
  return pathname === "/trip" || pathname.startsWith("/trip/");
}

function loginRedirectUrl(request: NextRequest) {
  const next = safeAuthNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`, "/plan");
  const url = new URL("/login", request.url);
  url.searchParams.set("next", next);
  return url;
}

function readCookieNext(value?: string) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readPendingPlannerNext(request: NextRequest) {
  const next = safeAuthNextPath(readCookieNext(request.cookies.get(AUTH_NEXT_COOKIE)?.value), "");
  const pathname = next.split(/[?#]/, 1)[0];
  return pathname === "/plan" ? next : "";
}

function isDashboardPath(pathname: string) {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
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

  if (user && isDashboardPath(request.nextUrl.pathname)) {
    const plannerNext = readPendingPlannerNext(request);
    if (plannerNext) {
      const redirectResponse = NextResponse.redirect(new URL(plannerNext, request.url));
      redirectResponse.cookies.set(AUTH_NEXT_COOKIE, "", { path: "/", maxAge: 0 });
      return redirectResponse;
    }
  }

  if (isTripPage(request.nextUrl.pathname) && !user) {
    return response;
  }

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
