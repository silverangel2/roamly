import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordTripEvent } from "@/lib/roamly/events";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";

type CompanionTrip = {
  id: string;
  user_id: string;
  destination?: string | null;
  destination_name?: string | null;
  destination_city?: string | null;
  destination_country?: string | null;
  start_date: string | null;
  end_date: string | null;
  days_count?: number | null;
  live_companion_unlocked?: boolean | null;
  tracking_unlocked?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

type CompanionBooking = {
  id: string;
  booking_type: string;
  title: string | null;
  provider_name: string | null;
  start_date: string | null;
  start_time: string | null;
  address: string | null;
  city: string | null;
};

function addDays(date: string, days: number) {
  const next = new Date(`${date}T09:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

function startOfTrip(date: string | null) {
  return date ? new Date(`${date}T09:00:00Z`).toISOString() : null;
}

export function tripHasLiveCompanionUnlock(trip: Pick<CompanionTrip, "live_companion_unlocked" | "tracking_unlocked">) {
  return Boolean(trip.live_companion_unlocked || trip.tracking_unlocked);
}

export async function isLiveCompanionUnlocked(supabase: SupabaseClient, tripId: string) {
  const { data, error } = await supabase
    .from("roamly_trips")
    .select("tracking_unlocked")
    .eq("id", tripId)
    .maybeSingle();
  if (error) return { unlocked: false, error: error.message };
  return { unlocked: tripHasLiveCompanionUnlock(data || {}), error: null };
}

export function buildCountryInfo(destinationCountry?: string | null, destinationCity?: string | null) {
  const place = [destinationCity, destinationCountry].filter(Boolean).join(", ") || "your destination";
  return {
    title: `Travel notes for ${place}`,
    summary: "Check official government, embassy, airline, and destination sources before travel.",
    reminders: [
      "Verify entry documents and passport validity.",
      "Confirm local emergency numbers and nearest embassy or consulate.",
      "Check weather, transit disruptions, and local safety updates before leaving."
    ]
  };
}

export function buildPackingChecklist(trip: CompanionTrip) {
  const destination = getTripDestinationLabel(trip) || "the destination";
  return [
    "Passport or government ID",
    "Travel insurance details",
    "Phone charger and power bank",
    "Weather-appropriate clothing",
    "Medication and basic first aid",
    `Offline maps for ${destination}`
  ];
}

export function buildDocumentChecklist() {
  return [
    "Passport validity",
    "Visa or eTA requirement",
    "Flight, hotel, and activity confirmations",
    "Travel insurance",
    "Emergency contact details"
  ];
}

export function buildPreTripTimeline(trip: CompanionTrip, bookings: CompanionBooking[] = []) {
  const start = trip.start_date;
  const events = [
    start
      ? {
          event_type: "one_week_before",
          title: "One week before your trip",
          body: "Review bookings, documents, weather, and packing list.",
          scheduled_for: addDays(start, -7)
        }
      : null,
    start
      ? {
          event_type: "one_day_before",
          title: "Tomorrow is travel day",
          body: "Charge devices, download maps, confirm check-in times, and pack documents.",
          scheduled_for: addDays(start, -1)
        }
      : null,
    start
      ? {
          event_type: "countdown_24h",
          title: "24-hour countdown",
          body: "Your trip starts soon. Open Roamly for the travel timeline.",
          scheduled_for: addDays(start, -1)
        }
      : null,
    start
      ? {
          event_type: "travel_day_started",
          title: "Travel day started",
          body: "Roamly can show what is next, nearby, and already booked.",
          scheduled_for: startOfTrip(start)
        }
      : null,
    {
      event_type: "document_check",
      title: "Document check",
      body: "Document requirements can change. Verify official government, embassy, airline, and destination sources before travel.",
      scheduled_for: start ? addDays(start, -7) : null
    },
    {
      event_type: "packing_check",
      title: "Packing reminder",
      body: "Roamly can remind you about packing, documents, check-in times, and what’s up next during your trip.",
      scheduled_for: start ? addDays(start, -2) : null
    },
    {
      event_type: "country_info",
      title: "Country and city info",
      body: `Review key travel notes for ${getTripDestinationLabel(trip) || "your destination"}.`,
      scheduled_for: start ? addDays(start, -7) : null
    }
  ].filter(Boolean) as Array<{ event_type: string; title: string; body: string; scheduled_for: string | null }>;

  const bookingEvents = bookings.map((booking) => ({
    event_type: booking.booking_type === "hotel" ? "check_in_reminder" : "booking_reminder",
    booking_id: booking.id,
    title: booking.title || `${booking.booking_type} reminder`,
    body: `${booking.provider_name || "Booking"}${booking.start_time ? ` at ${booking.start_time}` : ""}.`,
    scheduled_for: booking.start_date ? new Date(`${booking.start_date}T${booking.start_time || "09:00"}:00Z`).toISOString() : null
  }));

  return [...events, ...bookingEvents];
}

async function getTripAndBookings(supabase: SupabaseClient, tripId: string) {
  const [{ data: trip, error: tripError }, { data: bookings, error: bookingError }] = await Promise.all([
    supabase.from("roamly_trips").select("*").eq("id", tripId).maybeSingle(),
    supabase.from("roamly_bookings").select("*").eq("trip_id", tripId).order("start_date", { ascending: true })
  ]);
  if (tripError) return { trip: null, bookings: [], error: tripError.message };
  if (bookingError) return { trip: trip as CompanionTrip | null, bookings: [], error: bookingError.message };
  return { trip: trip as CompanionTrip | null, bookings: (bookings || []) as CompanionBooking[], error: null };
}

export async function scheduleCompanionEvents(supabase: SupabaseClient, tripId: string) {
  const reader = createSupabaseAdminClient() || supabase;
  const { trip, bookings, error } = await getTripAndBookings(reader, tripId);
  if (error || !trip) return { ok: false, error: error || "Trip not found." };
  if (!tripHasLiveCompanionUnlock(trip)) {
    return { ok: false, error: "Live Trip Companion is not unlocked for this trip." };
  }

  const timeline = buildPreTripTimeline(trip, bookings);
  const { data: existing } = await reader
    .from("roamly_trip_companion_events")
    .select("event_type,booking_id")
    .eq("trip_id", tripId);
  const existingKeys = new Set((existing || []).map((event) => `${event.event_type}:${event.booking_id || ""}`));
  const rows = timeline
    .filter((event) => !existingKeys.has(`${event.event_type}:${"booking_id" in event ? event.booking_id || "" : ""}`))
    .map((event) => ({
      user_id: trip.user_id,
      trip_id: tripId,
      booking_id: "booking_id" in event ? event.booking_id || null : null,
      event_type: event.event_type,
      title: event.title,
      body: event.body,
      scheduled_for: event.scheduled_for,
      status: "scheduled",
      metadata: { generatedBy: "roamly_companion" }
    }));

  if (rows.length) {
    const inserted = await reader.from("roamly_trip_companion_events").insert(rows);
    if (inserted.error) return { ok: false, error: inserted.error.message };
  }

  await reader
    .from("roamly_trips")
    .update({
      metadata: {
        ...(trip.metadata || {}),
        companion: {
          status: "scheduled",
          travelCountryInfo: buildCountryInfo(trip.destination_country, trip.destination_city),
          packingChecklist: buildPackingChecklist(trip),
          documentChecklist: buildDocumentChecklist()
        }
      }
    })
    .eq("id", tripId);

  return { ok: true, count: rows.length };
}

export async function unlockLiveCompanion(
  supabase: SupabaseClient,
  tripId: string,
  source: "paid" | "bundle" | "admin"
) {
  const writer = createSupabaseAdminClient() || supabase;
  const now = new Date().toISOString();
  const { data: trip, error } = await writer
    .from("roamly_trips")
    .update({
      tracking_unlocked: true,
      tracking_unlock_source: source,
      tracking_paid_at: now
    })
    .eq("id", tripId)
    .select("id,user_id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!trip) return { ok: false, error: "Trip not found." };

  await scheduleCompanionEvents(writer, tripId);
  await recordTripEvent(writer, {
    userId: trip.user_id,
    tripId,
    eventType: "live_companion_unlocked",
    eventTitle: "Live Trip Companion unlocked",
    eventBody: "Live Trip Companion is ready for this trip.",
    metadata: { source }
  });
  return { ok: true };
}

export async function getCompanionTimeline(supabase: SupabaseClient, userId: string, tripId: string) {
  const { data, error } = await supabase
    .from("roamly_trip_companion_events")
    .select("*")
    .eq("user_id", userId)
    .eq("trip_id", tripId)
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  return { events: data || [], error: error?.message || null };
}

export async function getNextCompanionEvent(supabase: SupabaseClient, userId: string, tripId: string) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("roamly_trip_companion_events")
    .select("*")
    .eq("user_id", userId)
    .eq("trip_id", tripId)
    .eq("status", "scheduled")
    .gte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();

  return { event: data || null, error: error?.message || null };
}

export async function markCompanionEventShown(supabase: SupabaseClient, userId: string, eventId: string) {
  return supabase
    .from("roamly_trip_companion_events")
    .update({ status: "shown" })
    .eq("id", eventId)
    .eq("user_id", userId);
}

export async function buildTravelDayStatus(supabase: SupabaseClient, userId: string, tripId: string) {
  const [timeline, next] = await Promise.all([
    getCompanionTimeline(supabase, userId, tripId),
    getNextCompanionEvent(supabase, userId, tripId)
  ]);
  return {
    timeline: timeline.events,
    nextEvent: next.event,
    error: timeline.error || next.error
  };
}

export async function buildLiveCompanionSummary(supabase: SupabaseClient, userId: string, tripId: string) {
  const { data: trip } = await supabase
    .from("roamly_trips")
    .select("metadata")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  const status = await buildTravelDayStatus(supabase, userId, tripId);
  return {
    trip,
    timeline: status.timeline,
    nextEvent: status.nextEvent,
    error: status.error
  };
}
