import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseConfig } from "@/lib/supabase/config";
import { applyCookieHeaders, normalizeSupabaseCookieOptions } from "@/lib/supabase/cookies";
import {
  getSupabaseAuthCookieDiagnostics,
  getSupabaseProjectHost,
  isSupabaseAuthCookieName,
  logAuthDiagnostic
} from "@/lib/roamly/authDiagnostics";

type SessionSyncBody = {
  access_token?: unknown;
  refresh_token?: unknown;
};

function readToken(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_NOT_CONFIGURED", message: "Supabase is not configured." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as SessionSyncBody;
  const accessToken = readToken(body.access_token);
  const refreshToken = readToken(body.refresh_token);

  if (!accessToken || !refreshToken) {
    return NextResponse.json({ ok: false, error: "SESSION_REQUIRED" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  let authCookieWriteCount = 0;
  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>,
        headersToSet: Record<string, string> = {}
      ) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, normalizeSupabaseCookieOptions(options));
          if (isSupabaseAuthCookieName(name)) {
            authCookieWriteCount += 1;
          }
        });
        applyCookieHeaders(response.headers, headersToSet);
      }
    }
  });

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  if (error || !data.user) {
    logAuthDiagnostic("session_sync_failed", {
      path: request.nextUrl.pathname,
      ...getSupabaseAuthCookieDiagnostics(request.headers.get("cookie") || ""),
      getUserOk: false,
      getUserError: error ? error.name || "auth_error" : "missing_user",
      supabaseProjectHost: getSupabaseProjectHost(),
      refreshedCookiesAttached: authCookieWriteCount > 0,
      authCookieWriteCount,
      reasonCode: "set_session_failed"
    });
    return NextResponse.json({ ok: false, error: "SESSION_SYNC_FAILED" }, { status: 401 });
  }

  logAuthDiagnostic("session_sync_succeeded", {
    path: request.nextUrl.pathname,
    ...getSupabaseAuthCookieDiagnostics(request.headers.get("cookie") || ""),
    getUserOk: true,
    authenticatedUserId: data.user.id,
    authenticatedEmail: data.user.email || null,
    supabaseProjectHost: getSupabaseProjectHost(),
    refreshedCookiesAttached: authCookieWriteCount > 0,
    authCookieWriteCount,
    reasonCode: null
  });

  return response;
}
