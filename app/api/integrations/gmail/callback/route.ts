import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/roamly/auth";
import {
  exchangeGmailCodeForTokens,
  getGmailProfile,
  GMAIL_OAUTH_STATE_COOKIE,
  renewGmailWatch,
  upsertGmailConnection
} from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GMAIL_OAUTH_STATE_COOKIE)?.value || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const code = request.nextUrl.searchParams.get("code") || "";
  cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });

  if (!expectedState || expectedState !== state || !code) {
    return NextResponse.redirect(new URL("/account?gmail=failed", request.url));
  }

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const tokens = await exchangeGmailCodeForTokens({ code, origin: request.nextUrl.origin });
    const profile = tokens.access_token ? await getGmailProfile(tokens.access_token) : null;
    const saved = await upsertGmailConnection({
      supabase: auth.supabase,
      userId: auth.user.id,
      tokens,
      emailAddress: profile?.emailAddress || auth.user.email || null
    });
    if (!saved.connection) throw new Error(saved.error || "Gmail connection failed.");
    await renewGmailWatch({ supabase: auth.supabase, connection: saved.connection }).catch(() => null);
    return NextResponse.redirect(new URL("/account?gmail=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/account?gmail=failed", request.url));
  }
}
