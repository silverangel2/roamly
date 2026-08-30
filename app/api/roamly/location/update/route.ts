import { NextRequest, NextResponse } from "next/server";
import { normalizeCoordinates } from "@/lib/roamly/location";
import { recordTripEvent } from "@/lib/roamly/events";
import { activateTripIfNearby } from "@/lib/roamly/tripActivation";
import { requireUser } from "@/lib/roamly/auth";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { processLiveCompanionDemoUpdate } from "@/lib/roamly/liveCompanionDemo";

const permissionStates = new Set(["granted", "denied", "prompt"]);
const MAX_LOCATION_AGE_MS = 10 * 60_000;
const MAX_LOCATION_FUTURE_SKEW_MS = 2 * 60_000;

function parseCapturedAt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const permissionState =
    typeof body.permissionState === "string" && permissionStates.has(body.permissionState)
      ? body.permissionState
      : "prompt";
  const tripId = typeof body.tripId === "string" && body.tripId.trim() ? body.tripId.trim() : undefined;
  const liveDemoPayload =
    body.liveDemo && typeof body.liveDemo === "object" && !Array.isArray(body.liveDemo)
      ? body.liveDemo
      : null;
  const location = normalizeCoordinates({
    latitude: body.latitude as number,
    longitude: body.longitude as number,
    accuracy: body.accuracy as number | null
  });
  const capturedAt = parseCapturedAt(body.capturedAt);

  const existing = await auth.supabase
    .from("roamly_location_settings")
    .select("location_tracking_enabled,notification_enabled")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (permissionState !== "granted") {
    await auth.supabase.from("roamly_location_settings").upsert(
      {
        user_id: auth.user.id,
        location_tracking_enabled: false,
        last_permission_state: permissionState
      },
      { onConflict: "user_id" }
    );
    await recordTripEvent(auth.supabase, {
      userId: auth.user.id,
      eventType: permissionState === "denied" ? "location_permission_denied" : "location_permission_prompt",
      eventTitle: "Location permission updated",
      eventBody: `Permission state: ${permissionState}`
    });
    return NextResponse.json({ ok: true, trackingDisabled: true, tripActivated: false });
  }

  if (!location) {
    return NextResponse.json({ ok: false, error: "Valid latitude and longitude are required." }, { status: 400 });
  }

  if (capturedAt) {
    const age = Date.now() - capturedAt.getTime();
    if (age > MAX_LOCATION_AGE_MS || age < -MAX_LOCATION_FUTURE_SKEW_MS) {
      return NextResponse.json({
        ok: true,
        staleLocation: true,
        tripActivated: false,
        message: "Location update was too old to process."
      });
    }
  }

  if (!existing.data?.location_tracking_enabled) {
    return NextResponse.json({
      ok: true,
      trackingDisabled: true,
      tripActivated: false,
      message: "Location permission is disabled in this Roamly account."
    });
  }

  await auth.supabase.from("roamly_location_settings").upsert(
    {
      user_id: auth.user.id,
      location_tracking_enabled: true,
      notification_enabled: existing.data.notification_enabled ?? true,
      last_permission_state: "granted",
      last_seen_latitude: location.latitude,
      last_seen_longitude: location.longitude,
      last_seen_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );

  /*
   * watchPosition() calls this endpoint repeatedly.
   * Coordinates still update continuously, but do not add a
   * duplicate permission event for every GPS reading.
   */


  if (liveDemoPayload) {
    const access = getRoamlyAccessForUser(auth.user.email);
    if (!access.hasQaAccess) {
      return NextResponse.json({ ok: false, error: "Live Demo is only available to tester/admin accounts." }, { status: 403 });
    }
    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip is required for Live Demo." }, { status: 400 });
    }

    const demo = await processLiveCompanionDemoUpdate({
      supabase: auth.supabase,
      userId: auth.user.id,
      tripId,
      location,
      payload: liveDemoPayload
    });

    return NextResponse.json({
      ok: demo.ok,
      liveDemo: true,
      demo: demo.ok ? demo.demo : null,
      error: demo.ok ? null : demo.error
    }, { status: demo.ok ? 200 : 400 });
  }

  const activation = await activateTripIfNearby(auth.supabase, auth.user.id, location, tripId);

  return NextResponse.json({
    ok: true,
    tripActivated: activation.tripActivated,
    notification: activation.notification,
    activeTrip: activation.trip,
    currentDay: activation.currentDay,
    nearbyActivities: activation.nearbyActivities,
    checkedActivities: activation.checkedActivities,
    upNextActivity: activation.upNextActivity,
    error: activation.error
  });
}
