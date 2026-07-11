import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureRoamlyProfile } from "@/lib/roamly/profile";
import { safeNextPath } from "@/lib/navigation";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next") || undefined);
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
    await ensureRoamlyProfile(data.user, {}, supabase);
    return NextResponse.redirect(redirectUrl);
  }

  return loginRedirect("missing_session");
}
