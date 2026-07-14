import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { publicStagedGenerationProgress } from "@/lib/roamly/stagedItineraryGeneration";
import { getGenerationQueueForTrip, publicQueueProgress, queueTableMissing } from "@/lib/roamly/generationQueue";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("roamly_trips")
    .select("id,metadata,itinerary_status,status,itinerary_locked")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });

  const queue = await getGenerationQueueForTrip({
    supabase: auth.supabase,
    tripId: id,
    userId: auth.user.id
  });
  if (queue.error && !queueTableMissing(queue.error)) {
    return NextResponse.json({ ok: false, error: queue.error }, { status: 500 });
  }
  const queueProgress = publicQueueProgress(queue, data.metadata);
  const metadataProgress =
    publicStagedGenerationProgress(data.metadata) || {
      status: "queued",
      completedDayCount: 0,
      totalDayCount: 1,
      percent: 0
    };
  const queueRecord = queueProgress as Record<string, unknown> | null;

  const completedLayerCount =
    typeof queueRecord?.completedLayerCount === "number"
      ? queueRecord.completedLayerCount
      : metadataProgress.completedDayCount;

  const totalLayerCount =
    typeof queueRecord?.totalLayerCount === "number" && queueRecord.totalLayerCount > 0
      ? queueRecord.totalLayerCount
      : Math.max(metadataProgress.totalDayCount, 1);

  const queueStatus =
    typeof queueRecord?.status === "string" ? queueRecord.status : "";

  const isComplete =
    queueStatus === "complete" ||
    queueStatus === "completed" ||
    completedLayerCount >= totalLayerCount;

  const isFailed =
    queueStatus === "failed" || metadataProgress.status === "failed";

  const progress = {
    ...metadataProgress,
    status: isComplete ? "complete" : isFailed ? "failed" : metadataProgress.status,
    completedDayCount: completedLayerCount,
    totalDayCount: totalLayerCount,
    percent: isComplete
      ? 100
      : Math.max(
          0,
          Math.min(99, Math.round((completedLayerCount / totalLayerCount) * 100))
        )
  };

  return NextResponse.json({
    ok: true,
    tripId: id,
    status: data.status,
    itineraryStatus: data.itinerary_status,
    itineraryLocked: data.itinerary_locked === true,
    progress,
    queue: queueProgress
  });
}
