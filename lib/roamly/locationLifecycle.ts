import type { SupabaseClient } from "@supabase/supabase-js";

export type OperationalLocationTrip = {
  id: string;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  itinerary_locked?: boolean | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata?: unknown;
};

function localDate(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function timezoneFromMetadata(metadata: unknown) {
  const root = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  const planning = root.planning && typeof root.planning === "object" && !Array.isArray(root.planning)
    ? root.planning as Record<string, unknown>
    : root;
  return [planning.timezone, planning.destinationTimezone, planning.destination_timezone, root.timezone, root.destinationTimezone, root.destination_timezone]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0) || "UTC";
}

export function isOperationalLocationTrip(trip: OperationalLocationTrip, now: Date) {
  const status = String(trip.status || "").trim().toLowerCase();
  if (!(["locked", "active", "planned"].includes(status))) return false;
  if (!trip.itinerary_locked || (!trip.tracking_unlocked && !trip.live_companion_unlocked)) return false;
  if (!trip.start_date || !trip.end_date) return false;
  const today = localDate(now, timezoneFromMetadata(trip.metadata));
  return trip.start_date <= today && trip.end_date >= today;
}

export function hasOperationalLocationTrip(trips: OperationalLocationTrip[], now: Date) {
  return trips.some((trip) => isOperationalLocationTrip(trip, now));
}

export async function writeForegroundLocation(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string | null;
  latitude: number;
  longitude: number;
  observedAt: string;
}) {
  const { data, error } = await params.supabase.rpc("roamly_write_foreground_location", {
    p_user_id: params.userId,
    p_trip_id: params.tripId,
    p_latitude: params.latitude,
    p_longitude: params.longitude,
    p_observed_at: params.observedAt
  });
  return { written: data === true, error: error?.message || null };
}

export async function clearLastLocationIfNoOperationalTrip(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.rpc("roamly_clear_last_location_if_no_operational_trip", {
    p_user_id: userId
  });
  return { cleared: data === true, error: error?.message || null };
}
