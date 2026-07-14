import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncGmailConnection } from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";

function authorized(request: NextRequest) {
  const secret = process.env.ROAMLY_GMAIL_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("x-roamly-gmail-webhook-secret") === secret || request.nextUrl.searchParams.get("token") === secret;
}

function decodedMessage(data?: string | null) {
  if (!data) return {};
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized Gmail webhook." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "Supabase service role is not configured." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { message?: { data?: string | null } };
  const message = decodedMessage(body.message?.data);
  const emailAddress = typeof message.emailAddress === "string" ? message.emailAddress : "";
  if (!emailAddress) return NextResponse.json({ ok: true, processed: 0 });

  const { data: connections } = await admin
    .from("email_connections")
    .select("user_id")
    .eq("provider", "gmail")
    .eq("email_address", emailAddress)
    .neq("connection_status", "disconnected");

  const results = [];
  for (const connection of connections || []) {
    results.push(await syncGmailConnection({ supabase: admin, userId: String((connection as { user_id: string }).user_id) }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "GMAIL_SYNC_FAILED" })));
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
