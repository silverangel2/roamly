import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { normalizeCoordinates } from "@/lib/roamly/location";
import { activateTripIfNearby } from "@/lib/roamly/tripActivation";

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as {
    tripId?: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number | null;
  };

  if (!body.tripId) {
    return NextResponse.json(
      { ok: false, error: "Field-test trip is required." },
      { status: 400 }
    );
  }

  const location = normalizeCoordinates({
    latitude: body.latitude as number,
    longitude: body.longitude as number,
    accuracy: body.accuracy ?? null
  });

  if (!location) {
    return NextResponse.json(
      { ok: false, error: "Valid real GPS coordinates are required." },
      { status: 400 }
    );
  }

  const { data: trip, error: tripError } = await guard.admin
    .from("roamly_trips")
    .select("id,user_id,metadata")
    .eq("id", body.tripId)
    .single();

  if (tripError || !trip) {
    return NextResponse.json(
      { ok: false, error: "Field-test trip was not found." },
      { status: 404 }
    );
  }

  const metadata =
    trip.metadata && typeof trip.metadata === "object"
      ? (trip.metadata as Record<string, unknown>)
      : {};

  if (
    metadata.admin_test !== true ||
    metadata.field_test !== true ||
    metadata.real_location_required !== true
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Real GPS field testing is restricted to controlled field-test trips."
      },
      { status: 403 }
    );
  }

  await guard.admin
    .from("roamly_location_settings")
    .upsert(
      {
        user_id: trip.user_id,
        location_tracking_enabled: true,
        notification_enabled: true,
        last_permission_state: "granted",
        last_seen_latitude: location.latitude,
        last_seen_longitude: location.longitude,
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    );

  const activation = await activateTripIfNearby(
    guard.admin,
    trip.user_id,
    location,
    trip.id
  );

  return NextResponse.json({
    ok: !activation.error,
    realLocation: true,
    simulated: false,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    tripActivated: activation.tripActivated,
    notification: activation.notification,
    nearbyActivities: activation.nearbyActivities,
    checkedActivities: activation.checkedActivities,
    upNextActivity: activation.upNextActivity,
    error: activation.error
  });
}
