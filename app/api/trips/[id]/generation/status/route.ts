import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { publicStagedGenerationProgress } from "@/lib/roamly/stagedItineraryGeneration";
import {
  finalizeCompletedStagedGeneration,
  hasFinalStoredItineraryInMetadata
} from "@/lib/roamly/generationFinalization";
import { ZERO_ENGINE_GENERATION_NOTE, ZERO_ENGINE_SOURCE } from "@/lib/roamly/engine/generate";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readGenerationStateRow } from "@/lib/roamly/generationStateStore";

/**
 * EGRESS DIET (2026-11-02, F1) — the final markers the itinerary
 * writers stamp when they store a FINAL document: the staged writer
 * writes this exact generation_note only for a completed assembly
 * (the in-progress note differs), and the zero-engine note counts
 * only paired with the row's stored `source` column. The predicates
 * below ask Postgres to evaluate them inside the database and return
 * only id/source/updated_at, so the poller never downloads the
 * 35–78 KB document again. Keep in step with isFinalStoredItinerary
 * (lib/roamly/generationFinalization.ts).
 */
const STAGED_FINAL_GENERATION_NOTE = "Generated through Roamly staged AI generation.";
import {
  getGenerationQueueForTrip,
  publicQueueProgress,
  queueTableMissing
} from "@/lib/roamly/generationQueue";
import { getGenerationEmailStatus } from "@/lib/roamly/itineraryGenerationEmail";
import {
  deriveTripGenerationStatus,
  type StagedGenerationStatusJobRow,
  type StagedGenerationStatusLayerRow
} from "@/lib/roamly/generationStatus";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireUser();

  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("roamly_trips")
    .select("id,metadata,itinerary_status,status,itinerary_locked")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  }

  // GAP-CLOSURE 5a — STATE-FIRST READ with metadata fallback. The
  // states table is service-role only (no authenticated policies),
  // so the row is read through the admin client and accepted only
  // when it belongs to this trip AND this traveler. DISAGREEMENT
  // RULE: when a row exists it wins — data.metadata's `generation`
  // key is replaced with the table state, so every derivation below
  // (progress, final-itinerary check, email status, queue progress)
  // sees the authoritative state through the existing metadata
  // shapes. No row (mixed fleet / pre-migration) leaves
  // data.metadata untouched and the poll behaves exactly as before.
  const admin = createSupabaseAdminClient();
  const generationStateRow = admin ? await readGenerationStateRow(admin, id) : null;
  if (generationStateRow && generationStateRow.user_id === auth.user.id && generationStateRow.state) {
    data.metadata = {
      ...((data.metadata || {}) as Record<string, unknown>),
      generation: generationStateRow.state
    };
  }

  let metadataProgress =
    publicStagedGenerationProgress(data.metadata, id) || {
      tripId: id,
      status: "queued",
      completedDayCount: 0,
      totalDayCount: 1,
      percent: 0,
      completedAt: null
    };

  // EGRESS DIET (F1, second cut): the queue helper
  // (getGenerationQueueForTrip) re-read the latest job and its layers
  // with select("*") — including input_json/output_json/evidence_json
  // payloads — on every poll, duplicating this route's own job/layer
  // reads. The route now widens its OWN two selects to exactly the
  // fields deriveTripGenerationStatus + publicQueueProgress consume
  // and assembles the queue object in place. The helper itself is a
  // protected file and stays untouched for its other callers. Job
  // ordering switches to created_at desc to match the helper's
  // "latest job" semantics exactly.
  const [jobsResult, layersResult, stagedFinalResult, zeroFinalResult] = await Promise.all([
    auth.supabase
      .from("roamly_trip_generation_jobs")
      // 42703 FIX (consolidation 2026-11-06, Block H): this select
      // also named `error_message` — a LAYERS column the jobs table
      // does not have — so PostgREST rejected the whole jobs read
      // on every status poll and latestJob silently arrived null.
      // The jobs table's column is last_error_message (already in
      // this list); it is the only error column selected now.
      .select("id,trip_id,user_id,status,priority,current_stage,generation_version,model_version,retry_count,next_attempt_at,lease_expires_at,last_error_code,last_error_message,created_at,started_at,completed_at,updated_at")
      .eq("trip_id", id)
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(1),
    auth.supabase
      .from("roamly_trip_generation_layers")
      .select("id,trip_id,job_id,layer_type,layer_sequence,status,retry_count,error_code,created_at,updated_at,completed_at")
      .eq("trip_id", id)
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: true }),
    // EGRESS DIET (F1): two light existence probes instead of the old
    // `select("id,full_json")` per poll. Each returns at most one row
    // of id/source/updated_at (~150 bytes) — the document itself is
    // never transferred. The stored-final recovery below still runs
    // (and still loads the document once, inside finalization) when
    // either probe finds a final row.
    auth.supabase
      .from("roamly_itineraries")
      .select("id,source,updated_at")
      .eq("trip_id", id)
      .eq("user_id", auth.user.id)
      .eq("full_json->>generation_note", STAGED_FINAL_GENERATION_NOTE)
      .order("created_at", { ascending: false })
      .limit(1),
    auth.supabase
      .from("roamly_itineraries")
      .select("id,source,updated_at")
      .eq("trip_id", id)
      .eq("user_id", auth.user.id)
      .eq("source", ZERO_ENGINE_SOURCE)
      .eq("full_json->>generation_note", ZERO_ENGINE_GENERATION_NOTE)
      .order("created_at", { ascending: false })
      .limit(1)
  ]);

  const queueJobRow =
    jobsResult.error && queueTableMissing(jobsResult.error.message)
      ? null
      : ((jobsResult.data?.[0] || null) as Record<string, unknown> | null);
  const queueLayerRows =
    layersResult.error && queueTableMissing(layersResult.error.message)
      ? []
      : ((layersResult.data || []) as Array<Record<string, unknown>>).filter(
          (layer) => queueJobRow && layer.job_id === queueJobRow.id
        );
  const queue = {
    job: queueJobRow,
    layers: queueLayerRows,
    error: jobsResult.error ? jobsResult.error.message : layersResult.error ? layersResult.error.message : null
  } as unknown as Awaited<ReturnType<typeof getGenerationQueueForTrip>>;

  if (queue.error && !queueTableMissing(queue.error)) {
    console.error(
      "[Roamly] Queue unavailable during status lookup:",
      queue.error
    );
  }
  if (jobsResult.error && !queueTableMissing(jobsResult.error.message)) {
    console.error("[Roamly] Generation jobs unavailable during status lookup:", jobsResult.error.message);
  }
  if (layersResult.error && !queueTableMissing(layersResult.error.message)) {
    console.error("[Roamly] Generation layers unavailable during status lookup:", layersResult.error.message);
  }

  const latestJob =
    jobsResult.error && queueTableMissing(jobsResult.error.message)
      ? null
      : (jobsResult.data?.[0] || null) as StagedGenerationStatusJobRow | null;
  const layers =
    layersResult.error && queueTableMissing(layersResult.error.message)
      ? []
      : (layersResult.data || []) as StagedGenerationStatusLayerRow[];
  const hasFullItinerary = Boolean(
    hasFinalStoredItineraryInMetadata(data.metadata) ||
      (stagedFinalResult.data && stagedFinalResult.data.length > 0) ||
      (zeroFinalResult.data && zeroFinalResult.data.length > 0)
  );
  const emailStatus = getGenerationEmailStatus(data.metadata, id);
  const completionEmailMissing = Boolean(
    emailStatus.email_me_when_ready !== false &&
      !emailStatus.completion_email_sent_at &&
      emailStatus.completion_email_status !== "sent" &&
      emailStatus.completion_email_status !== "captured" &&
      emailStatus.delivery_status !== "sent" &&
      emailStatus.delivery_status !== "captured"
  );
  const tripStatusStillBuilding = ["draft", "preview", "generating", "queued"].includes(
    String(data.status || "").toLowerCase()
  );
  const itineraryStatusComplete = ["generated", "locked"].includes(
    String(data.itinerary_status || "").toLowerCase()
  );
  const needsStoredItineraryRecovery = Boolean(
    hasFullItinerary &&
      (metadataProgress.status !== "complete" ||
        tripStatusStillBuilding ||
        !itineraryStatusComplete ||
        completionEmailMissing)
  );
  const recovery = needsStoredItineraryRecovery
    ? await finalizeCompletedStagedGeneration({
        supabase: auth.supabase,
        tripId: id,
        userId: auth.user.id,
        source: "status_route_stored_itinerary_recovery"
      }).catch((error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : "STORED_ITINERARY_RECOVERY_FAILED"
      }))
    : null;
  if (recovery?.ok && recovery.progress) metadataProgress = recovery.progress;

  const queueProgress =
    queue.error && !queueTableMissing(queue.error)
      ? null
      : publicQueueProgress(queue, data.metadata, id);
  const queueRecord = queueProgress as Record<string, unknown> | null;
  const derived = deriveTripGenerationStatus({
    tripStatus: recovery?.ok ? "generated" : data.status,
    itineraryStatus: recovery?.ok ? "generated" : data.itinerary_status,
    metadataProgress,
    latestJob,
    layers,
    queueProgress: queueRecord,
    hasFullItinerary
  });
  const queueForResponse =
    queueProgress && derived.isComplete
      ? {
          ...queueProgress,
          job: {
            ...queueProgress.job,
            status: "completed",
            completed_at: queueProgress.job.completed_at || metadataProgress.completedAt || null
          },
          completedLayerCount: derived.completedLayerCount,
          totalLayerCount: derived.totalLayerCount
        }
      : queueProgress;
  const queueForResponseRecord = queueForResponse as Record<string, unknown> | null;

  return NextResponse.json({
    ok: true,
    tripId: id,
    status: derived.status,
    itineraryStatus: derived.itineraryStatus,
    itineraryLocked: data.itinerary_locked === true || recovery?.ok === true,
    completedDayCount: derived.completedDayCount,
    totalDayCount: derived.totalDayCount,
    progress: {
      ...metadataProgress,
      status: derived.progressStatus,
      tripId: id,
      completedDayCount: derived.completedDayCount,
      totalDayCount: derived.totalDayCount,
      percent: derived.percent
    },
    queue: queueForResponse,
    queueProgress: {
      ...(queueForResponseRecord || {}),
      status: derived.isComplete ? "completed" : derived.isFailed ? "failed" : queueRecord?.status,
      completedLayerCount: derived.completedLayerCount,
      totalLayerCount: derived.totalLayerCount
    },
    stagedGeneration: {
      jobStatus: latestJob?.status || null,
      jobCompletedAt: latestJob?.completed_at || null,
      jobErrorMessage: latestJob?.last_error_message || null,
      layerCount: layers.length,
      completedLayerCount: derived.completedLayerCount,
      hasFullItinerary,
      recovery
    }
  });
}
