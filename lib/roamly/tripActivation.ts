import { sendPushNotification } from "@/lib/roamly/pushServer";
import {
  liveCompanionNotificationIdentity,
  queueCompanionNotification,
  sendCompanionNotificationDelivery
} from "@/lib/roamly/companionNotifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateDistanceMeters, isWithinRadius, type LocationInput } from "@/lib/roamly/location";
import { recordTripEvent } from "@/lib/roamly/events";
import { getTripDayFromDate } from "@/lib/itinerary";
import { isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { getCompanionPreferences } from "@/lib/roamly/companionPreferences";
import {
  DEFAULT_LIVE_COMPANION_SETTINGS,
  activityEndDate,
  activityStartDate,
  buildLiveCompanionState,
  evaluateNotificationDecision,
  isTodayWithinTripDates,
  selectNowAndNextActivity,
  tripWindowState,
  timezoneFromTripMetadata,
  type LiveCompanionActivity,
  type LiveCoordinates,
  type LiveRouteStatus,
  type LiveCompanionTrip,
  type LiveNotificationHistoryItem,
  type LiveNotificationType
} from "@/lib/roamly/liveCompanion";
import { getLiveRouteStatus } from "@/lib/roamly/liveRouting";

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
  trip_companion_status?: string | null;
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
  decisionNow?: Date;
};

export function getCurrentTripDay(trip: Pick<TrackingTrip, "start_date"> & { days_count?: number | null }) {
  return getTripDayFromDate(trip.start_date, trip.days_count || null);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}


function toLiveCompanionActivity(
  activity: TrackingActivity
): LiveCompanionActivity {
  return {
    id: activity.id,
    title: activity.title,
    shortDescription: activity.description,
    startAt: activity.scheduled_start,
    endAt: activity.scheduled_end,
    address: activity.address,
    latitude: activity.latitude,
    longitude: activity.longitude,
    radiusMeters: activity.radius_meters,
    status: activity.status
  };
}

function isLiveNotificationType(
  value: unknown
): value is LiveNotificationType {
  return (
    value === "trip_active" ||
    value === "activity_start" ||
    value === "leave_by" ||
    value === "arrival" ||
    value === "late" ||
    value === "booking_change" ||
    value === "next_activity"
  );
}

function companionEventTypeForLiveNotification(
  value: LiveNotificationType
) {
  if (value === "next_activity") return "up_next_activity";
  if (value === "leave_by") return "departure_reminder";
  if (value === "late") return "running_late";
  if (value === "arrival") return "arrival_detected";
  if (value === "activity_start") return "activity_start";
  return "up_next_activity";
}

function liveNotificationTypeFromCompanionEvent(
  value: unknown
): LiveNotificationType | null {
  if (isLiveNotificationType(value)) return value;
  if (value === "up_next_activity") return "next_activity";
  if (value === "departure_reminder") return "leave_by";
  if (value === "running_late") return "late";
  if (value === "arrival_detected") return "arrival";
  return null;
}

function hasValidCoordinates(
  value: { latitude?: number | null; longitude?: number | null } | null | undefined
) {
  return (
    typeof value?.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude)
  );
}

