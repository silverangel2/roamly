import { NextRequest, NextResponse } from "next/server";
import { normalizeCoordinates } from "@/lib/roamly/location";
import { checkInNearbyActivities } from "@/lib/roamly/tripActivation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const activityId = typeof body.activityId === "string" ? body.activityId : "";
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  const location = normalizeCoordinates({
    latitude: body.latitude as number,
    longitude: body.longitude as number
  });

  if (!activityId || !tripId || !location) {
    return NextResponse.json({ ok: false, error: "Activity, trip, and location are required." }, { status: 400 });
  }

  const result = await checkInNearbyActivities(supabase, data.user.id, tripId, activityId, location);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, activity: result.activity });
}
