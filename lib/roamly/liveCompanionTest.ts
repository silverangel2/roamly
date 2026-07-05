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
  const text = [city, destination, country].filter(Boolean).join(" ").toLowerCase();
  const known: Array<[RegExp, LocationInput]> = [
    [/toronto/, { latitude: 43.6532, longitude: -79.3832 }],
    [/vancouver/, { latitude: 49.2827, longitude: -123.1207 }],
    [/montreal|montr[eé]al/, { latitude: 45.5019, longitude: -73.5674 }],
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
  if (!activity) return cityFallback(trip.destination, trip.destination_city, trip.destination_country);
  if (activity.latitude != null && activity.longitude != null) {
    return { latitude: activity.latitude, longitude: activity.longitude };
  }
  const fallback = cityFallback(trip.destination, trip.destination_city, trip.destination_country);
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
    return { location: cityFallback(trip.destination, hotel?.city || trip.destination_city, hotel?.country || trip.destination_country), activities, bookings };
  }
  if (mode === "next_activity") {
    const upNext = await getUpNextActivity(supabase, trip.id);
    return { location: await ensureActivityCoordinates(supabase, trip, upNext.activity || activities[0] || null), activities, bookings };
  }
  if (mode === "far_away") {
    const base = cityFallback(trip.destination, trip.destination_city, trip.destination_country);
    return { location: { latitude: Math.max(-85, base.latitude + 5), longitude: Math.max(-175, base.longitude + 5) }, activities, bookings };
  }
  return { location: await ensureActivityCoordinates(supabase, trip, activities[0] || null), activities, bookings };
}

export async function simulateTripLocation(tripId: string, mode: LiveTestLocationMode) {
  const supabase = admin();
  const trip = await getTrip(supabase, tripId);
  const target = await locationForMode(supabase, trip, mode);
  await supabase.from("roamly_location_settings").upsert(
    {
      user_id: trip.user_id,
      location_tracking_enabled: true,
      notification_enabled: true,
      last_permission_state: "granted",
      last_seen_latitude: target.location.latitude,
      last_seen_longitude: target.location.longitude,
      last_seen_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );

  const activation = await activateTripIfNearby(supabase, trip.user_id || "", target.location, trip.id);
  const booking = nearestBooking(target.bookings, target.location);
  const debug = await buildLiveCompanionDebugReport(tripId);

  return {
    simulatedLatitude: target.location.latitude,
    simulatedLongitude: target.location.longitude,
    nearestActivity: activation.nearbyActivities?.[0] || activation.upNextActivity || null,
    nearestBooking: booking,
    distanceMeters: activation.nearbyActivities?.[0]?.distance_meters ?? booking?.distanceMeters ?? null,
    tripActivated: activation.tripActivated,
    currentDay: activation.currentDay,
    nearbyActivities: activation.nearbyActivities || [],
    upNextActivity: activation.upNextActivity,
    notificationCreated: Boolean(activation.notificationCreated || activation.notification),
    pushAttempted: false,
    pushStatus: "not_attempted",
    createdEvents: debug.tripEvents.slice(0, 5),
    debug
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
      metadata: { simulatedBy: "admin_live_test" }
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
    metadata: { simulatedBy: "admin_live_test" }
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
    metadata: { simulatedBy: "admin_live_test" }
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
    source: "admin_live_test"
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
    source: "admin_live_test"
  });
  return { ...result, debug: await buildLiveCompanionDebugReport(tripId) };
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
