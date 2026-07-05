import type { SupabaseClient } from "@supabase/supabase-js";

export type AppEventInput = {
  userId?: string | null;
  visitorKey?: string | null;
  eventType: string;
  path?: string | null;
  url?: string | null;
  title?: string | null;
  referrer?: string | null;
  referrerHost?: string | null;
  deviceType?: string | null;
  platform?: string | null;
  browser?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  metadata?: Record<string, unknown>;
};

export type TripEventInput = {
  userId?: string | null;
  tripId?: string | null;
  activityId?: string | null;
  eventType: string;
  eventTitle?: string | null;
  eventBody?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distanceMeters?: number | null;
  metadata?: Record<string, unknown>;
};

export async function recordAppEvent(supabase: SupabaseClient, input: AppEventInput) {
  return supabase.from("roamly_app_events").insert({
    user_id: input.userId || null,
    visitor_key: input.visitorKey || null,
    event_type: input.eventType,
    path: input.path || null,
    url: input.url || null,
    title: input.title || null,
    referrer: input.referrer || null,
    referrer_host: input.referrerHost || null,
    device_type: input.deviceType || null,
    platform: input.platform || null,
    browser: input.browser || null,
    country: input.country || null,
    region: input.region || null,
    city: input.city || null,
    metadata: input.metadata || {}
  });
}

export async function recordTripEvent(supabase: SupabaseClient, input: TripEventInput) {
  return supabase.from("roamly_trip_events").insert({
    user_id: input.userId || null,
    trip_id: input.tripId || null,
    activity_id: input.activityId || null,
    event_type: input.eventType,
    event_title: input.eventTitle || null,
    event_body: input.eventBody || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    distance_meters: input.distanceMeters ?? null,
    metadata: input.metadata || {}
  });
}

export const recordRoamlyEvent = recordAppEvent;
