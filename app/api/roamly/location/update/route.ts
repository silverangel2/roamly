import { NextRequest, NextResponse } from "next/server";
import { isFreshLocationObservation, normalizeCoordinates } from "@/lib/roamly/location";
import { recordTripEvent } from "@/lib/roamly/events";
import { activateTripIfNearby } from "@/lib/roamly/tripActivation";
import { requireUserOrFieldTest } from "@/lib/roamly/fieldTestAccess";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { processLiveCompanionDemoUpdate } from "@/lib/roamly/liveCompanionDemo";
import { writeForegroundLocation } from "@/lib/roamly/locationLifecycle";

const permissionStates = new Set(["granted", "denied", "prompt"]);
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const permissionState =
    typeof body.permissionState === "string" && permissionStates.has(body.permissionState)
      ? body.permissionState
      : "prompt";
  const tripId = typeof body.tripId === "string" && body.tripId.trim() ? body.tripId.trim() : undefined;
  const auth = await requireUserOrFieldTest(tripId);
  if (!auth.ok) return auth.response;
  if (auth.fieldTest && !tripId) {
    return NextResponse.json({ ok: false, error: "Field-test trip is required." }, { status: 400 });
  }
  if (auth.fieldTest) {
    const simulatedPayloadKeys = [
      "liveDemo",
      "simulated",
      "simulation",
      "simulationMode",
      "demoOverride",
      "simulatedLatitude",
      "simulatedLongitude",
      "simulatedLocation"
    ];
    if (simulatedPayloadKeys.some((key) => body[key] !== undefined)) {
      return NextResponse.json(
        { ok: false, error: "Field-test location updates accept real browser GPS only." },
        { status: 403 }
      );
    }
  }
  const liveDemoPayload =
    body.liveDemo && typeof body.liveDemo === "object" && !Array.isArray(body.liveDemo)
      ? body.liveDemo
      : null;
  const location = normalizeCoordinates({
    latitude: body.latitude as number,
    longitude: body.longitude as number,
    accuracy: body.accuracy as number | null
  });
  const capturedAt = body.capturedAt;

  const existing = await auth.supabase
    .from("roamly_location_settings")
    .select("location_tracking_enabled")
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (permissionState !== "granted") {
    // Grant-persistence fix (2026-10-31, owner's "the location turned
    // off on its own"): this branch used to upsert
    // location_tracking_enabled=false + last_permission_state=<value> +
    // cleared coordinates for ANY non-granted report. Two client watch
    // paths report transient geolocation failures here (Live's
    // watchPosition maps TIMEOUT/POSITION_UNAVAILABLE to "prompt"; the
    // shell tracker mapped ANY error to "denied"), so one bad GPS
    // moment silently turned the traveler's tracking OFF and erased a
    // recorded "granted". The settings model keeps the two facts
    // separate by design (setupState.ts): the GRANT is a device fact,
    // the SWITCH is the traveler's persisted choice. So:
    //  - "denied" (a true PERMISSION_DENIED) records the device fact
    //    and clears coordinates a denied browser can no longer refresh
    //    — but never flips the switch; only the settings PATCH (the
    //    traveler's own toggle) changes location_tracking_enabled.
    //  - "prompt" carries no permission fact at all (it is how the
    //    clients report transient errors): write NOTHING.
    if (permissionState === "denied") {
      const { error: deniedError } = await auth.supabase.from("roamly_location_settings").upsert(
        {
          user_id: auth.userId,
          last_permission_state: "denied",
          last_seen_latitude: null,
          last_seen_longitude: null,
          last_seen_at: null
        },
        { onConflict: "user_id" }
      );
      if (deniedError) {
        return NextResponse.json({ ok: false, error: "Could not update location settings." }, { status: 500 });
      }
      await recordTripEvent(auth.supabase, {
        userId: auth.userId,
        eventType: "location_permission_denied",
        eventTitle: "Location permission updated",
        eventBody: "Permission state: denied"
      });
      return NextResponse.json({ ok: true, permissionRecorded: "denied" as const, tripActivated: false });
    }
    return NextResponse.json({
      ok: true,
      permissionRecorded: null,
      tripActivated: false,
      message: "A temporary location error does not change your saved location settings."
    });
  }

  if (!location) {
    return NextResponse.json({ ok: false, error: "Valid latitude and longitude are required." }, { status: 400 });
  }

  if (!isFreshLocationObservation(capturedAt)) {
    return NextResponse.json({
      ok: true,
      staleLocation: true,
      tripActivated: false,
      message: "Location update was too old or invalid to process."
    });
  }

  if (!existing.data?.location_tracking_enabled) {
    return NextResponse.json({
      ok: true,
      trackingDisabled: true,
      tripActivated: false,
      message: "Location permission is disabled in this Roamly account."
    });
  }

  const observedAt = new Date(typeof capturedAt === "number" ? capturedAt : String(capturedAt)).toISOString();

  // Grant-confirmation decoupling (release-blocker fix, 2026-10-31):
  // reaching this line means the server has just received, from the
  // authenticated account, a REAL fresh location fix together with
  // permissionState "granted" and the account's tracking switch on —
  // that request IS the server-verifiable evidence that the browser
  // grant exists. Record the permission FACT (last_permission_state)
  // on the account's settings row here, independently of the
  // foreground-location RPC below. Previously the RPC was the only
  // writer of this fact on the granted path, and it refuses the write
  // unless an already-operational trip exists (status locked/active/
  // planned + itinerary_locked + tracking/live-companion unlocked +
  // in-window, migration 20260928000200) — so a traveler whose Live
  // Companion was not yet unlocked could never get the grant
  // confirmed, /api/roamly/setup/complete 409'd forever, and the
  // setup location step could never complete (owner's Montreal trip,
  // 2026-10-30/31). COORDINATES stay exactly as operationally scoped
  // as the migration intends: this upsert writes no coordinate and
  // the RPC still accepts or refuses/erases last_seen_* on its own
  // terms below.
  const { error: permissionRecordError } = await auth.supabase
    .from("roamly_location_settings")
    .upsert(
      { user_id: auth.userId, last_permission_state: "granted" },
      { onConflict: "user_id" }
    );
  if (permissionRecordError) {
    return NextResponse.json({ ok: false, error: "Could not record the location grant." }, { status: 500 });
  }

  const locationWrite = await writeForegroundLocation({
    supabase: auth.supabase,
    userId: auth.userId,
    tripId: tripId || null,
    latitude: location.latitude,
    longitude: location.longitude,
    observedAt
  });

  if (locationWrite.error) {
    return NextResponse.json({ ok: false, error: "Could not save this location update." }, { status: 500 });
  }
  if (!locationWrite.written) {
    return NextResponse.json({
      ok: true,
      trackingDisabled: false,
      tripActivated: false,
      message: "No operational trip currently requires foreground location."
    });
  }

  /*
   * watchPosition() calls this endpoint repeatedly.
   * Coordinates still update continuously, but do not add a
   * duplicate permission event for every GPS reading.
   */


  if (liveDemoPayload) {
    const access = auth.fieldTest ? { hasQaAccess: true } : getRoamlyAccessForUser(auth.userEmail);
    if (!access.hasQaAccess || !tripId) {
      return NextResponse.json({ ok: false, error: "Live Demo is only available to tester/admin accounts." }, { status: 403 });
    }
    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip is required for Live Demo." }, { status: 400 });
    }

    const demo = await processLiveCompanionDemoUpdate({
      supabase: auth.supabase,
      userId: auth.userId,
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

  const activation = await activateTripIfNearby(auth.supabase, auth.userId, location, tripId);

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
