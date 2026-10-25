import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/roamly/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  backfillGmailTripWindow,
  exchangeGmailCodeForTokens,
  getGmailProfile,
  GMAIL_OAUTH_STATE_COOKIE,
  renewGmailWatch,
  syncGmailConnection,
  upsertGmailConnection,
  verifiedGmailOAuthStateUserId
} from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(GMAIL_OAUTH_STATE_COOKIE)?.value || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const code = request.nextUrl.searchParams.get("code") || "";
  cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });

  const signedStateUserId = verifiedGmailOAuthStateUserId(stateCookie, state);

  if (!signedStateUserId || !code) {
    return NextResponse.redirect(new URL("/account?gmail=failed", request.url));
  }

  const auth = await requireUser();
  const fallbackAdmin = auth.ok ? null : createSupabaseAdminClient();
  const userId = auth.ok ? auth.user.id : signedStateUserId;
  const supabase = auth.ok ? auth.supabase : fallbackAdmin;

  if (!userId || !supabase) {
    return auth.ok ? NextResponse.redirect(new URL("/account?gmail=failed", request.url)) : auth.response;
  }

  try {
    const tokens = await exchangeGmailCodeForTokens({ code, origin: request.nextUrl.origin });
    const profile = tokens.access_token ? await getGmailProfile(tokens.access_token) : null;
    const saved = await upsertGmailConnection({
      supabase,
      userId,
      tokens,
      emailAddress: profile?.emailAddress || (auth.ok ? auth.user.email || null : null)
    });
    if (!saved.connection) throw new Error(saved.error || "Gmail connection failed.");
    // Backfill BEFORE the sync and the watch renewal: the backfill
    // searches the upcoming trip window for mail the history cursor
    // has already passed, and it must run before renew anchors "now".
    // It never moves the cursor itself, and a backfill failure never
    // fails the reconnect — the normal sync still runs.
    await backfillGmailTripWindow({ supabase, userId }).catch(() => null);
    await syncGmailConnection({ supabase, userId }).catch(() => null);
    await renewGmailWatch({ supabase, connection: saved.connection }).catch(() => null);
    return NextResponse.redirect(new URL("/account?gmail=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/account?gmail=failed", request.url));
  }
}
