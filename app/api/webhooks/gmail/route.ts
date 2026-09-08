import { after, NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncGmailConnection } from "@/lib/roamly/emailConnections";
import { operationalOpaqueId, recordOperationalEvent } from "@/lib/roamly/operationalIncidents";

export const runtime = "nodejs";

function authorized(request: NextRequest) {
  const secret = process.env.ROAMLY_GMAIL_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("x-roamly-gmail-webhook-secret") === secret;
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

  const body = (await request.json().catch(() => ({}))) as { message?: { data?: string | null; messageId?: string | null } };
  const message = decodedMessage(body.message?.data);
  const emailAddress = typeof message.emailAddress === "string" ? message.emailAddress : "";
  const historyId = typeof message.historyId === "string" ? message.historyId : "";
  if (!emailAddress) return NextResponse.json({ ok: true, processed: 0 });

  after(async () => {
    const { data: connections } = await admin
      .from("email_connections")
      .select("id,user_id")
      .eq("provider", "gmail")
      .eq("email_address", emailAddress)
      .neq("connection_status", "disconnected");

    for (const connection of connections || []) {
      const connectionRow = connection as { id: string; user_id: string };
      const result = await syncGmailConnection({ supabase: admin, userId: String(connectionRow.user_id) }).catch(() => ({ ok: false, error: "GMAIL_SYNC_EXCEPTION" }));
      if (result.ok === false && result.error !== "GMAIL_REAUTH_REQUIRED") {
        void recordOperationalEvent({
          severity: "medium",
          subsystem: "gmail",
          eventCode: "gmail_sync_failed",
          fingerprintParts: ["gmail_sync", result.error || "unknown_failure"],
          eventKey: operationalOpaqueId(["gmail", connectionRow.id, historyId || body.message?.messageId || "notification", result.error || "unknown_failure"]),
          correlationId: operationalOpaqueId(["gmail-correlation", body.message?.messageId || historyId || "notification"]),
          safeMetadata: { operation: "gmail_sync", stage: "webhook", failure_class: result.error || "unknown_failure" }
        });
      }
    }
  });

  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
