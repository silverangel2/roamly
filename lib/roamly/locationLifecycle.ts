import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isLiveCompanionEligible,
  type LiveEligibilityOptions
} from "@/lib/roamly/liveEligibility";

export type OperationalLocationTrip = {
  id: string;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  itinerary_locked?: boolean | null;
  itinerary_status?: string | null;
  itinerary_generated_at?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata?: unknown;
  destination?: unknown;
  destination_name?: unknown;
  destination_city?: unknown;
};

/**
 * JS mirror of the SQL gate roamly_has_operational_location_trip.
 * L12 (2026-10-31): this file used to carry its OWN copy of the rule
 * — status locked/active/planned only (no "generated") and a
 * metadata-only timezone with a silent UTC fallback, duplicating
 * migration 20260928000200. Both copies now delegate to / mirror the
 * ONE rule in lib/roamly/liveEligibility.ts: live-ready status
 * (locked/active/planned/generated) + locked + companion-unlocked +
 * the window read in the destination timezone (metadata, then the
 * verified destination registry, then the documented UTC fallback).
 * The matching SQL definition is the OWNER-APPLIED migration
 * 20261031000200_roamly_live_eligibility_timezone.sql — until the
 * owner applies it, the database gate still uses the 20260928000200
 * definition (see that migration's header).
 */
export function isOperationalLocationTrip(
  trip: OperationalLocationTrip,
  now: Date,
  options?: LiveEligibilityOptions
) {
  return isLiveCompanionEligible(trip, now, options);
}

export function hasOperationalLocationTrip(
  trips: OperationalLocationTrip[],
  now: Date,
  options?: LiveEligibilityOptions
) {
  return trips.some((trip) => isOperationalLocationTrip(trip, now, options));
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
