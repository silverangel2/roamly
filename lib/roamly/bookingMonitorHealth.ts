import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { operationalFingerprint, operationalOpaqueId, recordOperationalEvent } from "@/lib/roamly/operationalIncidents";
import { classifyBookingMonitorHealth, type BookingMonitorRun } from "@/lib/roamly/bookingMonitorHealthLogic";

type DetectorClient = SupabaseClient;
type Recorder = typeof recordOperationalEvent;

const SYSTEM_KEY = "booking_monitor";
const FINGERPRINT_PARTS = ["booking-monitor-system"];

function adminOr(client?: DetectorClient | null) {
  return createSupabaseAdminClient() || client || null;
}

async function ensureBootstrap(client: DetectorClient) {
  const initialized = await client
    .from("roamly_background_health")
    .upsert({ system_key: SYSTEM_KEY }, { onConflict: "system_key", ignoreDuplicates: true });
  if (initialized.error) return null;
  const result = await client
    .from("roamly_background_health")
    .select("system_key,monitoring_started_at")
    .eq("system_key", SYSTEM_KEY)
    .maybeSingle();
  return result.error ? null : result.data;
}

async function hasOpenIncident(client: DetectorClient) {
  const fingerprint = operationalFingerprint({ subsystem: "background_jobs", eventCode: "booking_monitor_stale", fingerprintParts: FINGERPRINT_PARTS });
  const result = await client.from("roamly_operational_incidents").select("id").eq("fingerprint", fingerprint).eq("status", "open").maybeSingle();
  return !result.error && Boolean(result.data);
}

export async function runBookingMonitorHealthDetector(params: { supabase?: DetectorClient | null; now?: Date | number; recorder?: Recorder } = {}) {
  const client = adminOr(params.supabase);
  if (!client) return { ok: false, detected: 0, recovered: 0, error: "SUPABASE_SERVICE_ROLE_MISSING" };
  const recorder = params.recorder || recordOperationalEvent;
  const now = params.now instanceof Date ? params.now.getTime() : typeof params.now === "number" ? params.now : Date.now();
  const bootstrap = await ensureBootstrap(client);
  if (!bootstrap) return { ok: false, detected: 0, recovered: 0, error: "BOOKING_MONITOR_BOOTSTRAP_READ_FAILED" };

  const result = await client
    .from("roamly_booking_monitor_runs")
    .select("id,status,started_at,completed_at,failures")
    .order("started_at", { ascending: false })
    .limit(20);
  if (result.error) return { ok: false, detected: 0, recovered: 0, error: "BOOKING_MONITOR_RUN_SCAN_FAILED" };

  const health = classifyBookingMonitorHealth((result.data || []) as BookingMonitorRun[], now, bootstrap.monitoring_started_at);
  const eventKey = operationalOpaqueId(["booking-monitor-health", health.reason]);
  const latest = health.latest;
  const safeMetadata = {
    operation: "booking_monitor_health",
    source: "independent_generation_cron",
    reason: health.reason,
    stage: latest?.status || "none",
    retryable: health.state === "stale"
  };

  if (health.state !== "stale") {
    if (!(await hasOpenIncident(client))) return { ok: true, detected: 0, recovered: 0, state: health.state };
    const recovery = await recorder({
      supabase: client,
      severity: "high",
      subsystem: "background_jobs",
      eventCode: "booking_monitor_stale",
      fingerprintParts: FINGERPRINT_PARTS,
      eventKey: `booking-monitor-recovered:${eventKey}`,
      kind: "recovery",
      safeMetadata: { operation: "booking_monitor_health_recovered", source: "independent_generation_cron", recovery_reason: health.reason }
    });
    return { ok: recovery.ok, detected: 0, recovered: recovery.ok ? 1 : 0, state: health.state };
  }

  const incident = await recorder({
    supabase: client,
    severity: "high",
    subsystem: "background_jobs",
    eventCode: "booking_monitor_stale",
    fingerprintParts: FINGERPRINT_PARTS,
    eventKey: `booking-monitor-stale:${eventKey}`,
    safeMetadata
  });
  return { ok: incident.ok, detected: incident.ok ? 1 : 0, recovered: 0, state: health.state };
}
