import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCompanionPreferences } from "@/lib/roamly/companionPreferences";
import {
  activityEndDate,
  activityStartDate,
  isTodayWithinTripDates,
  tripWindowState,
  type LiveCompanionActivity
} from "@/lib/roamly/liveCompanion";
import {
  BACKGROUND_TIMEZONE_HOLD,
  resolveBackgroundTripTimezone
} from "@/lib/roamly/backgroundNotificationTimezone";
import {
  liveCompanionNotificationIdentity,
  queueCompanionNotification,
  sendCompanionNotificationDelivery
} from "@/lib/roamly/companionNotifications";
import { scheduleCompanionEvents } from "@/lib/roamly/tripCompanion";
import type { TrackingActivity, TrackingTrip } from "@/lib/roamly/tripActivation";
// L12 (2026-10-31): the status sets in this file include "generated"
// — the ONE live-ready set in lib/roamly/liveEligibility.ts
// (locked/active/planned/generated). This cron previously processed
// only locked/active/planned, so a generated+locked+unlocked trip
// (the production Montreal shape) never entered the time lifecycle
// even though its window already resolved destination-locally here
// via resolveBackgroundTripTimezone (hold-on-unknown preserved).
import { clearLastLocationIfNoOperationalTrip } from "@/lib/roamly/locationLifecycle";
import { anyWorkPresent, countWorkRows } from "@/lib/roamly/workGate";

/**
 * EGRESS DIET (2026-11-02, F2/F4) — column projections for this lane.
 * The trip scan used to select("*") on every locked trip every five
 * minutes, and each in-window trip's activities were read twice with
 * select("*"). These lists are exactly the fields processTrip and
 * its helpers consume (TrackingTrip / LifecycleActivity shapes).
 */
const LIFECYCLE_TRIP_COLUMNS =
  "id,user_id,title,destination,destination_name,destination_country,destination_region,destination_city,start_date,end_date,status,activated_at,itinerary_status,itinerary_locked,itinerary_generated_at,tracking_unlocked,live_companion_unlocked,trip_companion_status,metadata";
const LIFECYCLE_ACTIVITY_COLUMNS =
  "id,title,scheduled_start,scheduled_end,sort_order,status,description,address,city,region,country,latitude,longitude,radius_meters";

/**
 * EGRESS DIET (F2) — the work gate's broad date superset. Destination
 * timezones span UTC-12…UTC+14, so a trip whose window contains
 * "today" anywhere on Earth has start_date <= UTC today + 2 days and
 * end_date >= UTC today - 2 days (or no end_date). The gate only
 * decides "possibly work"; per-trip eligibility is still decided by
 * the unchanged tripWindowState logic below — no second window rule.
 */
export function liveCompanionGateWindow(now: Date) {
  const dayMs = 24 * 60 * 60 * 1000;
  return {
    earliestEnd: new Date(now.getTime() - 2 * dayMs).toISOString().slice(0, 10),
    latestStart: new Date(now.getTime() + 2 * dayMs).toISOString().slice(0, 10)
  };
}

