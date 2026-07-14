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

  return NextResponse.json({
    ok: true,
    tripId: id,
    status: data.status,
    itineraryStatus: data.itinerary_status,
    itineraryLocked: data.itinerary_locked === true,
    progress: publicStagedGenerationProgress(data.metadata),
    queue: queueProgress
  });
}
