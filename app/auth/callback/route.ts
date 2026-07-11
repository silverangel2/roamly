import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureRoamlyProfileBestEffort } from "@/lib/roamly/profile";
import { safeAuthNextPath } from "@/lib/navigation";

const AUTH_NEXT_COOKIE = "roamly_auth_next";

function readCookieNext(value?: string) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const cookieNext = readCookieNext(request.cookies.get(AUTH_NEXT_COOKIE)?.value);
  const next = safeAuthNextPath(requestUrl.searchParams.get("next") || cookieNext || undefined);
  const redirectUrl = new URL(next, requestUrl.origin);
  const providerError = requestUrl.searchParams.get("error");
  const supabase = await createSupabaseServerClient();

  function loginRedirect(error: string) {
    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set("next", next);
    loginUrl.searchParams.set("error", error);
    return NextResponse.redirect(loginUrl);
  }

  if (!supabase) {
    return loginRedirect("supabase_not_configured");
  }

  if (providerError) {
    return loginRedirect("oauth_failed");
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return loginRedirect("oauth_exchange_failed");
    }
  }

  const { data } = await supabase.auth.getUser();

  if (data.user) {
    await ensureRoamlyProfileBestEffort(data.user, {}, supabase, "oauth_callback");
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(AUTH_NEXT_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }

  return loginRedirect("missing_session");
}
