import type { SupabaseClient } from "@supabase/supabase-js";
import { isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { recordTripEvent } from "@/lib/roamly/events";
import { calculateDistanceMeters, isWithinRadius, type LocationInput } from "@/lib/roamly/location";
import { createInAppNotification } from "@/lib/roamly/pushServer";
import { getUpNextActivity, type TrackingActivity } from "@/lib/roamly/tripActivation";

export type RoamlyActivityAction = "check_in" | "skip" | "complete";
export type RoamlyActivityStatus = "planned" | "nearby" | "checked_in" | "completed" | "skipped" | "missed";

type ActionTrip = {
  id: string;
  user_id: string;
  itinerary_locked?: boolean | null;
  itinerary_status?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
};

type DisplayActivity = {
  id: string;
  trip_id: string;
  day_number: number;
  title: string;
  description: string | null;
  location_name: string | null;
  map_query: string | null;
  status: RoamlyActivityStatus;
  checked_in_at?: string | null;
  completed_at?: string | null;
};

type LoadedActivity = {
  table: "tracking" | "display";
  trackingActivity: TrackingActivity | null;
  displayActivity: DisplayActivity | null;
  title: string;
  description: string | null;
  activityId: string;
};

const actionConfig = {
  check_in: {
    status: "checked_in" as const,
    eventType: "activity_checked_in",
    titlePrefix: "Checked in",
    body: "Activity check-in saved.",
    notification: "Check-in saved"
  },
  skip: {
    status: "skipped" as const,
    eventType: "activity_skipped",
    titlePrefix: "Skipped",
    body: "Activity skipped.",
    notification: "Activity skipped"
  },
  complete: {
    status: "completed" as const,
    eventType: "activity_completed",
    titlePrefix: "Completed",
    body: "Activity marked done.",
    notification: "Activity marked done"
  }
};

async function getTripForAction(supabase: SupabaseClient, tripId: string, userId?: string | null) {
  let query = supabase
    .from("roamly_trips")
    .select("id,user_id,itinerary_locked,itinerary_status,tracking_unlocked,live_companion_unlocked")
    .eq("id", tripId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error) return { trip: null, error: error.message };
  if (!data) return { trip: null, error: "Trip not found." };
  const trip = data as ActionTrip;
  if (!isTripLocked(trip) || !tripHasTrackingUnlock(trip)) {
    return { trip: null, error: "Live Trip Companion requires a locked itinerary and the companion add-on." };
  }
  return { trip, error: null };
}

async function findMatchingDisplayActivity(
  supabase: SupabaseClient,
  tripId: string,
  trackingActivity: TrackingActivity
) {
  const { data } = await supabase
    .from("roamly_trip_activities")
    .select("id,trip_id,day_number,title,description,location_name,map_query,status,checked_in_at,completed_at")
    .eq("trip_id", tripId)
    .eq("title", trackingActivity.title)
    .limit(1)
    .maybeSingle();
  return (data as DisplayActivity | null) || null;
}

async function findMatchingTrackingActivity(
  supabase: SupabaseClient,
  tripId: string,
  displayActivity: DisplayActivity
) {
  const { data } = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("trip_id", tripId)
    .eq("title", displayActivity.title)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as TrackingActivity | null) || null;
}

async function loadActivity(supabase: SupabaseClient, tripId: string, activityId: string): Promise<LoadedActivity | null> {
  const tracking = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("id", activityId)
    .eq("trip_id", tripId)
    .maybeSingle();

  if (tracking.data) {
    const trackingActivity = tracking.data as TrackingActivity;
    return {
      table: "tracking",
      trackingActivity,
      displayActivity: await findMatchingDisplayActivity(supabase, tripId, trackingActivity),
      title: trackingActivity.title,
      description: trackingActivity.description,
      activityId: trackingActivity.id
    };
  }

  const display = await supabase
    .from("roamly_trip_activities")
    .select("id,trip_id,day_number,title,description,location_name,map_query,status,checked_in_at,completed_at")
    .eq("id", activityId)
    .eq("trip_id", tripId)
    .maybeSingle();

  if (!display.data) return null;
  const displayActivity = display.data as DisplayActivity;
  return {
    table: "display",
    displayActivity,
    trackingActivity: await findMatchingTrackingActivity(supabase, tripId, displayActivity),
    title: displayActivity.title,
    description: displayActivity.description,
    activityId: displayActivity.id
  };
}

function buildActionUpdate(action: RoamlyActivityAction) {
  const now = new Date().toISOString();
  const config = actionConfig[action];
  return {
    status: config.status,
    checked_in_at: action === "check_in" ? now : undefined,
    completed_at: action === "complete" ? now : undefined
  };
}

