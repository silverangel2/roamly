import { NextRequest, NextResponse } from "next/server";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { recordTripEvent } from "@/lib/roamly/events";
import { normalizeCoordinates } from "@/lib/roamly/location";
import { requireUser } from "@/lib/roamly/auth";
import { activateTripIfNearby } from "@/lib/roamly/tripActivation";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const access = getRoamlyAccessForUser(auth.user.email);
  if (!access.hasQaAccess) {
    return NextResponse.json({ ok: false, error: "Location simulation is only available to tester/admin accounts." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = getString(body.tripId);
  const location = normalizeCoordinates({
    latitude: body.latitude as number,
    longitude: body.longitude as number,
    accuracy: body.accuracy as number | null
  });

  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });
  if (!location) return NextResponse.json({ ok: false, error: "Valid latitude and longitude are required." }, { status: 400 });

  const activation = await activateTripIfNearby(auth.supabase, auth.user.id, location, tripId, {
    simulated: true,
    source: "tester_location_simulator"
  });

  if (!activation.trip) {
    return NextResponse.json({ ok: false, error: activation.error || "Trip not found." }, { status: 404 });
  }

  await recordTripEvent(auth.supabase, {
    userId: auth.user.id,
    tripId,
    eventType: "simulated_location_used",
    eventTitle: "Simulated location used",
    eventBody: getString(body.label) || "Tester/admin simulated location.",
    latitude: location.latitude,
    longitude: location.longitude,
    metadata: {
      simulated: true,
      source: "tester_location_simulator",
      label: getString(body.label) || null,
      target: getString(body.target) || null,
      accuracy: location.accuracy
    }
  });

  return NextResponse.json({
    ok: true,
    simulated: true,
    latitude: location.latitude,
    longitude: location.longitude,
    tripActivated: activation.tripActivated,
    notification: activation.notification,
    activeTrip: activation.trip,
    currentDay: activation.currentDay,
    nearbyActivities: activation.nearbyActivities,
    checkedActivities: activation.checkedActivities,
    upNextActivity: activation.upNextActivity,
    notificationCreated: Boolean(activation.notificationCreated || activation.notification),
    error: activation.error
  });
}
