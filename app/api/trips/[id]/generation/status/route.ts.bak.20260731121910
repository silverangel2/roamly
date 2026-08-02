import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { publicStagedGenerationProgress } from "@/lib/roamly/stagedItineraryGeneration";
import {
  getGenerationQueueForTrip,
  publicQueueProgress,
  queueTableMissing
} from "@/lib/roamly/generationQueue";
import {
  deriveTripGenerationStatus,
  type StagedGenerationStatusJobRow,
  type StagedGenerationStatusLayerRow
} from "@/lib/roamly/generationStatus";

function isFinalStoredItinerary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.daily_itinerary) &&
    record.daily_itinerary.length > 0 &&
    typeof record.generation_note === "string" &&
    /generated through roamly staged ai generation/i.test(record.generation_note)
  );
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

  const [jobsResult, layersResult, queue, itineraryResult] = await Promise.all([
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
    return NextResponse.json({ ok: false, error: queue.error }, { status: 500 });
  }

  const latestJob = (jobsResult.data?.[0] || null) as StagedGenerationStatusJobRow | null;
  const layers = (layersResult.data || []) as StagedGenerationStatusLayerRow[];
  const hasFullItinerary = Boolean(
    itineraryResult.data?.some((item) => isFinalStoredItinerary((item as { full_json?: unknown }).full_json))
  );

  const queueProgress = publicQueueProgress(queue, data.metadata);
  const queueRecord = queueProgress as Record<string, unknown> | null;
  const derived = deriveTripGenerationStatus({
    tripStatus: data.status,
    itineraryStatus: data.itinerary_status,
    metadataProgress,
    latestJob,
    layers,
    queueProgress: queueRecord,
    hasFullItinerary
  });

  return NextResponse.json({
    ok: true,
    tripId: id,
    status: derived.status,
    itineraryStatus: derived.itineraryStatus,
    itineraryLocked: data.itinerary_locked === true,
    progress: {
      ...metadataProgress,
      status: derived.progressStatus,
      completedDayCount: derived.completedLayerCount,
      totalDayCount: derived.totalLayerCount,
      percent: derived.percent
    },
    queue: queueProgress,
    queueProgress: {
      ...(queueRecord || {}),
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
      hasFullItinerary
    }
  });
}
