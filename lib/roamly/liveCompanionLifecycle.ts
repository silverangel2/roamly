import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCompanionPreferences } from "@/lib/roamly/companionPreferences";
import {
  activityEndDate,
  activityStartDate,
  isTodayWithinTripDates,
  timezoneFromTripMetadata,
  tripWindowState,
  type LiveCompanionActivity
} from "@/lib/roamly/liveCompanion";
import {
  liveCompanionNotificationIdentity,
  queueCompanionNotification,
  sendCompanionNotificationDelivery
} from "@/lib/roamly/companionNotifications";
import type { TrackingActivity, TrackingTrip } from "@/lib/roamly/tripActivation";

type LifecycleActivity = Pick<TrackingActivity, "id" | "title" | "scheduled_start" | "scheduled_end" | "sort_order" | "status" | "description" | "address" | "city" | "region" | "country" | "latitude" | "longitude" | "radius_meters">;

function storedPlaceLabel(activity: LifecycleActivity) {
  return [activity.address, activity.city, activity.region, activity.country]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean)
    .join(", ");
}

function liveActivity(activity: LifecycleActivity): LiveCompanionActivity {
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

function chronology(a: LifecycleActivity, b: LifecycleActivity) {
  const aStart = a.scheduled_start ? Date.parse(a.scheduled_start) : Number.MAX_SAFE_INTEGER;
  const bStart = b.scheduled_start ? Date.parse(b.scheduled_start) : Number.MAX_SAFE_INTEGER;
  return (Number.isFinite(aStart) ? aStart : Number.MAX_SAFE_INTEGER) -
    (Number.isFinite(bStart) ? bStart : Number.MAX_SAFE_INTEGER) ||
    a.sort_order - b.sort_order;
}

const unresolvedStatuses = ["planned", "nearby"] as const;

async function expireActivities(admin: SupabaseClient, trip: TrackingTrip, activities: LifecycleActivity[], timezone: string, now: Date) {
  const expired = activities.filter((activity) => {
    const end = activityEndDate({ activity: liveActivity(activity), tripStartDate: trip.start_date, timezone });
    return end && end.getTime() <= now.getTime();
  });
  if (!expired.length) return 0;

  const ids = expired.map((activity) => activity.id);
  await admin
    .from("roamly_activities")
    .update({ status: "missed", completed_at: now.toISOString() })
    .eq("trip_id", trip.id)
    .in("id", ids)
    .in("status", unresolvedStatuses);
  return expired.length;
}

async function processTrip(admin: SupabaseClient, trip: TrackingTrip, now: Date) {
  if (!trip.user_id) return { expired: 0, started: 0, skipped: "missing_user" };
  const timezone = timezoneFromTripMetadata(trip.metadata);
  const window = tripWindowState({ startDate: trip.start_date, endDate: trip.end_date, timezone, now });

  if (window === "completed_trip") {
    await admin.from("roamly_trips").update({ status: trip.status === "cancelled" ? "cancelled" : "completed", trip_companion_status: "completed" }).eq("id", trip.id).eq("user_id", trip.user_id);
    return { expired: 0, started: 0, skipped: "trip_end" };
  }
  if (window !== "active" || !isTodayWithinTripDates({ startDate: trip.start_date, endDate: trip.end_date, timezone, now })) {
    return { expired: 0, started: 0, skipped: "outside_trip_window" };
  }

  const preferences = await getCompanionPreferences({ supabase: admin, userId: trip.user_id, tripId: trip.id });
  if (!preferences.liveCompanionEnabled || (preferences.liveCompanionPausedUntil && Date.parse(preferences.liveCompanionPausedUntil) > now.getTime())) {
    return { expired: 0, started: 0, skipped: "disabled_or_paused" };
  }

  const activitiesResult = await admin.from("roamly_activities").select("*").eq("trip_id", trip.id).in("status", unresolvedStatuses);
  if (activitiesResult.error) throw new Error(activitiesResult.error.message);
  const activities = ((activitiesResult.data || []) as LifecycleActivity[]).sort(chronology);
  const expired = await expireActivities(admin, trip, activities, timezone, now);

  // Re-read after expiry so chronology advances in the same lifecycle run.
  const remainingResult = await admin.from("roamly_activities").select("*").eq("trip_id", trip.id).in("status", unresolvedStatuses);
  if (remainingResult.error) throw new Error(remainingResult.error.message);
  const current = ((remainingResult.data || []) as LifecycleActivity[]).sort(chronology)[0];
  if (!current) return { expired, started: 0, skipped: "no_unresolved_activity" };

  const start = activityStartDate({ activity: liveActivity(current), tripStartDate: trip.start_date, timezone });
  const identity = liveCompanionNotificationIdentity({ userId: trip.user_id, tripId: trip.id, activityId: current.id, eventType: "next_activity" });

  await admin.from("roamly_trips").update({
    status: "active",
    activated_at: trip.activated_at || now.toISOString(),
    trip_companion_status: "active"
  }).eq("id", trip.id).eq("user_id", trip.user_id).in("status", ["locked", "planned", "active"]);

  if (start && start.getTime() > now.getTime()) {
    const countdownMinutes = Math.max(1, Math.round((start.getTime() - now.getTime()) / 60_000));
    if (countdownMinutes <= 30) {
      const placeLabel = storedPlaceLabel(current);
      const locationLabel = placeLabel || (current.latitude != null && current.longitude != null
        ? `${current.latitude}, ${current.longitude}`
        : "");
      const queued = await queueCompanionNotification({
        supabase: admin,
        userId: trip.user_id,
        tripId: trip.id,
        type: "next_activity",
        priority: "routine",
        title: `Starting soon: ${current.title}`,
        body: locationLabel
          ? `📍 ${locationLabel} · starts in ${countdownMinutes} min. Tap to open directions.`
          : `Starts in ${countdownMinutes} min. Tap to open directions.`,
        actionUrl: `/trip/${trip.id}/live?activity=${encodeURIComponent(current.id)}`,
        scheduledFor: now.toISOString(),
        metadata: {
          activityId: current.id,
          send_email: false,
          source: "server_time_lifecycle",
          notificationReason: "activity_starting_soon",
          countdownMinutes,
          locationLabel: placeLabel || null,
          latitude: current.latitude,
          longitude: current.longitude
        },
        idempotencyKey: identity,
        dedupeParts: [identity]
      });
      if (!queued.ok || !queued.delivery?.id) return { expired, started: 0, skipped: queued.error || "queue_failed" };
      const pushed = queued.deduplicated ? { ok: true } : await sendCompanionNotificationDelivery(queued.delivery.id);
      return { expired, started: 0, upcoming: pushed.ok ? 1 : 0, skipped: queued.deduplicated ? "already_delivered_or_queued" : undefined };
    }
    return { expired, started: 0, skipped: "upcoming" };
  }

  const startIdentity = liveCompanionNotificationIdentity({ userId: trip.user_id, tripId: trip.id, activityId: current.id, eventType: "activity_start" });
  const queued = await queueCompanionNotification({
    supabase: admin,
    userId: trip.user_id,
    tripId: trip.id,
    type: "activity_start",
    priority: "important",
    title: `Now: ${current.title}`,
    body: "Your scheduled activity starts now.",
    actionUrl: `/trip/${trip.id}/live?activity=${encodeURIComponent(current.id)}`,
    scheduledFor: now.toISOString(),
    metadata: { activityId: current.id, send_email: false, source: "server_time_lifecycle" },
    idempotencyKey: startIdentity,
    dedupeParts: [startIdentity]
  });
  if (!queued.ok || !queued.delivery?.id) return { expired, started: 0, skipped: queued.error || "queue_failed" };
  const pushed = queued.deduplicated ? { ok: true } : await sendCompanionNotificationDelivery(queued.delivery.id);
  return { expired, started: pushed.ok && !queued.deduplicated ? 1 : 0, skipped: queued.deduplicated ? "already_delivered_or_queued" : undefined };
}

export async function processLiveCompanionTimeLifecycle(params: { now?: Date; limit?: number } = {}) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false as const, error: "Supabase service role is not configured." };
  const now = params.now || new Date();
  const tripsResult = await admin.from("roamly_trips").select("*").eq("itinerary_locked", true).or("tracking_unlocked.eq.true,live_companion_unlocked.eq.true").in("status", ["locked", "active", "planned"]).order("start_date", { ascending: true, nullsFirst: false }).limit(Math.max(1, Math.min(params.limit || 100, 500)));
  if (tripsResult.error) return { ok: false as const, error: tripsResult.error.message };
  const results = [];
  for (const trip of (tripsResult.data || []) as TrackingTrip[]) {
    try {
      results.push({ tripId: trip.id, result: await processTrip(admin, trip, now) });
    } catch (error) {
      results.push({ tripId: trip.id, result: { expired: 0, started: 0, error: error instanceof Error ? error.message : "Lifecycle processing failed." } });
    }
  }
  return { ok: true as const, processed: results.length, results };
}

export async function processLiveCompanionTimeLifecycleForTrip(tripId: string, userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false as const, error: "Supabase service role is not configured." };
  const tripResult = await admin
    .from("roamly_trips")
    .select("*")
    .eq("id", tripId)
    .eq("user_id", userId)
    .eq("itinerary_locked", true)
    .or("tracking_unlocked.eq.true,live_companion_unlocked.eq.true")
    .in("status", ["locked", "active", "planned"])
    .maybeSingle();
  if (tripResult.error) return { ok: false as const, error: tripResult.error.message };
  if (!tripResult.data) return { ok: true as const, processed: 0, result: { skipped: "trip_not_eligible" } };
  try {
    return { ok: true as const, processed: 1, result: await processTrip(admin, tripResult.data as TrackingTrip, new Date()) };
  } catch (error) {
    return { ok: false as const, processed: 1, error: error instanceof Error ? error.message : "Lifecycle processing failed." };
  }
}
