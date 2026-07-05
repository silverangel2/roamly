import { NextRequest, NextResponse } from "next/server";
import { recordTripEvent } from "@/lib/roamly/events";
import { isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkTripOwnership } from "@/lib/trip-ownership";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const activityId = typeof body.activityId === "string" ? body.activityId : "";
  const tripId = typeof body.tripId === "string" ? body.tripId : "";

  if (!activityId || !tripId) {
    return NextResponse.json({ ok: false, error: "Activity and trip are required." }, { status: 400 });
  }

  const ownership = await checkTripOwnership(supabase, data.user.id, tripId);
  if (!ownership.allowed) return NextResponse.json({ ok: false, error: "Trip access denied." }, { status: 403 });
  if (!ownership.trip || !isTripLocked(ownership.trip) || !tripHasTrackingUnlock(ownership.trip)) {
    return NextResponse.json({ ok: false, error: "Live Trip Companion requires a locked itinerary and the companion add-on." }, { status: 403 });
  }

  const { data: activity, error } = await supabase
    .from("roamly_activities")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", activityId)
    .eq("trip_id", tripId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await recordTripEvent(supabase, {
    userId: data.user.id,
    tripId,
    activityId,
    eventType: "activity_completed",
    eventTitle: `Completed: ${activity.title}`,
    eventBody: "Activity marked completed."
  });

  return NextResponse.json({ ok: true, activity });
}
