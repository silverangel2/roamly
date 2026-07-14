import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { publicStagedGenerationProgress } from "@/lib/roamly/stagedItineraryGeneration";
import {
  getGenerationQueueForTrip,
  publicQueueProgress,
  queueTableMissing
} from "@/lib/roamly/generationQueue";

type StagedJobRow = {
  status?: string | null;
  error_message?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
};

type StagedLayerRow = {
  status?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
};

function normalizedStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isCompletedStatus(value: unknown) {
  return ["complete", "completed", "succeeded", "success", "skipped"].includes(
    normalizedStatus(value)
  );
}

function isFailedStatus(value: unknown) {
  return ["failed", "error", "timeout"].includes(normalizedStatus(value));
}

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

  const metadataProgress =
    publicStagedGenerationProgress(data.metadata) || {
      status: "queued",
      completedDayCount: 0,
      totalDayCount: 1,
      percent: 0
    };

  const [jobsResult, layersResult, queue] = await Promise.all([
    auth.supabase
      .from("roamly_trip_generation_jobs")
      .select("status,error_message,completed_at,updated_at")
      .eq("trip_id", id)
      .order("updated_at", { ascending: false })
      .limit(1),
    auth.supabase
      .from("roamly_trip_generation_layers")
      .select("status,completed_at,updated_at")
      .eq("trip_id", id)
      .order("created_at", { ascending: true }),
    getGenerationQueueForTrip({
      supabase: auth.supabase,
      tripId: id,
      userId: auth.user.id
    })
  ]);

  if (queue.error && !queueTableMissing(queue.error)) {
    return NextResponse.json({ ok: false, error: queue.error }, { status: 500 });
  }

  const latestJob = (jobsResult.data?.[0] || null) as StagedJobRow | null;
  const layers = (layersResult.data || []) as StagedLayerRow[];

  const queueProgress = publicQueueProgress(queue, data.metadata);
  const queueRecord = queueProgress as Record<string, unknown> | null;

  const totalLayerCount =
    layers.length ||
    (typeof queueRecord?.totalLayerCount === "number" && queueRecord.totalLayerCount > 0
      ? queueRecord.totalLayerCount
      : Math.max(metadataProgress.totalDayCount, 1));

  const completedLayerCount = layers.length
    ? layers.filter((layer) => isCompletedStatus(layer.status)).length
    : typeof queueRecord?.completedLayerCount === "number"
      ? queueRecord.completedLayerCount
      : metadataProgress.completedDayCount;

  const jobStatus = normalizedStatus(latestJob?.status);
  const jobMarkedComplete =
    isCompletedStatus(jobStatus) ||
    latestJob?.error_message === "STAGED_GENERATION_COMPLETED";

  const jobMarkedFailed =
    isFailedStatus(jobStatus) ||
    layers.some((layer) => isFailedStatus(layer.status));

  const isComplete =
    jobMarkedComplete ||
    (totalLayerCount > 0 && completedLayerCount >= totalLayerCount);

  const progressStatus = isComplete
    ? "complete"
    : jobMarkedFailed
      ? "failed"
      : metadataProgress.status === "complete"
        ? "generating_day"
        : metadataProgress.status;

  const percent = isComplete
    ? 100
    : Math.max(
        0,
        Math.min(99, Math.round((completedLayerCount / Math.max(totalLayerCount, 1)) * 100))
      );

  return NextResponse.json({
    ok: true,
    tripId: id,
    status: isComplete ? "completed" : data.status,
    itineraryStatus: isComplete ? "completed" : data.itinerary_status,
    itineraryLocked: data.itinerary_locked === true,
    progress: {
      ...metadataProgress,
      status: progressStatus,
      completedDayCount: completedLayerCount,
      totalDayCount: totalLayerCount,
      percent
    },
    queue: queueProgress,
    queueProgress: {
      ...(queueRecord || {}),
      status: isComplete ? "completed" : jobMarkedFailed ? "failed" : queueRecord?.status,
      completedLayerCount,
      totalLayerCount
    },
    stagedGeneration: {
      jobStatus: latestJob?.status || null,
      jobCompletedAt: latestJob?.completed_at || null,
      jobErrorMessage: latestJob?.error_message || null,
      layerCount: layers.length,
      completedLayerCount
    }
  });
}
