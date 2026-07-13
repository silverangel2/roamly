import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseConfig } from "@/lib/supabase/config";

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
  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  if (error || !data.user) {
    return NextResponse.json({ ok: false, error: "SESSION_SYNC_FAILED" }, { status: 401 });
  }

  return response;
}
