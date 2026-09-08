import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  operationalFingerprint,
  operationalOpaqueId,
  recordOperationalEvent,
  recordOperationalRecovery
} from "@/lib/roamly/operationalIncidents";
import {
  activationStateIsCorrect,
  generationStuckReason,
  generationTripIsComplete,
  purchaseActivationIsEligible,
  purchaseActivationAgeMs,
  type ActivationTripState,
  type GenerationDetectorJob,
  type PurchaseActivationCandidate
} from "@/lib/roamly/silentFailureDetectorLogic";

type DetectorClient = SupabaseClient;
type Recorder = typeof recordOperationalEvent;

function adminOr(client?: DetectorClient | null) {
  return createSupabaseAdminClient() || client || null;
}

function safe(value: unknown, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nowMs(value?: Date | number) {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.now();
}

async function hasOpenIncident(client: DetectorClient, params: { subsystem: "billing" | "trip_generation"; eventCode: string; fingerprintParts: string[] }) {
  const fingerprint = operationalFingerprint(params);
  const result = await client
    .from("roamly_operational_incidents")
    .select("id,status")
    .eq("fingerprint", fingerprint)
    .eq("status", "open")
    .maybeSingle();
  return !result.error && Boolean(result.data);
}

async function recoverIfOpen(params: {
  client: DetectorClient;
  recorder: Recorder;
  severity: "high" | "medium";
  subsystem: "billing" | "trip_generation";
  eventCode: string;
  fingerprintParts: string[];
  eventKey: string;
  safeMetadata: Record<string, unknown>;
}) {
  if (!(await hasOpenIncident(params.client, params))) return;
  await params.recorder({
    supabase: params.client,
    severity: params.severity,
    subsystem: params.subsystem,
    eventCode: params.eventCode,
    fingerprintParts: params.fingerprintParts,
    eventKey: params.eventKey,
    kind: "recovery",
    safeMetadata: params.safeMetadata
  });
}

export async function runPaidActivationMissingDetector(params: {
  supabase?: DetectorClient | null;
  now?: Date | number;
  recorder?: Recorder;
} = {}) {
  const client = adminOr(params.supabase);
  if (!client) return { ok: false, detected: 0, recovered: 0, error: "SUPABASE_SERVICE_ROLE_MISSING" };
  const recorder = params.recorder || recordOperationalEvent;
  const now = nowMs(params.now);
  const purchasesResult = await client
    .from("roamly_itinerary_purchases")
    .select("id,user_id,trip_id,purchase_type,status,billing_state,paid_at,created_at")
    .eq("status", "paid")
    .in("purchase_type", ["itinerary_unlock", "tracking_addon", "bundle"])
    .limit(200);
  if (purchasesResult.error) return { ok: false, detected: 0, recovered: 0, error: "PURCHASE_SCAN_FAILED" };

  const purchases = (purchasesResult.data || []) as Array<PurchaseActivationCandidate & { id: string; user_id: string; trip_id: string }>;
  if (!purchases.length) return { ok: true, detected: 0, recovered: 0 };
  const tripKeys = purchases.map((purchase) => `${purchase.id}:${purchase.user_id}:${purchase.trip_id}`);
  const tripsResult = await client
    .from("roamly_trips")
    .select("id,user_id,status,itinerary_payment_status,itinerary_unlock_source,tracking_unlocked,tracking_unlock_source,live_companion_unlocked")
    .in("id", [...new Set(purchases.map((purchase) => purchase.trip_id))]);
  if (tripsResult.error) return { ok: false, detected: 0, recovered: 0, error: "TRIP_SCAN_FAILED" };
  const trips = new Map((tripsResult.data || []).map((trip) => [`${trip.id}:${trip.user_id}`, trip as ActivationTripState & { id: string; user_id: string }]));
  let detected = 0;
  let recovered = 0;
  for (const purchase of purchases) {
    const trip = trips.get(`${purchase.trip_id}:${purchase.user_id}`);
    if (!trip || !trip.user_id || !purchase.user_id || !tripKeys.includes(`${purchase.id}:${purchase.user_id}:${purchase.trip_id}`)) continue;
    const fingerprintParts = ["paid-activation", operationalOpaqueId(["purchase", purchase.id])];
    const eventKeyBase = operationalOpaqueId(["paid-activation", purchase.id, purchase.paid_at || purchase.created_at || "unknown"]);
    if (purchaseActivationIsEligible(purchase, trip, now) && !activationStateIsCorrect(purchase, trip)) {
      const result = await recorder({
        supabase: client,
        severity: "high",
        subsystem: "billing",
        eventCode: "paid_activation_missing",
        fingerprintParts,
        eventKey: `paid-activation-missing:${eventKeyBase}`,
        safeMetadata: {
          operation: "paid_activation_missing",
          stage: "post_payment_activation",
          source: "silent_failure_detector",
          retryable: false,
          attempt_count: 1
        }
      });
      if (result.ok) detected += 1;
    } else if (trip && activationStateIsCorrect(purchase, trip)) {
      await recoverIfOpen({
        client,
        recorder,
        severity: "high",
        subsystem: "billing",
        eventCode: "paid_activation_missing",
        fingerprintParts,
        eventKey: `paid-activation-recovered:${eventKeyBase}`,
        safeMetadata: { operation: "paid_activation_recovered", source: "silent_failure_detector", recovery_reason: "activation_state_confirmed" }
      });
      recovered += 1;
    }
  }
  return { ok: true, detected, recovered };
}

export async function runStuckGenerationDetector(params: {
  supabase?: DetectorClient | null;
  now?: Date | number;
  recorder?: Recorder;
} = {}) {
  const client = adminOr(params.supabase);
  if (!client) return { ok: false, detected: 0, recovered: 0, error: "SUPABASE_SERVICE_ROLE_MISSING" };
  const recorder = params.recorder || recordOperationalEvent;
  const now = nowMs(params.now);
  const jobsResult = await client
    .from("roamly_trip_generation_jobs")
    .select("id,trip_id,user_id,status,retry_count,next_attempt_at,lease_expires_at,completed_at,dead_lettered_at,updated_at")
    .is("completed_at", null)
    .in("status", ["queued", "running", "waiting", "failed"])
    .limit(200);
  if (jobsResult.error) return { ok: false, detected: 0, recovered: 0, error: "GENERATION_SCAN_FAILED" };
  const jobs = (jobsResult.data || []) as Array<GenerationDetectorJob & { id: string; trip_id: string; user_id: string; updated_at?: string | null }>;
  if (!jobs.length) return { ok: true, detected: 0, recovered: 0 };
  const tripsResult = await client
    .from("roamly_trips")
    .select("id,user_id,status,itinerary_status,itinerary_generated_at,itinerary_payment_status,itinerary_unlock_source")
    .in("id", [...new Set(jobs.map((job) => job.trip_id))]);
  if (tripsResult.error) return { ok: false, detected: 0, recovered: 0, error: "GENERATION_TRIP_SCAN_FAILED" };
  const trips = new Map((tripsResult.data || []).map((trip) => [`${trip.id}:${trip.user_id}`, trip]));
  let detected = 0;
  let recovered = 0;
  for (const job of jobs) {
    const trip = trips.get(`${job.trip_id}:${job.user_id}`);
    if (!trip || generationTripIsComplete(trip) || ["archived", "cancelled", "completed"].includes(safe(trip.status))) continue;
    const reason = generationStuckReason(job, now);
    const fingerprintParts = ["generation-stuck", operationalOpaqueId(["generation-job", job.id])];
    const eventKeyBase = operationalOpaqueId(["generation-stuck", job.id, reason || "healthy", job.updated_at || "unknown"]);
    const paid = trip.itinerary_payment_status === "paid" || trip.itinerary_payment_status === "bundled" || trip.itinerary_unlock_source === "paid" || trip.itinerary_unlock_source === "bundle";
    if (reason) {
      const result = await recorder({
        supabase: client,
        severity: paid ? "high" : "medium",
        subsystem: "trip_generation",
        eventCode: "generation_stuck",
        fingerprintParts,
        eventKey: `generation-stuck:${eventKeyBase}`,
        safeMetadata: { operation: "generation_stuck", stage: reason, source: "silent_failure_detector", retryable: reason !== "retry_exhausted", attempt_count: Number.isInteger(job.retry_count) ? job.retry_count : 0 }
      });
      if (result.ok) detected += 1;
    } else {
      await recoverIfOpen({
        client,
        recorder,
        severity: paid ? "high" : "medium",
        subsystem: "trip_generation",
        eventCode: "generation_stuck",
        fingerprintParts,
        eventKey: `generation-recovered:${eventKeyBase}`,
        safeMetadata: { operation: "generation_recovered", source: "silent_failure_detector", recovery_reason: "job_no_longer_stuck" }
      });
      recovered += 1;
    }
  }
  return { ok: true, detected, recovered };
}

export { purchaseActivationAgeMs };
