import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/roamly/auth";
import { createOAuthState, OUTLOOK_OAUTH_STATE_COOKIE, outlookAuthorizationUrl, outlookOAuthConfigured } from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!outlookOAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "Outlook connection is not configured." }, { status: 503 });
  }

  const state = createOAuthState();
  const cookieStore = await cookies();
  cookieStore.set(OUTLOOK_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 600
  });

  return NextResponse.redirect(outlookAuthorizationUrl({ state, origin: request.nextUrl.origin }));
}
