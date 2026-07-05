import { NextRequest, NextResponse } from "next/server";
import { normalizeCoordinates } from "@/lib/roamly/location";
import { recordTripEvent } from "@/lib/roamly/events";
import { activateTripIfNearby } from "@/lib/roamly/tripActivation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const permissionStates = new Set(["granted", "denied", "prompt"]);

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const permissionState =
    typeof body.permissionState === "string" && permissionStates.has(body.permissionState)
      ? body.permissionState
      : "prompt";
  const location = normalizeCoordinates({
    latitude: body.latitude as number,
    longitude: body.longitude as number,
    accuracy: body.accuracy as number | null
  });

  const existing = await supabase
    .from("roamly_location_settings")
    .select("location_tracking_enabled,notification_enabled")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (permissionState !== "granted") {
    await supabase.from("roamly_location_settings").upsert(
      {
        user_id: data.user.id,
        location_tracking_enabled: false,
        last_permission_state: permissionState
      },
      { onConflict: "user_id" }
    );
    await recordTripEvent(supabase, {
      userId: data.user.id,
      eventType: permissionState === "denied" ? "location_permission_denied" : "location_permission_prompt",
      eventTitle: "Location permission updated",
      eventBody: `Permission state: ${permissionState}`
    });
    return NextResponse.json({ ok: true, trackingDisabled: true, tripActivated: false });
  }

  if (!location) {
    return NextResponse.json({ ok: false, error: "Valid latitude and longitude are required." }, { status: 400 });
  }

  if (!existing.data?.location_tracking_enabled) {
    return NextResponse.json({
      ok: true,
      trackingDisabled: true,
      tripActivated: false,
      message: "Location permission is disabled in this Roamly account."
    });
  }

  await supabase.from("roamly_location_settings").upsert(
    {
      user_id: data.user.id,
      location_tracking_enabled: true,
      notification_enabled: existing.data.notification_enabled ?? true,
      last_permission_state: "granted",
      last_seen_latitude: location.latitude,
      last_seen_longitude: location.longitude,
      last_seen_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );

  await recordTripEvent(supabase, {
    userId: data.user.id,
    eventType: "location_permission_granted",
    eventTitle: "Location permission granted",
    eventBody: "Roamly location permission is enabled for Live Trip Companion.",
    latitude: location.latitude,
    longitude: location.longitude,
    metadata: { accuracy: location.accuracy }
  });

  const activation = await activateTripIfNearby(supabase, data.user.id, location);

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
