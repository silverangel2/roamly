import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { upsertRoamlyProfile } from "@/lib/profiles";
import { safeNextPath } from "@/lib/navigation";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next") || undefined);
  const redirectUrl = new URL(next, requestUrl.origin);
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set("error", "supabase_not_configured");
    return NextResponse.redirect(loginUrl);
  }

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  const { data } = await supabase.auth.getUser();

  if (data.user) {
    await upsertRoamlyProfile(supabase, data.user);
  }

  return NextResponse.redirect(redirectUrl);
}