export async function countLiveCompanionCandidateTrips(
  admin: SupabaseClient,
  now: Date
): Promise<number | null> {
  const { earliestEnd, latestStart } = liveCompanionGateWindow(now);
  return countWorkRows(admin, "roamly_trips", (query) =>
    query
      .eq("itinerary_locked", true)
      .or("tracking_unlocked.eq.true,live_companion_unlocked.eq.true")
      .in("status", ["locked", "active", "planned", "generated"])
      .not("start_date", "is", null)
      .lte("start_date", latestStart)
      .or(`end_date.is.null,end_date.gte.${earliestEnd}`)
  );
}

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
export const LIVE_COMPANION_PROCESSING_PAGE_SIZE = 100;

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
  // Notification-timezone round (2026-10-27): the lifecycle window
  // uses the SAME resolution as Live/Alerts (the trip row carries its
  // destination columns). An unknown zone HOLDS the trip: no window
  // completion, no activity expiry, no notification is computed from
  // a guessed UTC — the hold is recorded in the cron result.
  const resolution = resolveBackgroundTripTimezone(trip);
  if (!resolution.zone) return { expired: 0, started: 0, skipped: BACKGROUND_TIMEZONE_HOLD };
  const timezone = resolution.zone;
  const window = tripWindowState({ startDate: trip.start_date, endDate: trip.end_date, timezone, now });

  if (window === "completed_trip") {
    await admin.from("roamly_trips").update({ status: trip.status === "cancelled" ? "cancelled" : "completed", trip_companion_status: "completed" }).eq("id", trip.id).eq("user_id", trip.user_id);
    await clearLastLocationIfNoOperationalTrip(admin, trip.user_id);
    return { expired: 0, started: 0, skipped: "trip_end" };
  }
  if (window !== "active" || !isTodayWithinTripDates({ startDate: trip.start_date, endDate: trip.end_date, timezone, now })) {
    return { expired: 0, started: 0, skipped: "outside_trip_window" };
  }

  const preferences = await getCompanionPreferences({ supabase: admin, userId: trip.user_id, tripId: trip.id });
  if (!preferences.liveCompanionEnabled || (preferences.liveCompanionPausedUntil && Date.parse(preferences.liveCompanionPausedUntil) > now.getTime())) {
    return { expired: 0, started: 0, skipped: "disabled_or_paused" };
  }

  // During-trip companion scheduling (2026-11-11): the scheduled
  // companion events (roamly_trip_companion_events) used to be
  // created ONLY as a side effect of traveller actions — unlock,
  // booking confirm, a Live-page visit — so a trip already inside
  // its window whose setup batch lacked a day (or predated per-day
  // coverage) never gained that day's events: no server process
  // reconciled the schedule during the trip, and the companion had
  // nothing to fire on the very days it exists for (proven on
  // production 2026-11-06; reproduced 2026-11-11). This sweep
  // already visits exactly the in-window, unlocked, enabled trips,
  // so it now runs the same reconcile the Live page performs on
  // visit. The reconcile is idempotent — live rows dedupe by event
  // key, elapsed days become honest skipped bookkeeping — and
  // delivery stays with the notifications dispatcher and its
  // gates. Failure isolation: a scheduling fault must never take
  // down this trip's activity processing; scheduling records its
  // own failures (roamly_app_events) and the call is isolated here
  // as well. The return value is deliberately not surfaced, like
  // the booking-confirm caller: scheduling health is observed
  // through the app-events channel, not the lifecycle result.
  try {
    await scheduleCompanionEvents(admin, trip.id);
  } catch {
    // Isolated per the note above.
  }

  const activitiesResult = await admin.from("roamly_activities").select(LIFECYCLE_ACTIVITY_COLUMNS).eq("trip_id", trip.id).in("status", unresolvedStatuses);
  if (activitiesResult.error) throw new Error(activitiesResult.error.message);
  const activities = ((activitiesResult.data || []) as LifecycleActivity[]).sort(chronology);
  const expired = await expireActivities(admin, trip, activities, timezone, now);

  // EGRESS DIET (F4): the second read exists only to advance
  // chronology after expiry mutated statuses. When nothing expired
  // no write happened, so the first read's head IS the current
  // activity — re-read only when expired > 0.
  let current = activities[0];
  if (expired > 0) {
    const remainingResult = await admin.from("roamly_activities").select(LIFECYCLE_ACTIVITY_COLUMNS).eq("trip_id", trip.id).in("status", unresolvedStatuses);
    if (remainingResult.error) throw new Error(remainingResult.error.message);
    current = ((remainingResult.data || []) as LifecycleActivity[]).sort(chronology)[0];
  }
  if (!current) return { expired, started: 0, skipped: "no_unresolved_activity" };

  const start = activityStartDate({ activity: liveActivity(current), tripStartDate: trip.start_date, timezone });
  const identity = liveCompanionNotificationIdentity({ userId: trip.user_id, tripId: trip.id, activityId: current.id, eventType: "next_activity" });

  await admin.from("roamly_trips").update({
    status: "active",
    activated_at: trip.activated_at || now.toISOString(),
    trip_companion_status: "active"
  }).eq("id", trip.id).eq("user_id", trip.user_id).in("status", ["locked", "planned", "active", "generated"]);

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