function cleanUpdate(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

async function writeCompanionActivityEvent(
  supabase: SupabaseClient,
  params: {
    userId: string;
    tripId: string;
    action: RoamlyActivityAction;
    activityTitle: string;
    activityId?: string | null;
    source?: string;
  }
) {
  const config = actionConfig[params.action];
  const now = new Date().toISOString();
  const event = await supabase
    .from("roamly_trip_companion_events")
    .insert({
      user_id: params.userId,
      trip_id: params.tripId,
      event_type: config.eventType,
      title: `${config.titlePrefix}: ${params.activityTitle}`,
      body: config.body,
      scheduled_for: now,
      completed_at: now,
      status: params.action === "skip" ? "skipped" : "completed",
      metadata: {
        activityId: params.activityId || null,
        source: params.source || "user_action"
      }
    })
    .select("id")
    .maybeSingle();

  await createInAppNotification(supabase, {
    userId: params.userId,
    tripId: params.tripId,
    eventId: event.data?.id || null,
    type: config.eventType,
    title: config.notification,
    body: `${config.titlePrefix}: ${params.activityTitle}`,
    actionUrl: `/trip/${params.tripId}/live`,
    metadata: {
      activityId: params.activityId || null,
      source: params.source || "user_action"
    }
  });

  return { eventId: event.data?.id || null, error: event.error?.message || null };
}

export async function performActivityAction(
  supabase: SupabaseClient,
  params: {
    userId?: string | null;
    tripId: string;
    activityId: string;
    action: RoamlyActivityAction;
    location?: LocationInput | null;
    source?: string;
    requireNearbyForCheckIn?: boolean;
  }
) {
  const tripResult = await getTripForAction(supabase, params.tripId, params.userId);
  if (!tripResult.trip) return { ok: false as const, error: tripResult.error || "Trip not found." };

  const loaded = await loadActivity(supabase, params.tripId, params.activityId);
  if (!loaded) return { ok: false as const, error: "Activity not found." };

  const tracking = loaded.trackingActivity;
  const distance =
    tracking && params.location && tracking.latitude != null && tracking.longitude != null
      ? calculateDistanceMeters(params.location.latitude, params.location.longitude, tracking.latitude, tracking.longitude)
      : null;

  if (
    params.action === "check_in" &&
    params.requireNearbyForCheckIn &&
    tracking?.latitude != null &&
    tracking?.longitude != null &&
    params.location &&
    !isWithinRadius(
      params.location.latitude,
      params.location.longitude,
      tracking.latitude,
      tracking.longitude,
      tracking.radius_meters || 250
    )
  ) {
    return { ok: false as const, error: "You are not close enough to check in to this activity." };
  }

  const update = cleanUpdate(buildActionUpdate(params.action));
  const results: Array<{ error: { message: string } | null }> = [];

  if (loaded.trackingActivity) {
    results.push(
      await supabase
        .from("roamly_activities")
        .update(update)
        .eq("id", loaded.trackingActivity.id)
        .eq("trip_id", params.tripId)
    );
  }

  if (loaded.displayActivity) {
    results.push(
      await supabase
        .from("roamly_trip_activities")
        .update(update)
        .eq("id", loaded.displayActivity.id)
        .eq("trip_id", params.tripId)
    );
  }

  const failed = results.find((result) => result.error);
  if (failed?.error) return { ok: false as const, error: failed.error.message };

  const config = actionConfig[params.action];
  const tripEvent = await recordTripEvent(supabase, {
    userId: tripResult.trip.user_id,
    tripId: params.tripId,
    activityId: loaded.trackingActivity?.id || null,
    eventType: config.eventType,
    eventTitle: `${config.titlePrefix}: ${loaded.title}`,
    eventBody: config.body,
    latitude: params.location?.latitude,
    longitude: params.location?.longitude,
    distanceMeters: distance,
    metadata: {
      source: params.source || "user_action",
      requestedActivityId: params.activityId,
      trackingActivityId: loaded.trackingActivity?.id || null,
      displayActivityId: loaded.displayActivity?.id || null,
      action: params.action
    }
  });

  const companion = await writeCompanionActivityEvent(supabase, {
    userId: tripResult.trip.user_id,
    tripId: params.tripId,
    action: params.action,
    activityTitle: loaded.title,
    activityId: loaded.trackingActivity?.id || loaded.displayActivity?.id || params.activityId,
    source: params.source
  });

  const upNext = await getUpNextActivity(supabase, params.tripId, params.location || undefined);
  return {
    ok: true as const,
    trip: tripResult.trip,
    activity: {
      ...(loaded.trackingActivity || loaded.displayActivity),
      status: actionConfig[params.action].status
    },
    upNextActivity: upNext.activity,
    tripEventError: tripEvent.error?.message || null,
    companionEventId: companion.eventId,
    companionEventError: companion.error
  };
}

export async function markNearbyActivities(
  supabase: SupabaseClient,
  params: {
    userId: string;
    tripId: string;
    activities: TrackingActivity[];
    location: LocationInput;
  }
) {
  const nearbyIds = params.activities.filter((activity) => activity.status === "planned").map((activity) => activity.id);
  if (nearbyIds.length) {
    await supabase.from("roamly_activities").update({ status: "nearby" }).in("id", nearbyIds);
  }

  const first = params.activities[0];
  if (!first) return { notificationCreated: false, companionEventId: null as string | null };

  const now = new Date().toISOString();
  const companion = await supabase
    .from("roamly_trip_companion_events")
    .insert({
      user_id: params.userId,
      trip_id: params.tripId,
      event_type: "nearby_activity",
      title: `Nearby now: ${first.title}`,
      body: "You are near a planned activity. Check in when you arrive.",
      scheduled_for: now,
      completed_at: now,
      status: "shown",
      metadata: { activityId: first.id, distanceMeters: first.distance_meters ?? null }
    })
    .select("id")
    .maybeSingle();

  await createInAppNotification(supabase, {
    userId: params.userId,
    tripId: params.tripId,
    eventId: companion.data?.id || null,
    type: "nearby_activity",
    title: `Nearby now: ${first.title}`,
    body: "Check in, skip, or open directions from your Live Trip Companion.",
    actionUrl: `/trip/${params.tripId}/live`,
    metadata: { activityId: first.id, distanceMeters: first.distance_meters ?? null }
  });

  return { notificationCreated: true, companionEventId: companion.data?.id || null };
}
