import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncOutlookConnection } from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";

function secret() {
  return process.env.ROAMLY_OUTLOOK_WEBHOOK_SECRET?.trim() || "";
}

function authorized(request: NextRequest, clientState?: string | null) {
  const expected = secret();
  if (!expected) return false;
  return (
    request.headers.get("x-roamly-outlook-webhook-secret") === expected ||
    request.nextUrl.searchParams.get("token") === expected ||
    clientState === expected
  );
}

function validationResponse(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("validationToken");
  if (!token) return null;
  return new NextResponse(token, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function GET(request: NextRequest) {
  const validation = validationResponse(request);
  if (validation) return validation;
  return NextResponse.json({ ok: false, error: "Unauthorized Outlook webhook." }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const validation = validationResponse(request);
  if (validation) return validation;

  const body = (await request.json().catch(() => ({}))) as {
    value?: Array<{ subscriptionId?: string | null; clientState?: string | null }>;
  };
  const notifications = Array.isArray(body.value) ? body.value : [];
  if (!notifications.every((item) => authorized(request, item.clientState))) {
    return NextResponse.json({ ok: false, error: "Unauthorized Outlook webhook." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "Supabase service role is not configured." }, { status: 503 });

  const subscriptionIds = notifications.map((item) => item.subscriptionId).filter((value): value is string => Boolean(value));
  if (subscriptionIds.length === 0) return NextResponse.json({ ok: true, processed: 0 });

  const { data: watches } = await admin
    .from("email_watch_subscriptions")
    .select("email_connection_id,external_subscription_id,email_connections(user_id)")
    .eq("provider", "outlook")
    .in("external_subscription_id", subscriptionIds);

  const userIds = new Set<string>();
  for (const watch of watches || []) {
    const connection = (watch as { email_connections?: { user_id?: string } | { user_id?: string }[] }).email_connections;
    if (Array.isArray(connection)) {
      connection.forEach((item) => item.user_id && userIds.add(item.user_id));
    } else if (connection?.user_id) {
      userIds.add(connection.user_id);
    }
  }

  const results = [];
  for (const userId of userIds) {
    results.push(await syncOutlookConnection({ supabase: admin, userId }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "OUTLOOK_SYNC_FAILED" })));
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
