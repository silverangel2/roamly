import type { SupabaseClient } from "@supabase/supabase-js";
import { tripWindowState, timezoneFromTripMetadata } from "@/lib/roamly/liveCompanion";
import { getCompanionPreferences } from "@/lib/roamly/companionPreferences";
import { resolveRoamlySelectedTrip } from "@/lib/roamly/selectedTrip";

/*
 * Live status read-back — the ONE server source for two facts the
 * surfaces used to guess (2026-10-31, closure findings L5/L9):
 *
 *  1. Notification subscription: subscribed / not subscribed, READ
 *     BACK from roamly_push_subscriptions for this user (enabled rows
 *     only; a row tied to a different trip does not count for this
 *     trip, and a row belonging to a different user never counts).
 *     It is NEVER inferred from PWA install state ("Installed ✓" is
 *     not a subscription — the owner's account showed Installed with
 *     zero subscription rows and his only notification died as
 *     no_subscription) and never from client pushManager state alone.
 *
 *  2. Live Companion activation for the selected trip: armed / not
 *     armed + the specific unmet condition. Reasons reuse the server's
 *     EXISTING strings verbatim wherever the code already names the
 *     condition (scheduleCompanionEvents' unlock refusal,
 *     evaluateLiveCompanionActivation's window / permission /
 *     disabled / paused reasons, requireTripLockedForTracking's lock
 *     message). Only conditions with no existing label get a new
 *     short plain label (no-trip, location switch off).
 *
 * Consumers: GET /api/roamly/live-status, lib/roamly/setupState.ts
 * (the setup cascade's alerts read-back), the setup completion route
 * (the alerts step), the Live page, and the setup Live/location step.
 * Nothing here writes anything.
 */

/** Existing string: pushServer's no-subscription outcome, reused as
 *  the read-back's not-subscribed reason (and the alerts step's
 *  completion refusal) so every surface names the same fact the same
 *  way. */
export const NO_PUSH_SUBSCRIPTION_REASON = "No push subscription found.";

export type PushSubscriptionStatus = {
  subscribed: boolean;
  /** Enabled rows counted for this user (and trip, when one is named). */
  subscriptionCount: number;
  /** Null when subscribed; the server's own reason when not. */
  reason: string | null;
};

export type LiveActivationStatus =
  | "active"
  | "no_trip"
  | "not_locked"
  | "not_unlocked"
  | "disabled"
  | "paused"
  | "future_trip"
  | "completed_trip"
  | "missing_dates"
  | "permission_required"
  | "location_off";

export type LiveActivation = {
  armed: boolean;
  status: LiveActivationStatus;
  /** The server's existing reason string for the unmet condition,
   *  or the ready line when armed. */
  reason: string;
};

export type LiveStatusReadback = {
  tripId: string | null;
  notifications: PushSubscriptionStatus;
  live: LiveActivation;
};

type PushSubscriptionRow = {
  id?: string;
  trip_id?: string | null;
  enabled?: boolean | null;
};

/**
 * Pure read-back over already-fetched subscription rows: an enabled
 * row counts when it belongs to this user (the caller fetches by
 * user_id) and is either account-level (trip_id null) or tied to the
 * named trip. Disabled rows never count — the dispatcher only sends
 * to enabled rows.
 */
export function pushSubscriptionStatusFromRows(
  rows: readonly PushSubscriptionRow[],
  tripId?: string | null
): PushSubscriptionStatus {
  const counted = rows.filter(
    (row) =>
      row.enabled === true &&
      (!tripId || row.trip_id == null || row.trip_id === tripId)
  );
  return counted.length
    ? { subscribed: true, subscriptionCount: counted.length, reason: null }
    : { subscribed: false, subscriptionCount: 0, reason: NO_PUSH_SUBSCRIPTION_REASON };
}

export async function readPushSubscriptionStatus(
  supabase: SupabaseClient,
  userId: string,
  tripId?: string | null
): Promise<PushSubscriptionStatus> {
  const { data, error } = await supabase
    .from("roamly_push_subscriptions")
    .select("id,trip_id,enabled")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (error) {
    // A failed read proves nothing: report not subscribed with the
    // same reason rather than guessing from any client-side state.
    return { subscribed: false, subscriptionCount: 0, reason: NO_PUSH_SUBSCRIPTION_REASON };
  }
  return pushSubscriptionStatusFromRows((data || []) as PushSubscriptionRow[], tripId);
}

export type LiveActivationTrip = {
  status?: string | null;
  itinerary_locked?: boolean | null;
  itinerary_status?: string | null;
  itinerary_generated_at?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
  metadata?: unknown;
};

/**
 * Pure activation mapping, in the server's own check order:
 * itinerary lock (requireTripLockedForTracking) → companion unlock
 * (scheduleCompanionEvents) → companion switch / pause
 * (evaluateLiveCompanionActivation) → trip window (tripWindowState)
 * → location grant → location switch. `now` is injectable so the
 * mapping is deterministic under any process timezone: the window is
 * computed in the trip's own metadata timezone, exactly as
 * selectActiveTrip computes it.
 */
