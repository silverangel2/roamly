import { performActivityAction } from "@/lib/roamly/activityActions";
import { createInAppNotification, sendPushNotification } from "@/lib/roamly/pushServer";
import {
  activateTripIfNearby,
  getUpNextActivity,
  type TrackingActivity,
  type TrackingTrip
} from "@/lib/roamly/tripActivation";
import { calculateDistanceMeters, type LocationInput } from "@/lib/roamly/location";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import {
  activityEndDate,
  timezoneFromTripMetadata
} from "@/lib/roamly/liveCompanion";

export type LiveTestLocationMode = "first_activity" | "next_activity" | "hotel" | "far_away";
export type LiveTestReminderType = "one_week_before" | "one_day_before" | "countdown_24h" | "travel_day_started";

const reminderCopy: Record<LiveTestReminderType, { title: string; body: string }> = {
  one_week_before: {
    title: "One week before your trip",
    body: "Review bookings, documents, weather, and packing list."
  },
  one_day_before: {
    title: "Tomorrow is travel day",
    body: "Charge devices, download maps, confirm check-in times, and pack documents."
  },
  countdown_24h: {
    title: "24-hour countdown",
    body: "Your trip starts soon. Open Roamly for the travel timeline."
  },
  travel_day_started: {
    title: "Travel day started",
    body: "Roamly can show what is next, nearby, and already booked."
  }
};

type TestBooking = {
  id: string;
  booking_type: string;
  title: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  country: string | null;
  address: string | null;
};

function admin() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase service role is not configured.");
  return supabase;
}

function cityFallback(destination?: string | null, city?: string | null, country?: string | null): LocationInput {
  const text = [city, destination, country]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const known: Array<[RegExp, LocationInput]> = [
    [/toronto/, { latitude: 43.6532, longitude: -79.3832 }],
    [/vancouver/, { latitude: 49.2827, longitude: -123.1207 }],
    [/montreal/, { latitude: 45.5019, longitude: -73.5674 }],
    [/new york/, { latitude: 40.7128, longitude: -74.006 }],
    [/los angeles/, { latitude: 34.0522, longitude: -118.2437 }],
    [/london/, { latitude: 51.5072, longitude: -0.1276 }],
    [/paris/, { latitude: 48.8566, longitude: 2.3522 }],
    [/rome/, { latitude: 41.9028, longitude: 12.4964 }],
    [/barcelona/, { latitude: 41.3874, longitude: 2.1686 }],
    [/tokyo/, { latitude: 35.6762, longitude: 139.6503 }],
    [/seoul/, { latitude: 37.5665, longitude: 126.978 }],
    [/singapore/, { latitude: 1.3521, longitude: 103.8198 }]
  ];
  return known.find(([pattern]) => pattern.test(text))?.[1] || { latitude: 43.6532, longitude: -79.3832 };
}

