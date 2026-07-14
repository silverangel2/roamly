import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/roamly/auth";
import { createOAuthState, GMAIL_OAUTH_STATE_COOKIE, gmailAuthorizationUrl, gmailOAuthConfigured } from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!gmailOAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "Gmail connection is not configured." }, { status: 503 });
  }

  const state = createOAuthState();
  const cookieStore = await cookies();
  cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 600
  });

  return NextResponse.redirect(gmailAuthorizationUrl({ state, origin: request.nextUrl.origin }));
}
