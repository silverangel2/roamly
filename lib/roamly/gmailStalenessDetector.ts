import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { operationalFingerprint, operationalOpaqueId, recordOperationalEvent, recordOperationalRecovery } from "@/lib/roamly/operationalIncidents";
import {
  gmailConnectionIsAuthRequired,
  gmailConnectionIsStale,
  isRelevantGmailTrip,
  latestGmailCheckpoint,
  relevantTripWindow
} from "@/lib/roamly/gmailStalenessDetectorLogic";

type DetectorClient = SupabaseClient;
type Recorder = typeof recordOperationalEvent;

function adminOr(client?: DetectorClient | null) {
  return createSupabaseAdminClient() || client || null;
}

function safe(value: unknown, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function hasOpenIncident(client: DetectorClient, fingerprintParts: string[]) {
  const fingerprint = operationalFingerprint({ subsystem: "gmail", eventCode: "gmail_sync_stale", fingerprintParts });
  const result = await client.from("roamly_operational_incidents").select("id").eq("fingerprint", fingerprint).eq("status", "open").maybeSingle();
  return !result.error && Boolean(result.data);
}

async function recoverIfOpen(params: { client: DetectorClient; recorder: Recorder; fingerprintParts: string[]; eventKey: string; safeMetadata: Record<string, unknown> }) {
  if (!(await hasOpenIncident(params.client, params.fingerprintParts))) return;
  await params.recorder({
    supabase: params.client,
    severity: "medium",
    subsystem: "gmail",
    eventCode: "gmail_sync_stale",
    fingerprintParts: params.fingerprintParts,
    eventKey: params.eventKey,
    kind: "recovery",
    safeMetadata: params.safeMetadata
  });
}

export async function runGmailStalenessDetector(params: { supabase?: DetectorClient | null; now?: Date | number; recorder?: Recorder } = {}) {
  const client = adminOr(params.supabase);
  if (!client) return { ok: false, detected: 0, recovered: 0, error: "SUPABASE_SERVICE_ROLE_MISSING" };
  const recorder = params.recorder || recordOperationalEvent;
  const now = params.now instanceof Date ? params.now.getTime() : typeof params.now === "number" ? params.now : Date.now();
  const { today, horizon } = relevantTripWindow(now);
  const tripsResult = await client
    .from("roamly_trips")
    .select("id,user_id,start_date,end_date,status")
    .not("start_date", "is", null)
    .lte("start_date", horizon)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .limit(200);
  if (tripsResult.error) return { ok: false, detected: 0, recovered: 0, error: "RELEVANT_TRIP_SCAN_FAILED" };
  const relevantTrips = (tripsResult.data || []).filter((trip) => isRelevantGmailTrip(trip, today, horizon));
  if (!relevantTrips.length) return { ok: true, detected: 0, recovered: 0 };
  const userIds = [...new Set(relevantTrips.map((trip) => trip.user_id).filter(Boolean))];
  const connectionsResult = await client
    .from("email_connections")
    .select("id,user_id,provider,connection_status,last_synced_at,created_at")
    .eq("provider", "gmail")
    .in("user_id", userIds)
    .in("connection_status", ["connected", "needs_reauth", "disconnected"])
    .limit(200);
  if (connectionsResult.error) return { ok: false, detected: 0, recovered: 0, error: "GMAIL_CONNECTION_SCAN_FAILED" };
  const connections = connectionsResult.data || [];
  if (!connections.length) return { ok: true, detected: 0, recovered: 0 };
  let detected = 0;
  let recovered = 0;
  for (const connection of connections) {
    const fingerprintParts = ["gmail-sync", operationalOpaqueId(["gmail-connection", connection.id])];
    const checkpoint = latestGmailCheckpoint(connection);
    const checkpointKey = checkpoint === null ? "none" : new Date(checkpoint).toISOString();
    const eventKey = operationalOpaqueId(["gmail-sync-stale", connection.id, checkpointKey]);
    if (gmailConnectionIsAuthRequired(connection.connection_status) || !gmailConnectionIsStale(connection, now)) {
      await recoverIfOpen({
        client,
        recorder,
        fingerprintParts,
        eventKey: `gmail-sync-recovered:${eventKey}`,
        safeMetadata: { operation: "gmail_sync_recovered", provider: "gmail", source: "silent_failure_detector", recovery_reason: gmailConnectionIsAuthRequired(connection.connection_status) ? "customer_reconnect_required" : "sync_checkpoint_current" }
      });
      recovered += 1;
      continue;
    }
    const result = await recorder({
      supabase: client,
      severity: "medium",
      subsystem: "gmail",
      eventCode: "gmail_sync_stale",
      fingerprintParts,
      eventKey: `gmail-sync-stale:${eventKey}`,
      safeMetadata: {
        operation: "gmail_sync_stale",
        provider: "gmail",
        stage: "persisted_checkpoint",
        source: "silent_failure_detector",
        retryable: true
      },
      affectedAccountCount: 1,
      affectedTripCount: relevantTrips.filter((trip) => trip.user_id === connection.user_id).length
    });
    if (result.ok) detected += 1;
  }
  return { ok: true, detected, recovered };
}
