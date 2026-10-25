// OPTIONAL, SEVERABLE (Roamly incident 2026-10-25, stream 2 — Junel's
// call). Sweep-side terminal transition for pack-wait jobs.
//
// The existing ZERO_ENGINE_PACK_WAIT_TIMEOUT cap (lib/roamly/engine/
// generate.ts, outline stage) is WAKE-GATED: it only evaluates inside an
// outline advance. A job the sweep never claims therefore sits in
// generating_outline indefinitely, past the cap, with no failure and no
// completion. This module evaluates the IDENTICAL condition sweep-side
// — same code, same cap, same resumable outcome — so a cap-past job
// fails loudly without waiting for a wake.
//
// Condition (all required, nothing else):
//   - job status queued/waiting (never running, never already failed);
//   - owning trip not terminal, not complete;
//   - trip generation currentStage === "generating_outline";
//   - zero-engine record has packVersionId null AND packWaitCount >= 1
//     (proof this run actually waited for a pack, not a first outline);
//   - now - zeroEngine.startedAt > maxPackWaitMs (default 2h, env
//     ROAMLY_ZERO_ENGINE_MAX_PACK_WAIT_MS, same default/floor as the
//     engine cap).
//
// Effect (resumable, loud): job -> failed with last_error_code
// ZERO_ENGINE_PACK_WAIT_TIMEOUT; trip generation state -> failed with
// the same code and a plain message; trip row status +
// itinerary_status -> "draft" (GATE-1 FIX 2026-10-25: the pre-fix row
// stayed `generating` for a terminal job — the engine's own failed
// path writes "draft", so the sweep path now matches it); an
// operational incident is recorded. The staged state stays retryable
// the same way the
// engine-cap failure is retryable: a later advance retries the
// outline — pack ready by then => success; pack still missing =>
// fails again at once, never silently. This module never touches a
// job whose status moved (guarded update: 0 rows => skip the trip
// write too), never resets retry_count, and never invents a pack
// state — the "pack still missing" leg is the recorded null
// packVersionId, not a fresh pack read.
//
// Dropping this change set = delete this file + revert the sweep
// route hunks that call runPackWaitTerminalTransition (see
// CHANGED-FILES-OPTIONAL.txt). Nothing else depends on it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  recordOperationalEvent,
  operationalOpaqueId
} from "@/lib/roamly/operationalIncidents";

export const PACK_WAIT_TIMEOUT_CODE = "ZERO_ENGINE_PACK_WAIT_TIMEOUT";
export const PACK_WAIT_TERMINAL_DEFAULT_MAX_MS = 7_200_000;

export function packWaitTerminalMaxMs(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(60_000, Number(env.ROAMLY_ZERO_ENGINE_MAX_PACK_WAIT_MS || PACK_WAIT_TERMINAL_DEFAULT_MAX_MS) || PACK_WAIT_TERMINAL_DEFAULT_MAX_MS);
}

type ZeroEngineRecord = {
  startedAt?: unknown;
  packVersionId?: unknown;
  packWaitCount?: unknown;
} | null;

