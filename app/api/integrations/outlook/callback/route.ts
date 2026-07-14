import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/roamly/auth";
import {
  exchangeOutlookCodeForTokens,
  getOutlookProfile,
  OUTLOOK_OAUTH_STATE_COOKIE,
  renewOutlookSubscription,
  upsertOutlookConnection
} from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OUTLOOK_OAUTH_STATE_COOKIE)?.value || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const code = request.nextUrl.searchParams.get("code") || "";
  cookieStore.set(OUTLOOK_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });

  if (!expectedState || expectedState !== state || !code) {
    return NextResponse.redirect(new URL("/account?outlook=failed", request.url));
  }

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const tokens = await exchangeOutlookCodeForTokens({ code, origin: request.nextUrl.origin });
    const profile = tokens.access_token ? await getOutlookProfile(tokens.access_token) : null;
    const saved = await upsertOutlookConnection({
      supabase: auth.supabase,
      userId: auth.user.id,
      tokens,
      emailAddress: profile?.mail || profile?.userPrincipalName || auth.user.email || null
    });
    if (!saved.connection) throw new Error(saved.error || "Outlook connection failed.");
    await renewOutlookSubscription({ supabase: auth.supabase, connection: saved.connection, origin: request.nextUrl.origin }).catch(() => null);
    return NextResponse.redirect(new URL("/account?outlook=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/account?outlook=failed", request.url));
  }
}
