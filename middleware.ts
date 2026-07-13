import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { safeAuthNextPath } from "@/lib/navigation";
import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseConfig } from "@/lib/supabase/config";
import { applyCookieHeaders, normalizeSupabaseCookieOptions } from "@/lib/supabase/cookies";
import {
  getSupabaseAuthCookieDiagnostics,
  getSupabaseProjectHost,
  isSupabaseAuthCookieName,
  logAuthDiagnostic
} from "@/lib/roamly/authDiagnostics";

const AUTH_NEXT_COOKIE = "roamly_auth_next";

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => isSupabaseAuthCookieName(cookie.name) && cookie.value.length > 0);
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

function loginRedirectUrl(request: NextRequest, error?: string) {
  const next = safeAuthNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`, "/plan");
  const url = new URL("/login", request.url);
  url.searchParams.set("next", next);
  if (error) url.searchParams.set("error", error);
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
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-roamly-path", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  let refreshedCookiesAttached = false;
  let authCookieWriteCount = 0;
  let responseCookieHeaders: Record<string, string> = {};
  const isAdminRequest =
    request.nextUrl.pathname === "/admin" ||
    request.nextUrl.pathname.startsWith("/admin/") ||
    request.nextUrl.pathname.startsWith("/api/admin/");

  if (!hasSupabaseConfig()) {
    return response;
  }

  function attachRefreshedCookies(target: NextResponse) {
    response.cookies.getAll().forEach((cookie) => {
      const { name, value, ...options } = cookie;
      target.cookies.set(name, value, options);
    });
    applyCookieHeaders(target.headers, responseCookieHeaders);
    return target;
  }

  function logMiddlewareAuth(
    event: string,
    details: {
      reasonCode?: string;
      redirectDestination?: string;
      getUserOk: boolean;
      getUserError?: string | null;
      authenticatedUserId?: string | null;
      authenticatedEmail?: string | null;
    }
  ) {
    logAuthDiagnostic(event, {
      path: request.nextUrl.pathname,
      ...getSupabaseAuthCookieDiagnostics(request.headers.get("cookie") || ""),
      getUserOk: details.getUserOk,
      getUserError: details.getUserError || null,
      authenticatedUserId: details.authenticatedUserId || null,
      authenticatedEmail: details.authenticatedEmail || null,
      supabaseProjectHost: getSupabaseProjectHost(),
      middlewareRefreshAttempted: true,
      refreshedCookiesAttached,
      authCookieWriteCount,
      redirectDestination: details.redirectDestination || null,
      reasonCode: details.reasonCode || null
    });
  }

  function redirectWithAuthCookies(url: URL, reasonCode: string, user: { id?: string; email?: string } | null) {
    logMiddlewareAuth("middleware_auth_redirect", {
      reasonCode,
      redirectDestination: `${url.pathname}${url.search}`,
      getUserOk: Boolean(user),
      authenticatedUserId: user?.id || null,
      authenticatedEmail: user?.email || null
    });
    return attachRefreshedCookies(NextResponse.redirect(url));
  }

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>,
        headersToSet: Record<string, string> = {}
      ) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request: { headers: requestHeaders } });
        responseCookieHeaders = headersToSet;

        cookiesToSet.forEach(({ name, value, options }) => {
          const normalizedOptions = normalizeSupabaseCookieOptions(options);
          response.cookies.set(name, value, normalizedOptions);
          if (isSupabaseAuthCookieName(name)) {
            authCookieWriteCount += 1;
          }
        });
        applyCookieHeaders(response.headers, headersToSet);
        refreshedCookiesAttached = cookiesToSet.some(({ name }) => isSupabaseAuthCookieName(name));
      }
    }
  });

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (isAdminRequest) {
    logAuthDiagnostic("middleware_admin_auth", {
      path: request.nextUrl.pathname,
      ...getSupabaseAuthCookieDiagnostics(request.headers.get("cookie") || ""),
      getUserOk: Boolean(user),
      authenticatedUserId: user?.id || null,
      authenticatedEmail: user?.email || null,
      getUserError: userError ? userError.name || "auth_error" : null,
      supabaseProjectHost: getSupabaseProjectHost(),
      middlewareRefreshAttempted: true,
      refreshedCookiesAttached,
      authCookieWriteCount,
      redirectDestination: null,
      reasonCode: null
    });
  }

  if (user && isDashboardPath(request.nextUrl.pathname)) {
    const plannerNext = readPendingPlannerNext(request);
    if (plannerNext) {
      const redirectResponse = attachRefreshedCookies(NextResponse.redirect(new URL(plannerNext, request.url)));
      redirectResponse.cookies.set(AUTH_NEXT_COOKIE, "", { path: "/", maxAge: 0 });
      return redirectResponse;
    }
  }

  if (isTripPage(request.nextUrl.pathname) && !user) {
    return response;
  }

  if (isProtectedPage(request.nextUrl.pathname) && !user && !hasSupabaseAuthCookie(request)) {
    return redirectWithAuthCookies(loginRedirectUrl(request), "missing_auth_cookie", user);
  }

  if (isProtectedPage(request.nextUrl.pathname) && !user) {
    return redirectWithAuthCookies(
      loginRedirectUrl(request, hasSupabaseAuthCookie(request) ? "session_expired" : undefined),
      hasSupabaseAuthCookie(request) ? "get_user_failed_with_auth_cookie" : "missing_user",
      user
    );
  }

  return response;
}

export const config = {
  matcher: [
    "/account/:path*",
    "/admin/:path*",
    "/dashboard/:path*",
    "/notifications/:path*",
    "/plan/:path*",
    "/preview/:path*",
    "/pricing/:path*",
    "/trip/:path*",
    "/api/admin/:path*",
    "/api/account/:path*",
    "/api/roamly/:path*",
    "/api/trips/:path*",
    "/api/stripe/checkout/:path*",
    "/api/stripe/create-trip-checkout"
  ]
};
