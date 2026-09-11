import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  operationalFingerprint,
  operationalOpaqueId,
  recordOperationalEvent
} from "@/lib/roamly/operationalIncidents";
import {
  COMMUNICATION_STUCK_GRACE_MS,
  classifyCommunicationStuck,
  communicationStuckStateKey,
  notificationSchedulerIsStale,
  NOTIFICATION_SCHEDULER_GRACE_MS,
  type CommunicationLedgerCandidate
} from "@/lib/roamly/communicationStuckLogic";

type DetectorClient = SupabaseClient;
type Recorder = typeof recordOperationalEvent;
const SYSTEM_KEY = "notification_scheduler";
const FAILURE_CLASSES = ["due_never_processed", "abandoned_claim", "overdue_retry", "retry_exhaustion"] as const;

function adminOr(client?: DetectorClient | null) {
  return createSupabaseAdminClient() || client || null;
}

function safeNumber(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function fingerprint(failureClass: string, candidateId: string) {
  return operationalFingerprint({
    subsystem: "customer_email",
    eventCode: "communication_stuck",
    fingerprintParts: [failureClass, operationalOpaqueId(["communication", candidateId])]
  });
}

async function openFingerprints(client: DetectorClient) {
  const result = await client
    .from("roamly_operational_incidents")
    .select("fingerprint")
    .eq("event_code", "communication_stuck")
    .eq("status", "open")
    .limit(200);
  return result.error ? new Set<string>() : new Set((result.data || []).map((row) => row.fingerprint));
}

function failureEventKey(finding: ReturnType<typeof classifyCommunicationStuck>) {
  if (!finding) return "";
  return `communication-stuck:${operationalOpaqueId([finding.candidate.id, communicationStuckStateKey(finding)])}`;
}

export async function runCommunicationStuckDetector(params: {
  supabase?: DetectorClient | null;
  now?: Date | number;
  recorder?: Recorder;
} = {}) {
  const client = adminOr(params.supabase);
  if (!client) return { ok: false, detected: 0, recovered: 0, error: "SUPABASE_SERVICE_ROLE_MISSING" };
  const recorder = params.recorder || recordOperationalEvent;
  const now = params.now instanceof Date ? params.now.getTime() : typeof params.now === "number" ? params.now : Date.now();
  const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const ledgerResult = await client
    .from("roamly_communication_ledger")
    .select("id,status,scheduled_for,useful_until,attempt_count,max_attempts,retryable,next_retry_at,claimed_at,sent_at,suppression_reason,last_error_code,metadata,updated_at")
    .in("status", ["pending", "claimed", "failed", "sent", "suppressed"])
    .gte("scheduled_for", cutoff)
    .order("scheduled_for", { ascending: true })
    .limit(200);
  if (ledgerResult.error) return { ok: false, detected: 0, recovered: 0, error: "COMMUNICATION_SCAN_FAILED" };

  const healthResult = await client
    .from("roamly_background_health")
    .select("system_key,last_successful_at,monitoring_started_at")
    .eq("system_key", SYSTEM_KEY)
    .maybeSingle();
  if (healthResult.error) return { ok: false, detected: 0, recovered: 0, error: "NOTIFICATION_HEALTH_SCAN_FAILED" };

  const candidates = (ledgerResult.data || []) as CommunicationLedgerCandidate[];
  const open = await openFingerprints(client);
  let detected = 0;
  let recovered = 0;
  for (const candidate of candidates) {
    const finding = classifyCommunicationStuck(candidate, now, COMMUNICATION_STUCK_GRACE_MS);
    if (finding) {
      const result = await recorder({
        supabase: client,
        severity: finding.failureClass === "retry_exhaustion" ? "high" : "medium",
        subsystem: "customer_email",
        eventCode: "communication_stuck",
        fingerprintParts: [finding.failureClass, operationalOpaqueId(["communication", candidate.id])],
        eventKey: failureEventKey(finding),
        safeMetadata: {
          failure_class: finding.failureClass,
          operation: "communication_stuck",
          source: "independent_generation_cron",
          retryable: finding.failureClass !== "retry_exhaustion",
          attempt_count: safeNumber(candidate.attempt_count)
        }
      });
      if (result.ok) detected += 1;
      continue;
    }
    for (const failureClass of FAILURE_CLASSES) {
      const incidentFingerprint = fingerprint(failureClass, candidate.id);
      if (!open.has(incidentFingerprint)) continue;
      const recovery = await recorder({
        supabase: client,
        severity: failureClass === "retry_exhaustion" ? "high" : "medium",
        subsystem: "customer_email",
        eventCode: "communication_stuck",
        fingerprintParts: [failureClass, operationalOpaqueId(["communication", candidate.id])],
        eventKey: `communication-stuck-recovered:${operationalOpaqueId([candidate.id, failureClass, candidate.updated_at || candidate.status])}`,
        kind: "recovery",
        safeMetadata: {
          operation: "communication_stuck_recovered",
          source: "independent_generation_cron",
          recovery_reason: "communication_no_longer_actionable"
        }
      });
      if (recovery.ok) recovered += 1;
    }
  }

  const schedulerStale = notificationSchedulerIsStale(
    healthResult.data?.last_successful_at,
    now,
    healthResult.data?.monitoring_started_at,
    NOTIFICATION_SCHEDULER_GRACE_MS
  );
  const schedulerParts = ["notification-scheduler"];
  const schedulerFingerprint = operationalFingerprint({ subsystem: "background_jobs", eventCode: "communication_stuck", fingerprintParts: schedulerParts });
  const schedulerOpen = open.has(schedulerFingerprint);
  if (schedulerStale) {
    const result = await recorder({
      supabase: client,
      severity: "high",
      subsystem: "background_jobs",
      eventCode: "communication_stuck",
      fingerprintParts: schedulerParts,
      eventKey: `communication-stuck-scheduler:${operationalOpaqueId([healthResult.data?.last_successful_at || "none", expectedSchedulerState(now)])}`,
      safeMetadata: { failure_class: "scheduler_stale", operation: "communication_stuck", source: "independent_generation_cron", retryable: true }
    });
    if (result.ok) detected += 1;
  } else if (schedulerOpen) {
    const result = await recorder({
      supabase: client,
      severity: "high",
      subsystem: "background_jobs",
      eventCode: "communication_stuck",
      fingerprintParts: schedulerParts,
      eventKey: `communication-stuck-scheduler-recovered:${operationalOpaqueId([healthResult.data?.last_successful_at || "none", expectedSchedulerState(now)])}`,
      kind: "recovery",
      safeMetadata: { operation: "communication_stuck_recovered", source: "independent_generation_cron", recovery_reason: "notification_scheduler_heartbeat_current" }
    });
    if (result.ok) recovered += 1;
  }
  return { ok: true, detected, recovered, schedulerStale };
}

function expectedSchedulerState(now: number) {
  const date = new Date(now);
  date.setUTCHours(13, 0, 0, 0);
  if (date.getTime() > now) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString();
}
