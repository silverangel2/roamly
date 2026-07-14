import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  syncGmailConnection,
  syncOutlookConnection
} from "@/lib/roamly/emailConnections";

type ConnectionRow = {
  id: string;
  user_id: string;
  provider: "gmail" | "outlook";
  last_synced_at: string | null;
};

const LOCK_NAME = "roamly-booking-monitor";
const LOCK_MINUTES = 12;
const SYNC_INTERVAL_MINUTES = 10;
const MAX_CONNECTIONS_PER_RUN = 25;

async function acquireMonitorLock() {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      ok: false as const,
      acquired: false,
      error: "Supabase service role is not configured."
    };
  }

  const now = new Date();
  const lockOwner = randomUUID();
  const lockedUntil = new Date(
    now.getTime() + LOCK_MINUTES * 60_000
  ).toISOString();

  await admin
    .from("roamly_cron_locks")
    .upsert(
      {
        lock_name: LOCK_NAME,
        locked_until: new Date(0).toISOString(),
        locked_by: null,
        updated_at: now.toISOString()
      },
      {
        onConflict: "lock_name",
        ignoreDuplicates: true
      }
    );

  const result = await admin
    .from("roamly_cron_locks")
    .update({
      locked_until: lockedUntil,
      locked_by: lockOwner,
      updated_at: now.toISOString()
    })
    .eq("lock_name", LOCK_NAME)
    .lte("locked_until", now.toISOString())
    .select("lock_name,locked_by,locked_until")
    .maybeSingle();

  if (result.error) {
    return {
      ok: false as const,
      acquired: false,
      error: result.error.message
    };
  }

  return {
    ok: true as const,
    acquired:
      result.data?.locked_by === lockOwner,
    lockOwner,
    admin
  };
}

async function releaseMonitorLock(
  lockOwner: string
) {
  const admin = createSupabaseAdminClient();

  if (!admin) return;

  await admin
    .from("roamly_cron_locks")
    .update({
      locked_until: new Date(0).toISOString(),
      locked_by: null,
      updated_at: new Date().toISOString()
    })
    .eq("lock_name", LOCK_NAME)
    .eq("locked_by", lockOwner);
}

export async function runScheduledBookingMonitor() {
  const lock = await acquireMonitorLock();

  if (!lock.ok) {
    return {
      ok: false as const,
      skipped: false,
      error: lock.error
    };
  }

  if (!lock.acquired) {
    return {
      ok: true as const,
      skipped: true,
      reason: "Booking monitor is already running."
    };
  }

  const admin = lock.admin;
  const startedAt = new Date().toISOString();

  const runInsert = await admin
    .from("roamly_booking_monitor_runs")
    .insert({
      status: "running",
      started_at: startedAt
    })
    .select("id")
    .single();

  const runId = runInsert.data?.id as string | undefined;

  try {
    const dueBefore = new Date(
      Date.now() -
        SYNC_INTERVAL_MINUTES * 60_000
    ).toISOString();

    const connectionsResult = await admin
      .from("email_connections")
      .select("id,user_id,provider,last_synced_at")
      .eq("connection_status", "connected")
      .in("provider", ["gmail", "outlook"])
      .or(
        `last_synced_at.is.null,last_synced_at.lte.${dueBefore}`
      )
      .order("last_synced_at", {
        ascending: true,
        nullsFirst: true
      })
      .limit(MAX_CONNECTIONS_PER_RUN);

    if (connectionsResult.error) {
      throw new Error(connectionsResult.error.message);
    }

    const connections =
      (connectionsResult.data || []) as ConnectionRow[];

    const results: Array<{
      connectionId: string;
      userId: string;
      provider: string;
      ok: boolean;
      processed: number;
      error: string | null;
    }> = [];

    for (const connection of connections) {
      try {
        const syncResult =
          connection.provider === "gmail"
            ? await syncGmailConnection({
                supabase: admin,
                userId: connection.user_id
              })
            : await syncOutlookConnection({
                supabase: admin,
                userId: connection.user_id
              });

        results.push({
          connectionId: connection.id,
          userId: connection.user_id,
          provider: connection.provider,
          ok: syncResult.ok === true,
          processed: syncResult.processed || 0,
          error: syncResult.error || null
        });
      } catch (error) {
        results.push({
          connectionId: connection.id,
          userId: connection.user_id,
          provider: connection.provider,
          ok: false,
          processed: 0,
          error:
            error instanceof Error
              ? error.message
              : "Booking sync failed."
        });
      }
    }

    const failures = results.filter(
      (result) => !result.ok
    ).length;

    const messagesProcessed = results.reduce(
      (total, result) =>
        total + result.processed,
      0
    );

    const status =
      failures === 0
        ? "completed"
        : failures === results.length &&
            results.length > 0
          ? "failed"
          : "partial";

    if (runId) {
      await admin
        .from("roamly_booking_monitor_runs")
        .update({
          status,
          completed_at: new Date().toISOString(),
          connections_found: connections.length,
          connections_processed: results.length,
          messages_processed: messagesProcessed,
          failures,
          result_json: {
            results
          }
        })
        .eq("id", runId);
    }

    return {
      ok: failures === 0,
      skipped: false,
      status,
      connectionsFound: connections.length,
      connectionsProcessed: results.length,
      messagesProcessed,
      failures,
      results
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Booking monitor failed.";

    if (runId) {
      await admin
        .from("roamly_booking_monitor_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          failures: 1,
          result_json: {
            error: message
          }
        })
        .eq("id", runId);
    }

    return {
      ok: false as const,
      skipped: false,
      error: message
    };
  } finally {
    await releaseMonitorLock(lock.lockOwner);
  }
}