async function getTrip(supabase: ReturnType<typeof admin>, tripId: string) {
  const { data, error } = await supabase.from("roamly_trips").select("*").eq("id", tripId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Trip not found.");
  return data as TrackingTrip;
}

async function getActivities(supabase: ReturnType<typeof admin>, tripId: string) {
  const { data, error } = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("trip_id", tripId)
    .not("status", "in", "(completed,skipped,missed)")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as TrackingActivity[];
}

async function getBookings(supabase: ReturnType<typeof admin>, tripId: string) {
  const { data, error } = await supabase.from("roamly_bookings").select("*").eq("trip_id", tripId);
  if (error) throw new Error(error.message);
  return (data || []) as TestBooking[];
}

async function ensureActivityCoordinates(
  supabase: ReturnType<typeof admin>,
  trip: TrackingTrip,
  activity: TrackingActivity | null
) {
  const destination = getTripDestinationLabel(trip);
  if (!activity) return cityFallback(destination, trip.destination_city, trip.destination_country);
  if (activity.latitude != null && activity.longitude != null) {
    return { latitude: activity.latitude, longitude: activity.longitude };
  }
  const fallback = cityFallback(destination, trip.destination_city, trip.destination_country);
  await supabase
    .from("roamly_activities")
    .update({
      latitude: fallback.latitude,
      longitude: fallback.longitude,
      metadata: {
        ...(activity.metadata || {}),
        testCoordinatesApplied: true
      }
    })
    .eq("id", activity.id);
  return fallback;
}

function nearestBooking(bookings: TestBooking[], location: LocationInput) {
  return bookings
    .filter((booking) => booking.latitude != null && booking.longitude != null)
    .map((booking) => ({
      ...booking,
      distanceMeters: calculateDistanceMeters(location.latitude, location.longitude, Number(booking.latitude), Number(booking.longitude))
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] || null;
}

async function locationForMode(
  supabase: ReturnType<typeof admin>,
  trip: TrackingTrip,
  mode: LiveTestLocationMode
) {
  const [activities, bookings] = await Promise.all([getActivities(supabase, trip.id), getBookings(supabase, trip.id)]);
  if (mode === "hotel") {
    const hotel = bookings.find((booking) => booking.booking_type === "hotel") || bookings[0] || null;
    if (hotel?.latitude != null && hotel.longitude != null) return { location: { latitude: hotel.latitude, longitude: hotel.longitude }, activities, bookings };
    return { location: cityFallback(getTripDestinationLabel(trip), hotel?.city || trip.destination_city, hotel?.country || trip.destination_country), activities, bookings };
  }
  if (mode === "next_activity") {
    const upNext = await getUpNextActivity(supabase, trip.id);
    return { location: await ensureActivityCoordinates(supabase, trip, upNext.activity || activities[0] || null), activities, bookings };
  }
  if (mode === "far_away") {
    const base = cityFallback(getTripDestinationLabel(trip), trip.destination_city, trip.destination_country);
    return { location: { latitude: Math.max(-85, base.latitude + 5), longitude: Math.max(-175, base.longitude + 5) }, activities, bookings };
  }
  return { location: await ensureActivityCoordinates(supabase, trip, activities[0] || null), activities, bookings };
}

export async function simulateTripLocation(
  tripId: string,
  mode: LiveTestLocationMode,
  decisionNow?: Date
) {
  const supabase = admin();
  const trip = await getTrip(supabase, tripId);
  const target = await locationForMode(supabase, trip, mode);

  // Snapshot real production evidence BEFORE the simulated GPS update.
  const before = await buildLiveCompanionDebugReport(tripId);

  const beforeCompanionIds = new Set(
    before.companionEvents.map((event) => String(event.id))
  );

  const beforeNotificationIds = new Set(
    before.notifications.map((notification) =>
      String(notification.id)
    )
  );

  /*
   * QA acts only as a virtual phone.
   *
   * It supplies GPS coordinates to the SAME production nearby
   * engine used by Live Companion.
   *
   * QA does NOT tell production which activity is nearby and
   * does NOT manufacture a notification or companion event.
   */
  const activation = await activateTripIfNearby(
    supabase,
    trip.user_id || "",
    target.location,
    trip.id,
    {
      simulated: true,
      source: "admin_live_test",
      decisionNow
    }
  );

  // Read what production actually created after processing GPS.
  const after = await buildLiveCompanionDebugReport(tripId);

  const newCompanionEvents = after.companionEvents.filter(
    (event) => !beforeCompanionIds.has(String(event.id))
  );

  const newNotifications = after.notifications.filter(
    (notification) =>
      !beforeNotificationIds.has(String(notification.id))
  );

  const booking = nearestBooking(
    target.bookings,
    target.location
  );

  const nearbyDetected =
    Boolean(activation.nearbyActivities?.length);

  const nearestActivity =
    activation.nearbyActivities?.[0] ||
    activation.upNextActivity ||
    null;

  /*
   * For the production nearby-location acceptance path, a generic
   * "shown" event is not sufficient evidence. It must be the real
   * nearby_activity event for the exact activity production discovered.
   *
   * tripActivation.ts creates this event only after the real push path
   * reports pushed.sent > 0.
   */
  const discoveredActivityId =
    activation.nearbyActivities?.[0]?.id || null;

  const shownCompanionEvent =
    newCompanionEvents.find(
      (event) =>
        String(event.status || "").toLowerCase() === "shown" &&
        String(event.event_type || "").toLowerCase() === "nearby_activity" &&
        Boolean(discoveredActivityId) &&
        String(event.metadata?.activityId || "") ===
          String(discoveredActivityId)
    ) || null;

  const productionNotification =
    newNotifications[0] || null;

  /*
   * Nearby GPS pushes intentionally use createNotification:false in
   * production, so a roamly_notifications row is not required.
   * The correlated shown nearby event is the production evidence that
   * the nearby push path reported at least one successful send.
   */
  const notificationCreated = Boolean(shownCompanionEvent);

  const pushSent = Boolean(shownCompanionEvent);

  const expectsNearby = mode !== "far_away";

  /*
   * PASS is based on production evidence.
   *
   * NEAR:
   * production must discover a nearby planned activity,
   * produce its notification and reach the shown/push state.
   *
   * FAR AWAY:
   * production must NOT falsely detect an activity or create
   * an unwanted nearby notification.
   */
  const endToEndPassed = expectsNearby
    ? nearbyDetected &&
      notificationCreated &&
      pushSent
    : !nearbyDetected &&
      newCompanionEvents.length === 0 &&
      newNotifications.length === 0;

  return {
    testType: "production_live_companion_location",
    simulatedInputOnly: true,

    simulatedLatitude: target.location.latitude,
    simulatedLongitude: target.location.longitude,

    productionEngine: "activateTripIfNearby",

    activitiesChecked:
      activation.checkedActivities?.length ??
      activation.nearbyActivities?.length ??
      null,

    nearestActivity,
    nearestBooking: booking,

    distanceMeters:
      activation.nearbyActivities?.[0]?.distance_meters ??
      booking?.distanceMeters ??
      null,

    nearbyDetected,

    tripActivated: activation.tripActivated,
    currentDay: activation.currentDay,

    nearbyActivities:
      activation.nearbyActivities || [],

    upNextActivity:
      activation.upNextActivity,

    notificationCreated,

    pushAttempted:
      notificationCreated || Boolean(shownCompanionEvent),

    pushStatus:
      shownCompanionEvent
        ? "sent"
        : notificationCreated
          ? "notification_created_but_no_shown_push_event"
          : "not_triggered",

    pushSent,

    companionEventCreated:
      newCompanionEvents.length > 0,

    shownCompanionEvent,
    productionNotification,

    newCompanionEvents,
    newNotifications,

    endToEndPassed,

    endToEndStatus:
      endToEndPassed ? "PASS" : "FAIL",

    expectedBehavior:
      expectsNearby
        ? "Production must discover the nearby planned activity and complete the real notification/push path."
        : "Production must detect that the traveler is outside all activity zones and must not send a nearby notification.",

    debug: after
  };
}

export async function simulateCompanionReminder(tripId: string, type: LiveTestReminderType) {
  const supabase = admin();
  const trip = await getTrip(supabase, tripId);
  const copy = reminderCopy[type];
  const now = new Date().toISOString();
  const event = await supabase
    .from("roamly_trip_companion_events")
    .insert({
      user_id: trip.user_id,
      trip_id: trip.id,
      event_type: type,
      title: copy.title,
      body: copy.body,
      scheduled_for: now,
      completed_at: now,
      status: "shown",
      metadata: { simulated: true, simulatedBy: "admin_live_test", source: "admin_live_test" }
    })
    .select("id")
    .maybeSingle();
  if (event.error) throw new Error(event.error.message);

  const notification = await createInAppNotification(supabase, {
    userId: trip.user_id || "",
    tripId,
    eventId: event.data?.id || null,
    type,
    title: copy.title,
    body: copy.body,
    actionUrl: `/trip/${tripId}/live`,
    metadata: { simulated: true, simulatedBy: "admin_live_test", source: "admin_live_test" }
  });

  return {
    eventId: event.data?.id || null,
    notificationId: notification.data?.id || null,
    notificationCreated: !notification.error,
    debug: await buildLiveCompanionDebugReport(tripId)
  };
}

export async function sendTestInAppNotification(tripId: string) {
  const supabase = admin();
  const trip = await getTrip(supabase, tripId);
  const notification = await createInAppNotification(supabase, {
    userId: trip.user_id || "",
    tripId,
    type: "test_notification",
    title: "Roamly test notification",
    body: "Admin live test created this in-app notification.",
    actionUrl: `/trip/${tripId}/live`,
    metadata: { simulated: true, simulatedBy: "admin_live_test", source: "admin_live_test" }
  });
  return {
    notificationCreated: !notification.error,
    notificationId: notification.data?.id || null,
    error: notification.error?.message || null,
    debug: await buildLiveCompanionDebugReport(tripId)
  };
}

export async function sendTestPushNotification(tripId: string) {
  const supabase = admin();
  const trip = await getTrip(supabase, tripId);
  const { count } = await supabase
    .from("roamly_push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", trip.user_id)
    .eq("enabled", true);
  const push = await sendPushNotification(supabase, trip.user_id || "", {
    tripId,
    type: "test_notification",
    title: "Roamly push test",
    body: "If push is enabled, this verifies the browser subscription.",
    actionUrl: `/trip/${tripId}/live`
  });
  return {
    pushAttempted: true,
    pushStatus: push.ok ? "sent" : count ? "failed" : "no_subscription",
    pushError: push.error || null,
    pushSent: "sent" in push ? push.sent : 0,
    pushFailed: "failed" in push ? push.failed : 0,
    notificationCreated: !push.notification?.error,
    message: count ? null : "No push subscription found. In-app notification was created.",
    debug: await buildLiveCompanionDebugReport(tripId)
  };
}

async function pickActivityForAction(supabase: ReturnType<typeof admin>, tripId: string, action: "check_in" | "skip" | "complete") {
  const statuses =
    action === "complete"
      ? ["checked_in", "nearby", "planned"]
      : action === "skip"
        ? ["nearby", "planned", "checked_in"]
        : ["nearby", "planned"];
  const { data, error } = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("trip_id", tripId)
    .in("status", statuses)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No eligible activity found for this simulation.");
  return data as TrackingActivity;
}

export async function simulateCheckIn(tripId: string) {
  const supabase = admin();
  const trip = await getTrip(supabase, tripId);
  const activity = await pickActivityForAction(supabase, tripId, "check_in");
  const location = await ensureActivityCoordinates(supabase, trip, activity);
  const result = await performActivityAction(supabase, {
    tripId,
    activityId: activity.id,
    action: "check_in",
    location,
    source: "admin_live_test",
    simulated: true,
    requireNearbyForCheckIn: false
  });
  return { ...result, debug: await buildLiveCompanionDebugReport(tripId) };
}

export async function simulateSkip(tripId: string) {
  const supabase = admin();
  const activity = await pickActivityForAction(supabase, tripId, "skip");
  const result = await performActivityAction(supabase, {
    tripId,
    activityId: activity.id,
    action: "skip",
    source: "admin_live_test",
    simulated: true
  });
  return { ...result, debug: await buildLiveCompanionDebugReport(tripId) };
}

export async function simulateComplete(tripId: string) {
  const supabase = admin();
  const activity = await pickActivityForAction(supabase, tripId, "complete");
  const result = await performActivityAction(supabase, {
    tripId,
    activityId: activity.id,
    action: "complete",
    source: "admin_live_test",
    simulated: true
  });
  return { ...result, debug: await buildLiveCompanionDebugReport(tripId) };
}

export async function runLiveCompanionLifecycleTest(tripId: string) {
  const supabase = admin();
  const trip = await getTrip(supabase, tripId);

  const tripMetadata =
    trip.metadata && typeof trip.metadata === "object"
      ? (trip.metadata as Record<string, unknown>)
      : {};

  if (tripMetadata.admin_test !== true) {
    throw new Error(
      "Lifecycle acceptance test refused: selected trip is not a controlled admin_test trip."
    );
  }

  if (!trip.itinerary_locked || !trip.tracking_unlocked) {
    throw new Error(
      "Lifecycle acceptance test refused: QA trip must have a locked itinerary and Live Companion unlocked."
    );
  }

  const { data: activities, error: activitiesError } = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("trip_id", tripId)
    .eq("metadata->>admin_test", "true")
    .order("scheduled_start", { ascending: true })
    .order("sort_order", { ascending: true });

  if (activitiesError) {
    throw new Error(`Unable to load QA activities: ${activitiesError.message}`);
  }

  const qaActivities = (activities || []) as TrackingActivity[];

  if (qaActivities.length < 2) {
    throw new Error(
      "Lifecycle acceptance test requires at least two controlled QA activities."
    );
  }

  const activityA = qaActivities[0];
  const expectedNext = qaActivities[1];

  if (
    activityA.latitude == null ||
    activityA.longitude == null ||
    !activityA.scheduled_end
  ) {
    throw new Error(
      "Lifecycle acceptance test requires Activity A coordinates and scheduled_end."
    );
  }

  const beforeEventsResult = await supabase
    .from("roamly_trip_companion_events")
    .select("id,event_type,status,metadata,created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (beforeEventsResult.error) {
    throw new Error(
      `Unable to read Companion evidence: ${beforeEventsResult.error.message}`
    );
  }

  const beforeEvents = beforeEventsResult.data || [];

  const initial = await simulateTripLocation(tripId, "first_activity");

  const afterInitialResult = await supabase
    .from("roamly_trip_companion_events")
    .select("id,event_type,status,metadata,created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (afterInitialResult.error) {
    throw new Error(
      `Unable to read post-detection Companion evidence: ${afterInitialResult.error.message}`
    );
  }

  const beforeIds = new Set(beforeEvents.map((event) => event.id));
  const initialNewEvents = (afterInitialResult.data || []).filter(
    (event) => !beforeIds.has(event.id)
  );

  const initialPushEvent =
    initialNewEvents.find(
      (event) =>
        String(event.event_type || "").toLowerCase() === "nearby_activity" &&
        String(event.status || "").toLowerCase() === "shown" &&
        String(event.metadata?.activityId || "") === String(activityA.id)
    ) || null;

  const detectedA =
    Boolean(initial.nearbyDetected) &&
    Array.isArray(initial.nearbyActivities) &&
    initial.nearbyActivities.some(
      (activity) => String(activity?.id || "") === String(activityA.id)
    );

  const realPushEvidence =
    Boolean(initial.pushSent) && Boolean(initialPushEvent);

  const idsAfterInitial = new Set(
    (afterInitialResult.data || []).map((event) => event.id)
  );

  // Repeat the exact same production GPS scenario.
  // A correct anti-spam implementation must not generate another equivalent
  // nearby_activity/shown event for Activity A.
  const repeated = await simulateTripLocation(tripId, "first_activity");

  const afterRepeatResult = await supabase
    .from("roamly_trip_companion_events")
    .select("id,event_type,status,metadata,created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (afterRepeatResult.error) {
    throw new Error(
      `Unable to read duplicate-suppression evidence: ${afterRepeatResult.error.message}`
    );
  }

  const repeatNewMatchingEvents = (afterRepeatResult.data || []).filter(
    (event) =>
      !idsAfterInitial.has(event.id) &&
      String(event.event_type || "").toLowerCase() === "nearby_activity" &&
      String(event.status || "").toLowerCase() === "shown" &&
      String(event.metadata?.activityId || "") === String(activityA.id)
  );

  const duplicateSuppressed = repeatNewMatchingEvents.length === 0;

  // QA-only inspection window.
  // Keep Activity A alive for three real minutes after the production push
  // so the tester can inspect/click the real notification actions.
  // This does NOT alter production itinerary timing or scheduled_end.
  const qaInspectionWindowMs = 30 * 1000;
  await new Promise((resolve) => setTimeout(resolve, qaInspectionWindowMs));

  // QA controls only the decision clock.
  // scheduled_end is real production-format itinerary data created by the
  // controlled admin seed. Production must perform the actual missed update.
  const expiryDecisionNow = new Date(
    new Date(activityA.scheduled_end).getTime() + 60 * 1000
  );

  if (Number.isNaN(expiryDecisionNow.getTime())) {
    throw new Error("Activity A scheduled_end is not a valid timestamp.");
  }

  const expiredRun = await simulateTripLocation(
    tripId,
    "first_activity",
    expiryDecisionNow
  );

  const afterExpiryActivityResult = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("id", activityA.id)
    .eq("trip_id", tripId)
    .single();

  if (afterExpiryActivityResult.error) {
    throw new Error(
      `Unable to verify Activity A expiry: ${afterExpiryActivityResult.error.message}`
    );
  }

  const activityAfterExpiry =
    afterExpiryActivityResult.data as TrackingActivity;

  const productionExpiredA = activityAfterExpiry.status === "missed";

  // Run production again at A's location after expiry.
  // A must stay terminal and must not become nearby again.
  const resurrectionRun = await simulateTripLocation(
    tripId,
    "first_activity",
    expiryDecisionNow
  );

  const finalActivityResult = await supabase
    .from("roamly_activities")
    .select("*")
    .eq("id", activityA.id)
    .eq("trip_id", tripId)
    .single();

  if (finalActivityResult.error) {
    throw new Error(
      `Unable to verify terminal Activity A state: ${finalActivityResult.error.message}`
    );
  }

  const finalActivity = finalActivityResult.data as TrackingActivity;
  const noResurrection = finalActivity.status === "missed";

  const productionNextId =
    resurrectionRun.upNextActivity?.id ||
    expiredRun.upNextActivity?.id ||
    null;

  const advancedToB =
    Boolean(productionNextId) &&
    String(productionNextId) === String(expectedNext.id);

  const passed =
    detectedA &&
    realPushEvidence &&
    duplicateSuppressed &&
    productionExpiredA &&
    noResurrection &&
    advancedToB;

  return {
    passed,
    verdict: passed
      ? "PASS"
      : "FAIL",
    test: "production_live_companion_lifecycle",
    tripId,
    activityA: {
      id: activityA.id,
      title: activityA.title,
      scheduledStart: activityA.scheduled_start,
      scheduledEnd: activityA.scheduled_end
    },
    expectedNextActivity: {
      id: expectedNext.id,
      title: expectedNext.title
    },
    stages: {
      entitlementReady: true,
      activityADetected: detectedA,
      realPushEvidence,
      duplicateSuppressed,
      productionExpiredActivityA: productionExpiredA,
      activityAStayedRetired: noResurrection,
      productionAdvancedToActivityB: advancedToB
    },
    evidence: {
      initial,
      repeated,
      expiredRun,
      resurrectionRun,
      initialPushEvent,
      repeatDuplicateEvents: repeatNewMatchingEvents,
      finalActivityAStatus: finalActivity.status,
      productionNextActivityId: productionNextId
    },
    debug: await buildLiveCompanionDebugReport(tripId)
  };
}

export async function buildLiveCompanionDebugReport(tripId: string) {
  const supabase = admin();
  const [tripEvents, companionEvents, notifications, pushSubscriptions, locationSettings] = await Promise.all([
    supabase
      .from("roamly_trip_events")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("roamly_trip_companion_events")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("roamly_notifications")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase.from("roamly_push_subscriptions").select("id,user_id,enabled,user_agent,created_at,updated_at").limit(12),
    supabase.from("roamly_location_settings").select("*").order("updated_at", { ascending: false }).limit(12)
  ]);

  return {
    tripEvents: tripEvents.data || [],
    companionEvents: companionEvents.data || [],
    notifications: notifications.data || [],
    pushSubscriptions: pushSubscriptions.data || [],
    locationSettings: locationSettings.data || [],
    errors: [tripEvents.error, companionEvents.error, notifications.error, pushSubscriptions.error, locationSettings.error]
      .map((error) => error?.message)
      .filter(Boolean)
  };
}