export type PackWaitTerminalDecisionInput = {
  jobStatus?: string | null;
  tripStatus?: string | null;
  itineraryStatus?: string | null;
  itineraryGeneratedAt?: string | null;
  currentStage?: unknown;
  zeroEngine?: ZeroEngineRecord;
  nowMs: number;
  maxPackWaitMs?: number;
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function packWaitTerminalDecision(input: PackWaitTerminalDecisionInput): boolean {
  if (!["queued", "waiting"].includes(input.jobStatus || "")) return false;
  if (["archived", "cancelled", "completed"].includes(input.tripStatus || "")) return false;
  if (input.itineraryStatus === "generated" || input.itineraryGeneratedAt) return false;
  if (textOf(input.currentStage) !== "generating_outline") return false;
  const zero = input.zeroEngine;
  if (!zero) return false;
  if (zero.packVersionId !== null && zero.packVersionId !== undefined && textOf(zero.packVersionId)) return false;
  if (!(typeof zero.packWaitCount === "number" && zero.packWaitCount >= 1)) return false;
  const startedAt = typeof zero.startedAt === "string" ? Date.parse(zero.startedAt) : NaN;
  if (!Number.isFinite(startedAt)) return false;
  const maxMs = input.maxPackWaitMs ?? PACK_WAIT_TERMINAL_DEFAULT_MAX_MS;
  return input.nowMs - startedAt > maxMs;
}

type TransitionClient = SupabaseClient;
type Recorder = typeof recordOperationalEvent;

export async function runPackWaitTerminalTransition(params: {
  supabase?: TransitionClient | null;
  now?: Date | number;
  maxPackWaitMs?: number;
  recorder?: Recorder;
} = {}): Promise<{ ok: boolean; transitioned: number; skipped: number; error?: string }> {
  const client = createSupabaseAdminClient() || params.supabase || null;
  if (!client) return { ok: false, transitioned: 0, skipped: 0, error: "SUPABASE_SERVICE_ROLE_MISSING" };
  const recorder = params.recorder || recordOperationalEvent;
  const nowMs = params.now instanceof Date ? params.now.getTime() : typeof params.now === "number" ? params.now : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const maxPackWaitMs = params.maxPackWaitMs ?? packWaitTerminalMaxMs();

  const jobsResult = await client
    .from("roamly_trip_generation_jobs")
    .select("id,trip_id,user_id,status,retry_count,next_attempt_at,lease_expires_at,completed_at,updated_at")
    .is("completed_at", null)
    .in("status", ["queued", "waiting"])
    .limit(200);
  if (jobsResult.error) return { ok: false, transitioned: 0, skipped: 0, error: "PACK_WAIT_SCAN_FAILED" };
  const jobs = (jobsResult.data || []) as Array<{
    id: string;
    trip_id: string;
    user_id: string;
    status: string;
  }>;
  if (!jobs.length) return { ok: true, transitioned: 0, skipped: 0 };
  const tripsResult = await client
    .from("roamly_trips")
    .select("id,user_id,status,itinerary_status,itinerary_generated_at,metadata")
    .in("id", [...new Set(jobs.map((job) => job.trip_id))]);
  if (tripsResult.error) return { ok: false, transitioned: 0, skipped: 0, error: "PACK_WAIT_TRIP_SCAN_FAILED" };
  const trips = new Map((tripsResult.data || []).map((trip) => [`${trip.id}:${trip.user_id}`, trip as {
    id: string;
    user_id: string;
    status?: string | null;
    itinerary_status?: string | null;
    itinerary_generated_at?: string | null;
    metadata?: unknown;
  }]));

  let transitioned = 0;
  let skipped = 0;
  for (const job of jobs) {
    const trip = trips.get(`${job.trip_id}:${job.user_id}`);
    if (!trip) {
      skipped += 1;
      continue;
    }
    const metadata = recordOf(trip.metadata);
    const generation = recordOf(metadata?.generation);
    const zeroEngine = recordOf(metadata?.zeroEngine) as ZeroEngineRecord;
    const decision = packWaitTerminalDecision({
      jobStatus: job.status,
      tripStatus: trip.status,
      itineraryStatus: trip.itinerary_status,
      itineraryGeneratedAt: trip.itinerary_generated_at,
      currentStage: generation?.currentStage,
      zeroEngine,
      nowMs,
      maxPackWaitMs
    });
    if (!decision) {
      skipped += 1;
      continue;
    }
    const message = `The destination's map data did not finish building within ${Math.round(maxPackWaitMs / 60000)} minutes. The pack build may still be queued; retry the generation once the destination is warm.`;
    // Guarded job write first: if the job moved (claimed, failed, or
    // completed by a racing wake), 0 rows come back and the trip is
    // left untouched.
    const jobUpdate = await client
      .from("roamly_trip_generation_jobs")
      .update({
        status: "failed",
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        last_error_code: PACK_WAIT_TIMEOUT_CODE,
        last_error_message: message,
        updated_at: nowIso
      })
      .eq("id", job.id)
      .eq("user_id", job.user_id)
      .in("status", ["queued", "waiting"])
      .select("id")
      .maybeSingle();
    if (jobUpdate.error || !jobUpdate.data) {
      skipped += 1;
      continue;
    }
    const nextMetadata = {
      ...(metadata || {}),
      generation: {
        ...(generation || {}),
        status: "failed",
        currentStage: "failed",
        lastError: message,
        lastErrorCode: PACK_WAIT_TIMEOUT_CODE,
        updatedAt: nowIso
      }
    };
    const tripUpdate = await client
      .from("roamly_trips")
      // GATE-1 FIX (2026-10-25): the row must stop saying
      // `generating` for a terminal job, or the traveler-facing
      // surfaces keyed on the row (dashboard card, status route)
      // show a forever-generating trip for a job that already
      // failed. `draft` is the row value the engine's own failed
      // path writes (generate.ts
      // persistedTripStatusForGeneration("failed") -> "draft"), so
      // the sweep path and the engine path now leave identical row
      // states. The trip page itself renders the failure + Retry
      // from metadata.generation (status "failed") via
      // publicStagedGenerationProgress — that rendering was already
      // correct; this row fix closes the list/status surfaces.
      .update({ metadata: nextMetadata, status: "draft", itinerary_status: "draft" })
      .eq("id", trip.id)
      .eq("user_id", trip.user_id);
    if (tripUpdate.error) {
      skipped += 1;
      continue;
    }
    await recorder({
      supabase: client,
      severity: "medium",
      subsystem: "trip_generation",
      eventCode: "generation_pack_wait_timeout",
      fingerprintParts: ["pack-wait-timeout", operationalOpaqueId(["generation-job", job.id])],
      eventKey: `generation-pack-wait-timeout:${operationalOpaqueId(["generation-job", job.id, nowIso])}`,
      safeMetadata: {
        operation: "pack_wait_terminal_transition",
        stage: "generating_outline",
        source: "pack_wait_terminal_transition",
        retryable: true
      }
    }).catch(() => null);
    transitioned += 1;
  }
  return { ok: true, transitioned, skipped };
}