export function deriveLiveActivation(params: {
  trip: LiveActivationTrip | null;
  locationPermission?: string | null;
  locationEnabled?: boolean | null;
  companionEnabled?: boolean;
  companionPausedUntil?: string | null;
  now?: string | Date;
}): LiveActivation {
  const { trip } = params;
  if (!trip) {
    return { armed: false, status: "no_trip", reason: "No trip is selected yet." };
  }
  // lib/roamly/billing isTripLocked, inlined to keep this module's
  // import chain light (the predicate is one line, duplicated the
  // same way in tripActivation's queries).
  const locked = Boolean(
    trip.itinerary_locked || trip.itinerary_status === "locked" || trip.itinerary_generated_at
  );
  if (!locked) {
    return {
      armed: false,
      status: "not_locked",
      reason: "Generate and lock this itinerary before adding Live Trip Companion."
    };
  }
  // tripCompanion.tripHasLiveCompanionUnlock, inlined for the same reason.
  if (!trip.tracking_unlocked && !trip.live_companion_unlocked) {
    return {
      armed: false,
      status: "not_unlocked",
      reason: "Live Trip Companion is not unlocked for this trip."
    };
  }
  if (params.companionEnabled === false) {
    return { armed: false, status: "disabled", reason: "Live Companion is disabled." };
  }
  const now = params.now ? new Date(params.now) : new Date();
  const pausedUntil = params.companionPausedUntil ? new Date(params.companionPausedUntil) : null;
  if (pausedUntil && Number.isFinite(pausedUntil.getTime()) && pausedUntil.getTime() > now.getTime()) {
    return { armed: false, status: "paused", reason: "Live Companion is paused." };
  }
  const window = tripWindowState({
    startDate: trip.start_date,
    endDate: trip.end_date,
    timezone: timezoneFromTripMetadata(trip.metadata),
    now
  });
  if (window === "future_trip") {
    return { armed: false, status: "future_trip", reason: "Trip has not started yet." };
  }
  if (window === "completed_trip") {
    return { armed: false, status: "completed_trip", reason: "Trip is already complete." };
  }
  if (window !== "active") {
    return {
      armed: false,
      status: "missing_dates",
      reason: "Trip dates are required before Live Companion can activate."
    };
  }
  if (params.locationPermission !== "granted") {
    return {
      armed: false,
      status: "permission_required",
      reason: "Location permission is required for live activation."
    };
  }
  if (params.locationEnabled === false) {
    return { armed: false, status: "location_off", reason: "Location is off." };
  }
  return { armed: true, status: "active", reason: "Live Trip Companion is ready for this trip." };
}

const TRIP_FIELDS =
  "id,status,itinerary_locked,itinerary_status,itinerary_generated_at,tracking_unlocked,live_companion_unlocked,start_date,end_date,metadata";

/**
 * The read-back itself: subscription rows + the selected trip's
 * activation facts, read fresh from the server's tables. With no
 * tripId, the selected trip is the ONE shared resolver's answer over
 * the account's open trips (lib/roamly/selectedTrip.ts).
 */
export async function getLiveStatusReadback(
  supabase: SupabaseClient,
  userId: string,
  options: { tripId?: string | null; now?: string | Date } = {}
): Promise<LiveStatusReadback> {
  let trip: (LiveActivationTrip & { id: string }) | null = null;
  if (options.tripId) {
    const { data } = await supabase
      .from("roamly_trips")
      .select(TRIP_FIELDS)
      .eq("id", options.tripId)
      .eq("user_id", userId)
      .maybeSingle();
    trip = (data as (LiveActivationTrip & { id: string }) | null) || null;
  } else {
    const { data } = await supabase
      .from("roamly_trips")
      .select(TRIP_FIELDS)
      .eq("user_id", userId)
      .order("start_date", { ascending: true })
      .limit(40);
    const rows = (data || []) as Array<LiveActivationTrip & { id: string; status?: string | null }>;
    trip = resolveRoamlySelectedTrip({ trips: rows, now: options.now ? new Date(options.now) : undefined }).trip;
  }
  const tripId = trip?.id || null;

  const [notifications, locationResult, preferences] = await Promise.all([
    readPushSubscriptionStatus(supabase, userId, tripId),
    supabase
      .from("roamly_location_settings")
      .select("last_permission_state,location_tracking_enabled")
      .eq("user_id", userId)
      .maybeSingle(),
    tripId
      ? getCompanionPreferences({ supabase, userId, tripId }).catch(() => null)
      : Promise.resolve(null)
  ]);
  const locationRow = locationResult.data as {
    last_permission_state?: string | null;
    location_tracking_enabled?: boolean | null;
  } | null;

  const live = deriveLiveActivation({
    trip,
    locationPermission: locationRow?.last_permission_state ?? null,
    locationEnabled: locationRow ? locationRow.location_tracking_enabled === true : null,
    companionEnabled: preferences ? preferences.liveCompanionEnabled : undefined,
    companionPausedUntil: preferences?.liveCompanionPausedUntil,
    now: options.now
  });

  return { tripId, notifications, live };
}