function activitySortTime(activity: TrackingActivity, timezone: string) {
  const start = activityStartDate({
    activity: toLiveCompanionActivity(activity),
    timezone
  });
  return start?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function compareActivitiesChronologically(timezone: string) {
  return (a: TrackingActivity, b: TrackingActivity) => {
    const diff = activitySortTime(a, timezone) - activitySortTime(b, timezone);
    return diff || a.sort_order - b.sort_order || a.title.localeCompare(b.title);
  };
}

function isActivityPastWindow(activity: TrackingActivity, timezone: string, now: Date) {
  const end = activityEndDate({
    activity: toLiveCompanionActivity(activity),
    timezone
  });
  return Boolean(end && end.getTime() < now.getTime());
}

function isActivityReadyForNearby(activity: TrackingActivity, timezone: string, now: Date) {
  const start = activityStartDate({
    activity: toLiveCompanionActivity(activity),
    timezone
  });
  if (!start) return true;
  return start.getTime() - now.getTime() <= DEFAULT_LIVE_COMPANION_SETTINGS.reminderLeadMinutes * 60_000;
}

async function cancelOutstandingActivityEvents(
  supabase: SupabaseClient,
  params: {
    userId: string;
    tripId: string;
    activityIds: string[];
    completedAt: string;
  }
) {
  if (!params.activityIds.length) return;
  const { data } = await supabase
    .from("roamly_trip_companion_events")
    .select("id,metadata")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .in("status", ["scheduled", "processing"])
    .limit(200);

  const ids = new Set(params.activityIds);
  const eventIds = (data || [])
    .filter((event) => {
      const metadata = recordValue(event.metadata);
      const activityId =
        typeof metadata?.activityId === "string"
          ? metadata.activityId
          : typeof metadata?.activity_id === "string"
            ? metadata.activity_id
            : null;
      return Boolean(activityId && ids.has(activityId));
    })
    .map((event) => event.id)
    .filter((id): id is string => typeof id === "string");

  if (!eventIds.length) return;
  await supabase
    .from("roamly_trip_companion_events")
    .update({ status: "cancelled", completed_at: params.completedAt })
    .in("id", eventIds);
}

async function expirePastActivities(
  supabase: SupabaseClient,
  params: {
    trip: TrackingTrip;
    userId: string;
    timezone: string;
    now: Date;
  }
) {
  const { data: expirableActivities } = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("trip_id", params.trip.id)
    .in("status", ["planned", "active", "nearby"]);

  const expiredActivities = ((expirableActivities || []) as TrackingActivity[])
    .filter((activity) => isActivityPastWindow(activity, params.timezone, params.now));

  if (!expiredActivities.length) return [] as string[];

  const expiredActivityIds = expiredActivities.map((activity) => activity.id);
  const expiredTitles = expiredActivities.map((activity) => activity.title).filter(Boolean);
  const completedAt = params.now.toISOString();

  await supabase
    .from("roamly_activities")
    .update({ status: "missed", completed_at: completedAt })
    .eq("trip_id", params.trip.id)
    .in("status", ["planned", "active", "nearby"])
    .in("id", expiredActivityIds);

  if (expiredTitles.length) {
    await supabase
      .from("roamly_trip_activities")
      .update({ status: "missed", completed_at: completedAt })
      .eq("trip_id", params.trip.id)
      .in("status", ["planned", "nearby", "active"])
      .in("title", expiredTitles);
  }

  await cancelOutstandingActivityEvents(supabase, {
    userId: params.userId,
    tripId: params.trip.id,
    activityIds: expiredActivityIds,
    completedAt
  });

  return expiredActivityIds;
}

async function shutdownCompletedTripIfNeeded(
  supabase: SupabaseClient,
  userId: string,
  tripId: string,
  now: Date
) {
  const { data } = await supabase
    .from("roamly_trips")
    .select("id,user_id,status,start_date,end_date,metadata,trip_companion_status")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  const trip = data as TrackingTrip | null;
  if (!trip) return false;
  const state = tripWindowState({
    startDate: trip.start_date,
    endDate: trip.end_date,
    timezone: timezoneFromTripMetadata(trip.metadata),
    now
  });
  if (state !== "completed_trip") return false;

  const completedAt = now.toISOString();
  await supabase
    .from("roamly_trips")
    .update({
      status: trip.status === "cancelled" || trip.status === "archived" ? trip.status : "completed",
      trip_companion_status: "completed"
    })
    .eq("id", trip.id)
    .eq("user_id", userId);

  await supabase
    .from("roamly_trip_companion_events")
    .update({ status: "cancelled", completed_at: completedAt })
    .eq("user_id", userId)
    .eq("trip_id", trip.id)
    .in("status", ["scheduled", "processing"]);

  await supabase
    .from("roamly_activities")
    .update({ status: "missed", completed_at: completedAt })
    .eq("trip_id", trip.id)
    .in("status", ["planned", "nearby"]);

  await supabase
    .from("roamly_trip_activities")
    .update({ status: "missed", completed_at: completedAt })
    .eq("trip_id", trip.id)
    .in("status", ["planned", "nearby", "active"]);

  return true;
}

export async function getActiveOrUpcomingTrip(supabase: SupabaseClient, userId: string, tripId?: string) {
  const today = todayIso();
  let query = supabase
    .from("roamly_trips")
    .select("*")
    .eq("user_id", userId)
    .eq("itinerary_locked", true)
    .or("tracking_unlocked.eq.true,live_companion_unlocked.eq.true")
    .in("status", ["locked", "active", "planned"])
    .or(`end_date.gte.${today},end_date.is.null`);
  if (tripId) query = query.eq("id", tripId);
  const { data, error } = await query
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return { trip: null, error: error.message };
  const trip = ((data || []) as TrackingTrip[]).find((candidate) =>
    isTripLocked(candidate) &&
    tripHasTrackingUnlock(candidate) &&
    isTodayWithinTripDates({
      startDate: candidate.start_date,
      endDate: candidate.end_date,
      timezone: timezoneFromTripMetadata(candidate.metadata)
    })
  ) || null;
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

export async function findNearbyActivities(
  supabase: SupabaseClient,
  tripId: string,
  location: LocationInput,
  options: { now?: Date; timezone?: string | null } = {}
) {
  const now = options.now || new Date();
  const timezone = options.timezone || "UTC";
  const { data, error } = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("trip_id", tripId)
    .in("status", ["planned", "active", "nearby"])
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .order("sort_order", { ascending: true });

  if (error) return { activities: [], error: error.message };

  const openActivities = ((data || []) as TrackingActivity[])
    .filter((activity) => !isActivityPastWindow(activity, timezone, now))
    .sort(compareActivitiesChronologically(timezone));
  const chronologicalTarget = openActivities.find((activity) =>
    isActivityReadyForNearby(activity, timezone, now)
  );

  const activities = openActivities
    .filter((activity) => Boolean(chronologicalTarget && activity.id === chronologicalTarget.id))
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
    .sort(compareActivitiesChronologically(timezone));

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
    .not("status", "in", "(completed,checked_in,skipped,missed,cancelled)")
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

  return { activity: activities[0] || null };
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
  const processingNow =
    options?.simulated === true && options.decisionNow
      ? options.decisionNow
      : new Date();
  const tripResult = await getActiveOrUpcomingTrip(supabase, userId, tripId);
  const trip = tripResult.trip;

  if (!trip) {
    if (tripId) {
      await shutdownCompletedTripIfNeeded(supabase, userId, tripId, processingNow);
    }
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

  const preferences = await getCompanionPreferences({ supabase, userId, tripId: trip.id });
  const pausedUntil = preferences.liveCompanionPausedUntil ? new Date(preferences.liveCompanionPausedUntil) : null;
  if (!preferences.liveCompanionEnabled || (pausedUntil && pausedUntil.getTime() > processingNow.getTime())) {
    return {
      tripActivated: false,
      trip,
      currentDay: null,
      nearbyActivities: [] as TrackingActivity[],
      checkedActivities: [] as TrackingActivity[],
      upNextActivity: null as TrackingActivity | null,
      notification: null as TripNotificationPayload | null,
      notificationCreated: false,
      companionEventId: null,
      error: preferences.liveCompanionEnabled ? "Live Trip Companion is paused." : "Live Trip Companion is disabled."
    };
  }

  // Retire unresolved activities whose real itinerary window has ended.
  // This runs before nearby sensing so an expired activity cannot be
  // rediscovered by GPS and generate another Live Companion alert.
  const tripTimezone = timezoneFromTripMetadata(trip.metadata);
  await expirePastActivities(supabase, {
    trip,
    userId,
    timezone: tripTimezone,
    now: processingNow
  });

  const nearby = await findNearbyActivities(supabase, trip.id, location, {
    now: processingNow,
    timezone: tripTimezone
  });
  const currentDay = await getCurrentDayRecord(supabase, trip);
  const checked = await getCheckedActivities(supabase, trip.id);
  const upNext = await getUpNextActivity(supabase, trip.id, location);
  const wasTripActivatedNow = trip.status !== "active" && nearby.activities.length > 0;
  let nearbyPushSent = false;
  let companionEventId: string | null = null;

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
    const now = processingNow.toISOString();
    await supabase
      .from("roamly_trips")
      .update({
        status: "active",
        activated_at: trip.activated_at || now,
        trip_companion_status: "active"
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
  } else if (nearby.activities.length && trip.trip_companion_status !== "active") {
    await supabase
      .from("roamly_trips")
      .update({ trip_companion_status: "active" })
      .eq("id", trip.id)
      .eq("user_id", userId);
  }

  if (nearby.activities[0]) {
    const cooldownSince = new Date(processingNow.getTime() - 60 * 60_000).toISOString();
    const duplicate = await supabase
      .from("roamly_trip_companion_events")
      .select("id,metadata,created_at")
      .eq("user_id", userId)
      .eq("trip_id", trip.id)
      .eq("event_type", "nearby_activity")
      .gte("created_at", cooldownSince)
      .order("created_at", { ascending: false })
      .limit(10);
    const alreadyNotified = (duplicate.data || []).some((event) => {
      const metadata = recordValue(event.metadata);
      return metadata?.activityId === nearby.activities[0]?.id;
    });

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

    if (!alreadyNotified) {
      /*
       * LIVE COMPANION — NEARBY ACTIVITY
       *
       * `alreadyNotified` above prevents watchPosition() from
       * firing the same nearby alert repeatedly.
       *
       * Send this immediately to the phone notification wall.
       * Do not send email.
       */
      const nearbyActivity = nearby.activities[0];
      const queued = await queueCompanionNotification({
        supabase,
        userId,
        tripId: trip.id,
        type: "nearby_activity",
        priority: "routine",
        title: `You're nearby: ${nearbyActivity.title}`,
        body: "You're close to your next planned activity. Open Roamly when you're ready.",
        actionUrl: `/trip/${trip.id}/live?activity=${encodeURIComponent(nearbyActivity.id)}`,
        scheduledFor: processingNow.toISOString(),
        metadata: {
          activityId: nearbyActivity.id,
          latitude: nearbyActivity.latitude,
          longitude: nearbyActivity.longitude,
          send_email: false,
          source: "location"
        },
        idempotencyKey: liveCompanionNotificationIdentity({
          userId,
          tripId: trip.id,
          activityId: nearbyActivity.id,
          eventType: "nearby_activity"
        }),
        dedupeParts: [
          liveCompanionNotificationIdentity({
            userId,
            tripId: trip.id,
            activityId: nearbyActivity.id,
            eventType: "nearby_activity"
          })
        ]
      });
      const pushed = queued.ok && queued.delivery?.id
        ? await sendCompanionNotificationDelivery(queued.delivery.id)
        : queued;

      if (pushed.ok && !queued.deduplicated) {
        const now = processingNow.toISOString();
        const companionEvent = await supabase
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
              activityId: nearbyActivity.id,
              distanceMeters: nearbyActivity.distance_meters ?? null,
              notificationReason: "arrival_proximity"
            })
          })
          .select("id")
          .maybeSingle();
        nearbyPushSent = true;
        companionEventId = companionEvent.data?.id || null;
      }
    }
  }


  /*
   * =========================================================
   * LIVE COMPANION — CHRONOLOGICAL INDIVIDUAL PUSHES
   * =========================================================
   *
   * Nearby remains handled by the existing GPS push block above.
   *
   * These additional events use Roamly's existing timing,
   * arrival and anti-spam decision engine.
   */

  if (trip && upNext.activity) {
    const activeTrip = trip;

    const liveTrip: LiveCompanionTrip = {
      id: activeTrip.id,
      title: activeTrip.title,
      startDate: activeTrip.start_date,
      endDate: activeTrip.end_date,
      timezone: timezoneFromTripMetadata(
        activeTrip.metadata
      ),
      enabled: true
    };

    const liveActivities: LiveCompanionActivity[] =
      checked.activities.map(
        toLiveCompanionActivity
      );

    const fallbackLiveActivity =
      toLiveCompanionActivity(
        upNext.activity
      );

    if (
      !liveActivities.some(
        (activity) =>
          activity.id ===
          fallbackLiveActivity.id
      )
    ) {
      liveActivities.push(
        fallbackLiveActivity
      );
    }

    const historySince =
      new Date(
        Date.now() -
          24 * 60 * 60 * 1000
      ).toISOString();

    const historyResult =
      await supabase
        .from(
          "roamly_trip_companion_events"
        )
        .select(
          "event_type,created_at,metadata"
        )
        .eq(
          "user_id",
          userId
        )
        .eq(
          "trip_id",
          activeTrip.id
        )
        .gte(
          "created_at",
          historySince
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(100);

    const history: LiveNotificationHistoryItem[] =
      [];

    for (
      const event of
      historyResult.data || []
    ) {
      const metadata =
        recordValue(
          event.metadata
        );

      const eventType =
        liveNotificationTypeFromCompanionEvent(
          metadata?.liveNotificationType ||
          event.event_type
        );

      if (!eventType) {
        continue;
      }

      const activityId =
        typeof metadata?.activityId === "string"
          ? metadata.activityId
          : typeof metadata?.activity_id === "string"
            ? metadata.activity_id
            : null;

      history.push({
        eventType,

        activityId,

        sentAt:
          event.created_at,

        key:
          String(
            metadata?.liveNotificationKey ||
            `${eventType}:${activityId || "trip"}`
          )
      });
    }

    const liveNow =
      processingNow;

    const routeSelection =
      selectNowAndNextActivity({
        activities:
          liveActivities,

        tripStartDate:
          liveTrip.startDate,

        timezone:
          liveTrip.timezone,

        now:
          liveNow
      });

    const routeDestination =
      routeSelection.next ||
      fallbackLiveActivity;

    const routeOrigin: LiveCoordinates = {
      latitude:
        location.latitude,

      longitude:
        location.longitude,

      accuracy:
        location.accuracy ??
        null
    };

    const liveRoute: LiveRouteStatus | null =
      hasValidCoordinates(
        routeOrigin
      ) &&
      hasValidCoordinates(
        routeDestination
      )
        ? await getLiveRouteStatus({
            origin:
              routeOrigin,

            destination:
              routeDestination,

            mode:
              "walking"
          })
        : null;

    const companionState =
      buildLiveCompanionState({
        trip: liveTrip,

        activities:
          liveActivities,

        permission:
          "granted",

        location: {
          latitude:
            location.latitude,

          longitude:
            location.longitude,

          accuracy:
            location.accuracy ??
            null
        },

        route:
          liveRoute,

        now:
          liveNow
      });

    const nextLiveActivity =
      companionState.next ||
      fallbackLiveActivity;

    const nextLiveTitle =
      nextLiveActivity.title;

    const arrivalLiveActivity =
      companionState.now ||
      companionState.next ||
      fallbackLiveActivity;

    const arrivalLiveTitle =
      arrivalLiveActivity.title;

    async function pushLiveEvent(params: {
      eventType:
        | "next_activity"
        | "leave_by"
        | "late"
        | "arrival";

      title: string;
      body: string;
      reason: string;

      locationState?:
        | "arrived"
        | "nearby"
        | "away"
        | "unknown";

      activity?: LiveCompanionActivity;
    }) {
      const liveActivity =
        params.activity ||
        nextLiveActivity;

      const liveActivityId =
        liveActivity.id;

      const actionUrl =
        `/trip/${activeTrip.id}/live?activity=${encodeURIComponent(
          liveActivityId
        )}`;
      const maps =
        liveActivity.latitude != null &&
        liveActivity.longitude != null
          ? {
              appleMapsUrl:
                `https://maps.apple.com/?daddr=${liveActivity.latitude},${liveActivity.longitude}`,
              googleMapsUrl:
                `https://www.google.com/maps/dir/?api=1&destination=${liveActivity.latitude},${liveActivity.longitude}`,
              citymapperUrl:
                `https://citymapper.com/directions?endcoord=${liveActivity.latitude},${liveActivity.longitude}`
            }
          : {};

      const decision =
        evaluateNotificationDecision({
          eventType:
            params.eventType,

          activity:
            liveActivity,

          history,
          now:
            liveNow,

          activeWindow:
            companionState.activeWindow,

          paused:
            false,

          locationState:
            params.locationState ||
            companionState.arrivalState,

          reason:
            params.reason
        });

      if (
        !decision.notificationSent
      ) {
        return;
      }

      if (
        history.some(
          (item) =>
            item.key ===
            decision.key
        )
      ) {
        return;
      }

      const pushed =
        await sendPushNotification(
          supabase,
          userId,
          {
            tripId:
              activeTrip.id,

            type:
              params.eventType,

            title:
              params.title,

            body:
              params.body,

            actionUrl,

            ...maps,

            checkInUrl:
              `/api/roamly/activities/check-in?tripId=${encodeURIComponent(activeTrip.id)}&activityId=${encodeURIComponent(
                liveActivityId
              )}`,

            skipUrl:
              `/api/roamly/activities/skip?tripId=${encodeURIComponent(activeTrip.id)}&activityId=${encodeURIComponent(
                liveActivityId
              )}`
          },
          {
            sendEmail:
              false,

            createNotification:
              false
          }
        );

      /*
       * Do not mark the timeline event as delivered unless an
       * actual enabled push subscription received it.
       */
      if (
        Number(
          pushed.sent || 0
        ) <= 0
      ) {
        return;
      }

      const now =
        new Date().toISOString();

      await supabase
        .from(
          "roamly_trip_companion_events"
        )
        .insert({
          user_id:
            userId,

          trip_id:
            activeTrip.id,

          event_type:
            companionEventTypeForLiveNotification(
              params.eventType
            ),

          title:
            params.title,

          body:
            params.body,

          scheduled_for:
            now,

          completed_at:
            now,

          status:
            "shown",

          metadata:
            simulationMetadata(
              options,
              {
                activityId:
                  liveActivityId,

                liveNotificationType:
                  params.eventType,

                liveNotificationKey:
                  decision.key,

                notificationReason:
                  params.reason,

                countdownMinutes:
                  companionState.countdownMinutes ??
                  null,

                leaveBy:
                  companionState.leaveBy ??
                  null,

                lateByMinutes:
                  companionState.lateByMinutes ??
                  null,

                arrivalState:
                  companionState.arrivalState
              }
            )
        });

      history.push({
        eventType:
          params.eventType,

        activityId:
          liveActivityId,

        sentAt:
          decision.eventTime,

        key:
          decision.key
      });
    }


    /*
     * 1. UP NEXT / STARTING SOON
     */
    if (
      typeof companionState.countdownMinutes ===
        "number" &&
      companionState.countdownMinutes >= 0 &&
      companionState.countdownMinutes <= 30
    ) {
      const minutes =
        Math.max(
          1,
          Math.round(
            companionState.countdownMinutes
          )
        );

      await pushLiveEvent({
        eventType:
          "next_activity",

        title:
          minutes <= 15
            ? `Starting soon: ${nextLiveTitle}`
            : `Up next: ${nextLiveTitle}`,

        body:
          `Starts in ${minutes} min.`,

        reason:
          minutes <= 15
            ? "activity_starting_soon"
            : "up_next"
      });
    }


    /*
     * 2. LEAVE NOW
     */
    if (
      companionState.leaveBy
    ) {
      const leaveAt =
        new Date(
          companionState.leaveBy
        ).getTime();

      if (
        Number.isFinite(
          leaveAt
        ) &&
        Date.now() >=
          leaveAt &&
        (
          !companionState.lateByMinutes ||
          companionState.lateByMinutes <= 0
        )
      ) {
        await pushLiveEvent({
          eventType:
            "leave_by",

          title:
            `Leave now for ${nextLiveTitle}`,

          body:
            `Time to head out.`,

          reason:
            "recommended_departure_reached"
        });
      }
    }


    /*
     * 3. RUNNING LATE
     */
    if (
      typeof companionState.lateByMinutes ===
        "number" &&
      companionState.lateByMinutes > 0
    ) {
      const lateMinutes =
        Math.max(
          1,
          Math.round(
            companionState.lateByMinutes
          )
        );

      await pushLiveEvent({
        eventType:
          "late",

        title:
          `You're running late for ${nextLiveTitle}`,

        body:
          `About ${lateMinutes} min behind.`,

        reason:
          "traveler_running_late"
      });
    }


    /*
     * 4. ARRIVED
     *
     * Nearby remains the separate GPS alert already above.
     */
    if (
      companionState.arrivalState ===
        "arrived"
    ) {
      await pushLiveEvent({
        eventType:
          "arrival",

        title:
          `You've arrived at ${arrivalLiveTitle}`,

        body:
          `You're here.`,

        reason:
          "arrival_radius_entered",

        locationState:
          "arrived",

        activity:
          arrivalLiveActivity
      });
    }
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
    notificationCreated: nearbyPushSent,
    companionEventId,
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