export async function processLiveCompanionTimeLifecycle(params: { now?: Date; admin?: SupabaseClient } = {}) {
  const admin = params.admin || createSupabaseAdminClient();
  if (!admin) return { ok: false as const, error: "Supabase service role is not configured." };
  const now = params.now || new Date();
  // EGRESS DIET (F2): work gate — one head/count over the candidate
  // predicate. Zero candidates in any possible window means zero
  // work: exit before the paged scan. A failed count fails OPEN
  // (countWorkRows returns null → anyWorkPresent treats it as work).
  const candidateCount = await countLiveCompanionCandidateTrips(admin, now);
  if (!anyWorkPresent([candidateCount])) {
    return { ok: true as const, processed: 0, results: [], gated: true as const };
  }
  const results = [];
  const pageSize = LIVE_COMPANION_PROCESSING_PAGE_SIZE;
  let cursor: { startDate: string; id: string } | null = null;

  for (;;) {
    const query = admin
      .from("roamly_trips")
      .select(LIFECYCLE_TRIP_COLUMNS)
      .not("start_date", "is", null)
      .eq("itinerary_locked", true)
      .or(cursor
        ? `and(or(tracking_unlocked.eq.true,live_companion_unlocked.eq.true),or(start_date.gt.${cursor.startDate},and(start_date.eq.${cursor.startDate},id.gt.${cursor.id})))`
        : "tracking_unlocked.eq.true,live_companion_unlocked.eq.true")
      .in("status", ["locked", "active", "planned", "generated"])
      .order("start_date", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(0, pageSize - 1);

    const tripsResult = await query;
    if (tripsResult.error) return { ok: false as const, error: tripsResult.error.message, processed: results.length, results };
    const page = (tripsResult.data || []) as TrackingTrip[];
    if (!page.length) break;
    for (const trip of page) {
      try {
        results.push({ tripId: trip.id, result: await processTrip(admin, trip, now) });
      } catch (error) {
        results.push({ tripId: trip.id, result: { expired: 0, started: 0, error: error instanceof Error ? error.message : "Lifecycle processing failed." } });
      }
    }

    const last = page[page.length - 1];
    if (!last.start_date || !last.id || (cursor && cursor.startDate === last.start_date && cursor.id === last.id)) {
      return { ok: false as const, error: "Live Companion lifecycle pagination cursor did not advance.", processed: results.length, results };
    }
    cursor = { startDate: last.start_date, id: last.id };
    if (page.length < pageSize) break;
  }
  return { ok: true as const, processed: results.length, results };
}

export async function processLiveCompanionTimeLifecycleForTrip(tripId: string, userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false as const, error: "Supabase service role is not configured." };
  const tripResult = await admin
    .from("roamly_trips")
    .select(LIFECYCLE_TRIP_COLUMNS)
    .eq("id", tripId)
    .eq("user_id", userId)
    .eq("itinerary_locked", true)
    .or("tracking_unlocked.eq.true,live_companion_unlocked.eq.true")
    .in("status", ["locked", "active", "planned", "generated"])
    .maybeSingle();
  if (tripResult.error) return { ok: false as const, error: tripResult.error.message };
  if (!tripResult.data) return { ok: true as const, processed: 0, result: { skipped: "trip_not_eligible" } };
  try {
    return { ok: true as const, processed: 1, result: await processTrip(admin, tripResult.data as TrackingTrip, new Date()) };
  } catch (error) {
    return { ok: false as const, processed: 1, error: error instanceof Error ? error.message : "Lifecycle processing failed." };
  }
}
