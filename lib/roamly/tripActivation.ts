import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateDistanceMeters, isWithinRadius, type LocationInput } from "@/lib/roamly/location";
import { recordTripEvent } from "@/lib/roamly/events";
import { getTripDayFromDate } from "@/lib/itinerary";
import { isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { createInAppNotification } from "@/lib/roamly/pushServer";

export type TrackingTrip = {
  id: string;
  user_id: string | null;
  title: string;
  destination?: string | null;
  destination_name: string | null;
  destination_country: string | null;
  destination_region: string | null;
  destination_city: string | null;
  start_date: string | null;
  end_date: string | null;
  days_count?: number | null;
  status: string;
  is_activated?: boolean | null;
  activated_at?: string | null;
  itinerary_status: string | null;
  itinerary_locked: boolean | null;
  itinerary_generated_at: string | null;
  tracking_unlocked: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata: Record<string, unknown> | null;
};

export type TrackingDay = {
  id: string;
  trip_id: string;
  day_number: number;
  date: string | null;
  title: string | null;
  summary: string | null;
};

export type TrackingActivity = {
  id: string;
  trip_id: string;
  trip_day_id: string | null;
  title: string;
  description: string | null;
  category: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  sort_order: number;
  status: "planned" | "nearby" | "checked_in" | "completed" | "skipped" | "missed";
  checked_in_at: string | null;
  completed_at: string | null;
  metadata?: Record<string, unknown> | null;
  distance_meters?: number;
};

export type TripNotificationPayload = {
  title: string;
  body: string;
  type: "trip_activated" | "activity_nearby" | "day_started";
};

type ActivationOptions = {
  simulated?: boolean;
  source?: string;
};

export function getCurrentTripDay(trip: Pick<TrackingTrip, "start_date"> & { days_count?: number | null }) {
  return getTripDayFromDate(trip.start_date, trip.days_count || null);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function getActiveOrUpcomingTrip(supabase: SupabaseClient, userId: string, tripId?: string) {
  const today = todayIso();
  let query = supabase
    .from("roamly_trips")
    .select("*")
    .eq("user_id", userId)
    .eq("itinerary_locked", true)
    .eq("tracking_unlocked", true)
    .in("status", ["locked", "active", "planned"])
    .or(`end_date.gte.${today},end_date.is.null`);
  if (tripId) query = query.eq("id", tripId);
  const { data, error } = await query
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return { trip: null, error: error.message };
  const trip = ((data || []) as TrackingTrip[]).find((candidate) => isTripLocked(candidate) && tripHasTrackingUnlock(candidate)) || null;
  return { trip };
}

export async function getCurrentDayRecord(supabase: SupabaseClient, trip: TrackingTrip) {
  const currentDayNumber = getCurrentTripDay(trip);
  const { data } = await supabase
    .from("roamly_trip_days")
    .select("*")
    .eq("trip_id", trip.id)
    .eq("day_number", currentDayNumber)
    .maybeSingle();

  return {
    dayNumber: currentDayNumber,
    day: (data as TrackingDay | null) ?? null
  };
}

export async function findNearbyActivities(supabase: SupabaseClient, tripId: string, location: LocationInput) {
  const { data, error } = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("trip_id", tripId)
    .in("status", ["planned", "nearby", "checked_in"])
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .order("sort_order", { ascending: true });

  if (error) return { activities: [], error: error.message };

  const activities = ((data || []) as TrackingActivity[])
    .map((activity) => ({
      ...activity,
      distance_meters: calculateDistanceMeters(
        location.latitude,
        location.longitude,
        Number(activity.latitude),
        Number(activity.longitude)
      )
    }))
    .filter((activity) =>
      isWithinRadius(
        location.latitude,
        location.longitude,
        activity.latitude,
        activity.longitude,
        activity.radius_meters || 250
      )
    )
    .sort((a, b) => (a.distance_meters || 0) - (b.distance_meters || 0));

  return { activities };
}

export async function getCheckedActivities(supabase: SupabaseClient, tripId: string) {
  const { data, error } = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("trip_id", tripId)
    .in("status", ["checked_in", "completed"])
    .order("checked_in_at", { ascending: false, nullsFirst: false })
    .limit(12);

  if (error) return { activities: [], error: error.message };
  return { activities: (data || []) as TrackingActivity[] };
}

export async function getUpNextActivity(supabase: SupabaseClient, tripId: string, location?: LocationInput) {
  const { data, error } = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("trip_id", tripId)
    .not("status", "in", "(completed,skipped,missed)")
    .order("scheduled_start", { ascending: true, nullsFirst: false })
    .order("sort_order", { ascending: true })
    .limit(30);

  if (error) return { activity: null, error: error.message };

  const activities = ((data || []) as TrackingActivity[]).map((activity) => {
    if (!location || activity.latitude == null || activity.longitude == null) return activity;
    return {
      ...activity,
      distance_meters: calculateDistanceMeters(location.latitude, location.longitude, activity.latitude, activity.longitude)
    };
  });

  return {
    activity: activities.sort((a, b) => {
      const priority = (activity: TrackingActivity) => {
        if (activity.scheduled_start) return 0;
        if (activity.status === "nearby") return 1;
        if (activity.status === "checked_in") return 2;
        return 3;
      };
      const priorityDiff = priority(a) - priority(b);
      if (priorityDiff) return priorityDiff;
      if (a.scheduled_start && b.scheduled_start) {
        return new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
      }
      if (a.distance_meters != null && b.distance_meters != null) return a.distance_meters - b.distance_meters;
      return a.sort_order - b.sort_order;
    })[0] || null
  };
}

export function buildTripNotificationPayload(params: {
  trip: TrackingTrip;
  dayNumber: number;
  nearbyActivity?: TrackingActivity | null;
  tripActivated: boolean;
}): TripNotificationPayload | null {
  if (params.tripActivated) {
    return {
      title: "Live Trip Companion ready",
      body: `Day ${params.dayNumber} is ready. Your nearby activities are now live.`,
      type: "trip_activated"
    };
  }

  if (params.nearbyActivity) {
    return {
      title: `Nearby now: ${params.nearbyActivity.title}`,
      body: "You are near a planned activity. Check in when you arrive.",
      type: "activity_nearby"
    };
  }

  return null;
}

function simulationMetadata(options?: ActivationOptions, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    ...(options?.simulated ? { simulated: true, source: options.source || "tester_location_simulator" } : {})
  };
}

export async function activateTripIfNearby(
  supabase: SupabaseClient,
  userId: string,
  location: LocationInput,
  tripId?: string,
  options?: ActivationOptions
) {
  const tripResult = await getActiveOrUpcomingTrip(supabase, userId, tripId);
  const trip = tripResult.trip;

  if (!trip) {
    return {
      tripActivated: false,
      trip: null,
      currentDay: null,
      nearbyActivities: [] as TrackingActivity[],
      checkedActivities: [] as TrackingActivity[],
      upNextActivity: null as TrackingActivity | null,
      notification: null as TripNotificationPayload | null,
      error: tripResult.error
    };
  }

  const nearby = await findNearbyActivities(supabase, trip.id, location);
  const currentDay = await getCurrentDayRecord(supabase, trip);
  const checked = await getCheckedActivities(supabase, trip.id);
  const upNext = await getUpNextActivity(supabase, trip.id, location);
  const wasTripActivatedNow = trip.status !== "active" && nearby.activities.length > 0;

  if (nearby.activities.length) {
    const newlyNearby = nearby.activities.filter((activity) => activity.status === "planned");
    const nearbyIds = newlyNearby.map((activity) => activity.id);
    const nearbyTitles = newlyNearby.map((activity) => activity.title).filter(Boolean);

    if (nearbyIds.length) {
      await supabase.from("roamly_activities").update({ status: "nearby" }).in("id", nearbyIds);
    }
    if (nearbyTitles.length) {
      await supabase.from("roamly_trip_activities").update({ status: "nearby" }).eq("trip_id", trip.id).in("title", nearbyTitles);
    }
  }

  if (wasTripActivatedNow) {
    const now = new Date().toISOString();
    await supabase
      .from("roamly_trips")
      .update({
        status: "active",
        activated_at: trip.activated_at || now
      })
      .eq("id", trip.id)
      .eq("user_id", userId);

    await recordTripEvent(supabase, {
      userId,
      tripId: trip.id,
      activityId: nearby.activities[0]?.id,
      eventType: "trip_activated",
      eventTitle: "Live Trip Companion ready",
      eventBody: `Live Trip Companion ready - Day ${currentDay.dayNumber}`,
      latitude: location.latitude,
      longitude: location.longitude,
      distanceMeters: nearby.activities[0]?.distance_meters,
      metadata: simulationMetadata(options, { dayNumber: currentDay.dayNumber })
    });
  }

  if (nearby.activities[0]) {
    await recordTripEvent(supabase, {
      userId,
      tripId: trip.id,
      activityId: nearby.activities[0].id,
      eventType: "activity_nearby",
      eventTitle: `Nearby now: ${nearby.activities[0].title}`,
      eventBody: "A planned activity is near your current location.",
      latitude: location.latitude,
      longitude: location.longitude,
      distanceMeters: nearby.activities[0].distance_meters,
      metadata: simulationMetadata(options)
    });

    const now = new Date().toISOString();
    const companion = await supabase
      .from("roamly_trip_companion_events")
      .insert({
        user_id: userId,
        trip_id: trip.id,
        event_type: "nearby_activity",
        title: `Nearby now: ${nearby.activities[0].title}`,
        body: "You are near a planned activity. Check in when you arrive.",
        scheduled_for: now,
        completed_at: now,
        status: "shown",
        metadata: simulationMetadata(options, {
          activityId: nearby.activities[0].id,
          distanceMeters: nearby.activities[0].distance_meters ?? null
        })
      })
      .select("id")
      .maybeSingle();

    await createInAppNotification(supabase, {
      userId,
      tripId: trip.id,
      eventId: companion.data?.id || null,
      type: "nearby_activity",
      title: `Nearby now: ${nearby.activities[0].title}`,
      body: "Check in, skip, or open directions from your Live Trip Companion.",
      actionUrl: `/trip/${trip.id}/live`,
      metadata: {
        activityId: nearby.activities[0].id,
        distanceMeters: nearby.activities[0].distance_meters ?? null,
        ...(options?.simulated ? { simulated: true, source: options.source || "tester_location_simulator" } : {})
      }
    });
  }

  const notification = buildTripNotificationPayload({
    trip,
    dayNumber: currentDay.dayNumber,
    nearbyActivity: nearby.activities[0],
    tripActivated: wasTripActivatedNow
  });

  if (notification) {
    await recordTripEvent(supabase, {
      userId,
      tripId: trip.id,
      activityId: nearby.activities[0]?.id,
      eventType: "notification_shown",
      eventTitle: notification.title,
      eventBody: notification.body,
      latitude: location.latitude,
      longitude: location.longitude,
      distanceMeters: nearby.activities[0]?.distance_meters,
      metadata: simulationMetadata(options, { type: notification.type })
    });
  }

  return {
    tripActivated: wasTripActivatedNow,
    trip: wasTripActivatedNow ? { ...trip, status: "active" } : trip,
    currentDay,
    nearbyActivities: nearby.activities,
    checkedActivities: checked.activities,
    upNextActivity: upNext.activity,
    notificationCreated: Boolean(nearby.activities[0]),
    companionEventId: null,
    notification,
    error: nearby.error || checked.error || upNext.error
  };
}

export async function checkInNearbyActivities(
  supabase: SupabaseClient,
  userId: string,
  tripId: string,
  activityId: string,
  location: LocationInput
) {
  const { data: trip, error: tripError } = await supabase
    .from("roamly_trips")
    .select("*")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (tripError) return { ok: false, error: tripError.message, activity: null };
  if (!trip || !isTripLocked(trip) || !tripHasTrackingUnlock(trip)) {
    return { ok: false, error: "Live Trip Companion requires a locked itinerary and the companion add-on.", activity: null };
  }

  const { data: activity, error } = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("id", activityId)
    .eq("trip_id", tripId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message, activity: null };
  if (!activity) return { ok: false, error: "Activity not found.", activity: null };

  const typed = activity as TrackingActivity;
  const distance =
    typed.latitude != null && typed.longitude != null
      ? calculateDistanceMeters(location.latitude, location.longitude, typed.latitude, typed.longitude)
      : null;

  if (
    typed.latitude != null &&
    typed.longitude != null &&
    !isWithinRadius(location.latitude, location.longitude, typed.latitude, typed.longitude, typed.radius_meters || 250)
  ) {
    return { ok: false, error: "You are not close enough to check in to this activity.", activity: typed };
  }

  const now = new Date().toISOString();
  const update = await supabase
    .from("roamly_activities")
    .update({ status: "checked_in", checked_in_at: now })
    .eq("id", activityId)
    .eq("trip_id", tripId)
    .select("*")
    .single();

  if (update.error) return { ok: false, error: update.error.message, activity: null };

  await recordTripEvent(supabase, {
    userId,
    tripId,
    activityId,
    eventType: "activity_checked_in",
    eventTitle: `Checked in: ${typed.title}`,
    eventBody: "Activity check-in completed.",
    latitude: location.latitude,
    longitude: location.longitude,
    distanceMeters: distance
  });

  return { ok: true, activity: update.data as TrackingActivity };
}
