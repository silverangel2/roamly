import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { publicStagedGenerationProgress } from "@/lib/roamly/stagedItineraryGeneration";
import {
  finalizeCompletedStagedGeneration,
  hasFinalStoredItineraryInMetadata,
  isFinalStoredItinerary
} from "@/lib/roamly/generationFinalization";
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

  let metadataProgress =
    publicStagedGenerationProgress(data.metadata, id) || {
      tripId: id,
      status: "queued",
      completedDayCount: 0,
      totalDayCount: 1,
      percent: 0,
      completedAt: null
    };

  const [jobsResult, layersResult, queue, itineraryResult] = await Promise.all([
    auth.supabase
      .from("roamly_trip_generation_jobs")
      .select("status,error_message,completed_at,updated_at")
      .eq("trip_id", id)
      .eq("user_id", auth.user.id)
      .order("updated_at", { ascending: false })
      .limit(1),
    auth.supabase
      .from("roamly_trip_generation_layers")
      .select("status,completed_at,updated_at")
      .eq("trip_id", id)
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: true }),
    getGenerationQueueForTrip({
      supabase: auth.supabase,
      tripId: id,
      userId: auth.user.id
    }),
    auth.supabase
      .from("roamly_itineraries")
      .select("id,full_json")
      .eq("trip_id", id)
      .eq("user_id", auth.user.id)
      .not("full_json", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
  ]);

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
      itineraryResult.data?.some((item) => isFinalStoredItinerary((item as { full_json?: unknown }).full_json))
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
      jobErrorMessage: latestJob?.error_message || null,
      layerCount: layers.length,
      completedLayerCount: derived.completedLayerCount,
      hasFullItinerary,
      recovery
    }
  });
}
