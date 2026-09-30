import { NextRequest, NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  GMAIL_PROVIDER,
  OUTLOOK_PROVIDER,
  syncGmailConnection,
  syncOutlookConnection
} from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_CONNECTIONS_PER_RUN = 50;
const RECENT_SYNC_SKIP_MS = 20 * 60_000;

/**
 * Scheduled email import: every 30 minutes, sync Gmail/Outlook connections
 * for travelers with an upcoming or active trip. Each sync respects the
 * per-connection lease so overlapping runs never double-process a mailbox.
 */
export async function GET(request: NextRequest) {
  const expected = (
    process.env.ROAMLY_NOTIFICATION_CRON_SECRET ||
    process.env.CRON_SECRET ||
    ""
  ).trim();

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Email sync cron secret is not configured." },
      { status: 503 }
    );
  }

  if (!isCronRequestAuthorized(request.headers, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized cron." }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data: activeTrips, error: tripsError } = await supabase
    .from("roamly_trips")
    .select("user_id")
    .neq("status", "archived")
    .gte("end_date", today)
    .limit(2000);

  if (tripsError) {
    return NextResponse.json({ ok: false, error: "TRIP_LOOKUP_FAILED" }, { status: 500 });
  }

  const activeUserIds = new Set(
    (activeTrips || []).map((trip) => String((trip as { user_id: unknown }).user_id)).filter(Boolean)
  );
  if (activeUserIds.size === 0) {
    return NextResponse.json({ ok: true, synced: 0, skipped: 0, total: 0 });
  }

  const { data: connections, error: connectionsError } = await supabase
    .from("email_connections")
    .select("user_id,provider,last_synced_at")
    .neq("connection_status", "disconnected")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(500);

  if (connectionsError) {
    return NextResponse.json({ ok: false, error: "CONNECTION_LOOKUP_FAILED" }, { status: 500 });
  }

  const now = Date.now();
  const candidates = (connections || [])
    .filter((connection) => {
      const userId = String((connection as { user_id: unknown }).user_id || "");
      if (!userId || !activeUserIds.has(userId)) return false;
      const lastSynced = (connection as { last_synced_at?: string | null }).last_synced_at;
      if (lastSynced) {
        const syncedAt = new Date(lastSynced).getTime();
        if (Number.isFinite(syncedAt) && now - syncedAt < RECENT_SYNC_SKIP_MS) return false;
      }
      return true;
    })
    .slice(0, MAX_CONNECTIONS_PER_RUN);

  let synced = 0;
  let skipped = 0;
  const failures: Array<{ userId: string; provider: string; error: string }> = [];

  for (const connection of candidates) {
    const userId = String((connection as { user_id: unknown }).user_id || "");
    const provider = String((connection as { provider?: unknown }).provider || "");
    try {
      const result =
        provider === OUTLOOK_PROVIDER
          ? await syncOutlookConnection({ supabase, userId })
          : await syncGmailConnection({ supabase, userId });
      if (result.ok) {
        synced += 1;
      } else {
        skipped += 1;
        failures.push({
          userId,
          provider: provider || GMAIL_PROVIDER,
          error: typeof result.error === "string" ? result.error : "SYNC_FAILED"
        });
      }
    } catch (err) {
      skipped += 1;
      failures.push({
        userId,
        provider: provider || GMAIL_PROVIDER,
        error: err instanceof Error ? err.message : "SYNC_FAILED"
      });
    }
  }

  return NextResponse.json({
    ok: true,
    synced,
    skipped,
    total: candidates.length,
    failures: failures.slice(0, 10)
  });
}
