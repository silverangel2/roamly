import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { ensureRoamlyProfileBestEffort } from "@/lib/roamly/profile";
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

function readCookieNext(value?: string) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathnameFromPath(path: string) {
  return path.split(/[?#]/, 1)[0];
}

function selectAuthNextPath(queryNext: string | null, cookieNext: string | undefined) {
  const nextPath = safeAuthNextPath(queryNext || undefined);
  const pendingPlannerNext = safeAuthNextPath(cookieNext, "");

  if (pathnameFromPath(pendingPlannerNext) === "/plan") {
    const nextPathname = pathnameFromPath(nextPath);
    if (nextPathname === "/plan" || nextPathname === "/dashboard") return pendingPlannerNext;
  }

  return nextPath;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const cookieNext = readCookieNext(request.cookies.get(AUTH_NEXT_COOKIE)?.value);
  const next = selectAuthNextPath(requestUrl.searchParams.get("next"), cookieNext);
  const redirectUrl = new URL(next, requestUrl.origin);
  const providerError = requestUrl.searchParams.get("error");
  const cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }> = [];
  let responseCookieHeaders: Record<string, string> = {};

  function loginRedirect(error: string) {
    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set("next", next);
    loginUrl.searchParams.set("error", error);
    return NextResponse.redirect(loginUrl);
  }

  function redirectWithAuthCookies(url: URL) {
    const response = NextResponse.redirect(url);
    cookiesToSet.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    applyCookieHeaders(response.headers, responseCookieHeaders);
    response.cookies.set(AUTH_NEXT_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }

  logAuthDiagnostic("oauth_callback_start", {
    path: requestUrl.pathname,
    next,
    codePresent: Boolean(code),
    providerErrorPresent: Boolean(providerError),
    ...getSupabaseAuthCookieDiagnostics(request.headers.get("cookie") || ""),
    supabaseProjectHost: getSupabaseProjectHost()
  });

  if (!hasSupabaseConfig()) {
    return loginRedirect("supabase_not_configured");
  }

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        nextCookies: Array<{ name: string; value: string; options: CookieOptions }>,
        headersToSet: Record<string, string> = {}
      ) {
        nextCookies.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        responseCookieHeaders = headersToSet;
        cookiesToSet.push(
          ...nextCookies.map(({ name, value, options }) => ({
            name,
            value,
            options: normalizeSupabaseCookieOptions(options)
          }))
        );
      }
    }
  });

  if (providerError) {
    return loginRedirect("oauth_failed");
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logAuthDiagnostic("oauth_callback_exchange_failed", {
        path: requestUrl.pathname,
        errorName: error.name || "auth_error",
        supabaseProjectHost: getSupabaseProjectHost()
      });
      return loginRedirect("oauth_exchange_failed");
    }
  }

  const { data } = await supabase.auth.getUser();

  logAuthDiagnostic("oauth_callback_user_result", {
    path: requestUrl.pathname,
    getUserOk: Boolean(data.user),
    authenticatedUserId: data.user?.id || null,
    authenticatedEmail: data.user?.email || null,
    authCookiesWritten: cookiesToSet.some((cookie) => isSupabaseAuthCookieName(cookie.name)),
    authCookieWriteCount: cookiesToSet.filter((cookie) => isSupabaseAuthCookieName(cookie.name)).length,
    supabaseProjectHost: getSupabaseProjectHost(),
    refreshedCookiesAttached: cookiesToSet.some((cookie) => isSupabaseAuthCookieName(cookie.name)),
    redirectDestination: data.user ? `${redirectUrl.pathname}${redirectUrl.search}` : null,
    reasonCode: data.user ? null : "missing_session"
  });

  if (data.user) {
    await ensureRoamlyProfileBestEffort(data.user, {}, supabase, "oauth_callback");
    return redirectWithAuthCookies(redirectUrl);
  }

  return loginRedirect("missing_session");
}
