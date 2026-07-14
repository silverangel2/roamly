import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { safeAuthNextPath } from "@/lib/navigation";
import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseConfig } from "@/lib/supabase/config";
import { applyCookieHeaders, normalizeSupabaseCookieOptions } from "@/lib/supabase/cookies";
import {
  getSupabaseAuthCookieDiagnostics,
  getSupabaseProjectHost,
  isExpectedSupabaseAuthCookieName,
  isStaleSupabaseAuthCookieName,
  isSupabaseAuthCookieName,
  logAuthDiagnostic
} from "@/lib/roamly/authDiagnostics";

const AUTH_NEXT_COOKIE = "roamly_auth_next";

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => isSupabaseAuthCookieName(cookie.name) && cookie.value.length > 0);
}

function hasExpectedSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => isExpectedSupabaseAuthCookieName(cookie.name) && cookie.value.length > 0);
}

function staleSupabaseAuthCookieNames(request: NextRequest) {
  return request.cookies
    .getAll()
    .filter((cookie) => isStaleSupabaseAuthCookieName(cookie.name) && cookie.value.length > 0)
    .map((cookie) => cookie.name);
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
  const staleAuthCookies = staleSupabaseAuthCookieNames(request);
  const shouldClearStaleAuthCookies = !user && staleAuthCookies.length > 0 && !hasExpectedSupabaseAuthCookie(request);

  function clearStaleAuthCookies(target: NextResponse) {
    if (!shouldClearStaleAuthCookies) return target;
    staleAuthCookies.forEach((name) => {
      target.cookies.set(name, "", { path: "/", maxAge: 0 });
    });
    return target;
  }

  if (shouldClearStaleAuthCookies) {
    response = clearStaleAuthCookies(response);
  }

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

  const isProtectedApiRequest =
    request.nextUrl.pathname.startsWith("/api/admin/") ||
    request.nextUrl.pathname.startsWith("/api/account/") ||
    request.nextUrl.pathname.startsWith("/api/roamly/") ||
    request.nextUrl.pathname.startsWith("/api/trips/") ||
    request.nextUrl.pathname.startsWith("/api/stripe/checkout/") ||
    request.nextUrl.pathname === "/api/stripe/create-trip-checkout";

  // API routes must return their own structured 401 response. Never redirect an
  // API request to the HTML login page.
  if (isProtectedApiRequest && !user) {
    logMiddlewareAuth("middleware_api_auth_deferred", {
      reasonCode: hasSupabaseAuthCookie(request)
        ? "auth_cookie_present_user_pending"
        : "api_route_handles_missing_session",
      getUserOk: false,
      getUserError: userError ? userError.name || "auth_error" : null,
      authenticatedUserId: null,
      authenticatedEmail: null
    });

    return clearStaleAuthCookies(response);
  }

  // A genuine absence of both user and auth cookie can redirect immediately.
  if (
    isProtectedPage(request.nextUrl.pathname) &&
    !user &&
    !hasSupabaseAuthCookie(request)
  ) {
    return clearStaleAuthCookies(
      redirectWithAuthCookies(
        loginRedirectUrl(request),
        "missing_auth_cookie",
        null
      )
    );
  }

  // When an auth cookie exists, getUser() can briefly return null while
  // Supabase refreshes or the browser/server session is being synchronized.
  // Do not turn that temporary state into another OAuth login.
  if (
    isProtectedPage(request.nextUrl.pathname) &&
    !user &&
    hasSupabaseAuthCookie(request)
  ) {
    logMiddlewareAuth("middleware_auth_cookie_user_pending", {
      reasonCode: "auth_cookie_present_user_pending",
      getUserOk: false,
      getUserError: userError ? userError.name || "auth_error" : null,
      authenticatedUserId: null,
      authenticatedEmail: null
    });

    return attachRefreshedCookies(response);
  }

  return clearStaleAuthCookies(response);
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
