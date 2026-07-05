import { NextRequest, NextResponse } from "next/server";
import { isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkTripOwnership } from "@/lib/trip-ownership";

const statuses = new Set(["planned", "active", "completed", "skipped"]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const ownership = await checkTripOwnership(supabase, data.user.id, id);
  if (!ownership.allowed || !ownership.trip || !isTripLocked(ownership.trip) || !tripHasTrackingUnlock(ownership.trip)) {
    return NextResponse.json({ ok: false, error: "Live Trip Companion requires a locked itinerary and the companion add-on." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const activityId = typeof body.activityId === "string" ? body.activityId : "";
  const status = typeof body.status === "string" && statuses.has(body.status) ? body.status : "";

  if (!activityId || !status) {
    return NextResponse.json({ ok: false, error: "Activity and status are required." }, { status: 400 });
  }

  const update = await supabase
    .from("roamly_trip_activities")
    .update({ status })
    .eq("id", activityId)
    .eq("trip_id", id);

  if (update.error) return NextResponse.json({ ok: false, error: update.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
