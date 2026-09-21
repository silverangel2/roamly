import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTripBudgetSnapshot, getTripBudgetCurrency, getTripPlanningMetadata } from "@/lib/roamly/tripMetadata";

export const DESTINATION_CHANGE_PROPOSAL_STATUSES = ["awaiting_approval", "reserved", "generating", "applied", "failed", "stale", "rejected"] as const;
export type DestinationChangeProposalStatus = (typeof DESTINATION_CHANGE_PROPOSAL_STATUSES)[number];

export type DestinationSnapshot = {
  value: string;
  city: string;
  region: string;
  country: string;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  currency: string | null;
  source: string;
};

export type DestinationEligibility = { ok: true } | { ok: false; code: string; message: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalized(value: unknown) {
  return text(value).replace(/\s+/g, " ");
}

export function normalizeDestinationSnapshot(value: unknown): DestinationSnapshot | null {
  const place = record(value);
  const snapshot: DestinationSnapshot = {
    value: normalized(place.value || place.label),
    city: normalized(place.city),
    region: normalized(place.region),
    country: normalized(place.country),
    placeId: text(place.place_id || place.placeId) || null,
    latitude: finite(place.latitude),
    longitude: finite(place.longitude),
    timezone: text(place.timezone) || null,
    currency: text(place.currency).toUpperCase() || null,
    source: text(place.source) || "unknown"
  };
  if (!snapshot.value || !snapshot.city || !snapshot.country) return null;
  if (snapshot.latitude === null || snapshot.longitude === null) return null;
  if (snapshot.latitude < -90 || snapshot.latitude > 90 || snapshot.longitude < -180 || snapshot.longitude > 180) return null;
  return snapshot;
}

export function destinationSnapshotHash(snapshot: DestinationSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function destinationSnapshotForTrip(trip: Record<string, unknown>): DestinationSnapshot | null {
  const planning = getTripPlanningMetadata(trip.metadata);
  const place = record(planning.destinationPlace);
  return normalizeDestinationSnapshot({
    value: place.value || place.label || trip.destination || trip.destination_name || planning.destination,
    city: place.city || trip.destination_city || planning.destinationCity || planning.destination_city,
    region: place.region || trip.destination_region || planning.destinationRegion || planning.destination_region,
    country: place.country || trip.destination_country || planning.destinationCountry || planning.destination_country,
    place_id: place.place_id || planning.destinationPlaceId || planning.destination_place_id,
    latitude: place.latitude ?? planning.destinationLatitude ?? planning.destination_latitude,
    longitude: place.longitude ?? planning.destinationLongitude ?? planning.destination_longitude,
    timezone: place.timezone || planning.destinationTimezone || planning.destination_timezone,
    currency: place.currency || planning.destinationCurrency || planning.destination_currency,
    source: place.source || "structured_trip"
  });
}

function planningIntentSnapshot(trip: Record<string, unknown>, destination: DestinationSnapshot) {
  const planning = getTripPlanningMetadata(trip.metadata);
  const intent = {
    tripType: "single_destination",
    origin: trip.origin ?? planning.origin ?? null,
    originPlace: planning.originPlace ?? null,
    originPlaceId: planning.originPlaceId ?? planning.origin_place_id ?? null,
    originCity: planning.originCity ?? planning.origin_city ?? null,
    originRegion: planning.originRegion ?? planning.origin_region ?? null,
    originCountry: planning.originCountry ?? planning.origin_country ?? null,
    originLatitude: planning.originLatitude ?? planning.origin_latitude ?? null,
    originLongitude: planning.originLongitude ?? planning.origin_longitude ?? null,
    destination: destination.value,
    destinationPlace: destination,
    destinationPlaceId: destination.placeId,
    destinationCity: destination.city,
    destinationRegion: destination.region,
    destinationCountry: destination.country,
    destinationLatitude: destination.latitude,
    destinationLongitude: destination.longitude,
    destinationTimezone: destination.timezone,
    destinationCurrency: destination.currency,
    destinationStops: [],
    returnToOrigin: planning.returnToOrigin !== false && planning.return_to_origin !== false,
    travelersCount: trip.travelers_count ?? planning.travelersCount ?? planning.travelers_count ?? 1,
    travelers: planning.travelers ?? null,
    rooms: planning.rooms ?? 1,
    bedPreference: planning.bedPreference ?? planning.bed_preference ?? "No preference",
    budgetAmount: getTripBudgetSnapshot(trip).effectiveAmount,
    budgetCurrency: getTripBudgetCurrency(trip),
    budgetIncludesFlights: trip.budget_includes_flights !== false && planning.budgetIncludesFlights !== false,
    budgetIncludesHotel: trip.budget_includes_hotel !== false && planning.budgetIncludesHotel !== false,
    budgetIncludesActivities: planning.budgetIncludesActivities !== false && planning.budget_includes_activities !== false,
    travelStyle: trip.travel_style ?? planning.travelStyle ?? planning.travel_style ?? "Balanced",
    interests: Array.isArray(trip.interests) ? trip.interests : Array.isArray(planning.interests) ? planning.interests : [],
    pace: planning.pace ?? "Balanced",
    walkingTolerance: planning.walkingTolerance ?? planning.walking_tolerance ?? "Medium",
    accommodationPreference: trip.accommodation_preference ?? planning.accommodationPreference ?? planning.accommodation_preference ?? "Not sure",
    transportationPreference: trip.transportation_preference ?? planning.transportationPreference ?? planning.transportation_preference ?? "Mixed",
    accessibilityNeeds: planning.accessibilityNeeds ?? planning.accessibility_needs ?? null,
    dietaryPreference: planning.dietaryPreference ?? planning.dietary_preference ?? null,
    specialNotes: trip.special_notes ?? planning.specialNotes ?? planning.special_notes ?? null,
    language: planning.language ?? "en",
    constraints: planning.constraints ?? null,
    explicitRequirements: planning.explicitRequirements ?? null
  };
  return { ...intent, planning: intent };
}

export function buildOriginSnapshot(trip: Record<string, unknown>) {
  const planning = getTripPlanningMetadata(trip.metadata);
  return {
    origin: trip.origin ?? planning.origin ?? null,
    originPlace: planning.originPlace ?? null,
    originPlaceId: planning.originPlaceId ?? planning.origin_place_id ?? null,
    originCity: planning.originCity ?? planning.origin_city ?? null,
    originRegion: planning.originRegion ?? planning.origin_region ?? null,
    originCountry: planning.originCountry ?? planning.origin_country ?? null,
    originLatitude: planning.originLatitude ?? planning.origin_latitude ?? null,
    originLongitude: planning.originLongitude ?? planning.origin_longitude ?? null
  };
}

export function buildBudgetSnapshot(trip: Record<string, unknown>) {
  const planning = getTripPlanningMetadata(trip.metadata);
  const budget = getTripBudgetSnapshot(trip);
  return {
    rawTripAmount: trip.budget_amount ?? null,
    rawTripCurrency: trip.budget_currency ?? null,
    planningBudgetAmount: planning.budgetAmount ?? planning.budget_amount ?? planning.budget_total ?? null,
    planningBudgetSource: planning.budgetAmount != null ? "budgetAmount" : planning.budget_amount != null ? "budget_amount" : planning.budget_total != null ? "budget_total" : null,
    effectiveAmount: budget.effectiveAmount,
    effectiveSource: budget.effectiveSource,
    currency: getTripBudgetCurrency(trip)
  };
}

export function buildGenerationSnapshot(trip: Record<string, unknown>) {
  const metadata = record(trip.metadata);
  return {
    generation: metadata.generation ?? null,
    itineraryStatus: trip.itinerary_status ?? null,
    itineraryLocked: trip.itinerary_locked ?? null,
    latestPriceDiscoveryId: trip.latest_price_discovery_id ?? null
  };
}

export function buildSuccessorDestinationIntent(trip: Record<string, unknown>, requested: DestinationSnapshot) {
  return planningIntentSnapshot(trip, requested);
}

export function destinationLifecycleAllowed(status: string | null | undefined) {
  return status === "generated" || status === "locked" || status === "planned";
}

export function destinationSourceDatesEligible(startDate: string | null | undefined, endDate: string | null | undefined): DestinationEligibility {
  if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
    return { ok: false, code: "DESTINATION_CHANGE_DATES_INVALID", message: "This trip's dates are not valid enough to create a safe successor." };
  }
  return { ok: true };
}

export function validateDestinationRequest(current: DestinationSnapshot | null, requested: DestinationSnapshot | null): DestinationEligibility {
  if (!requested) return { ok: false, code: "DESTINATION_UNRESOLVED", message: "Choose a recognized destination with a city and country." };
  if (current && destinationSnapshotHash(current) === destinationSnapshotHash(requested)) return { ok: false, code: "DESTINATION_UNCHANGED", message: "Choose a destination different from the current trip." };
  return { ok: true };
}

export type DestinationBookingRow = {
  id: string;
  booking_status: string | null;
  traveler_confirmed: boolean | null;
  updated_at: string | null;
  superseded_by_booking_id: string | null;
};

export async function buildDestinationBookingSnapshot(supabase: SupabaseClient, userId: string, tripId: string) {
  const result = await supabase
    .from("roamly_bookings")
    .select("id,booking_status,traveler_confirmed,updated_at,superseded_by_booking_id")
    .eq("user_id", userId)
    .eq("trip_id", tripId)
    .is("superseded_by_booking_id", null)
    .order("id");
  if (result.error) return { error: result.error.message || "BOOKING_STATE_UNAVAILABLE", rows: [] as DestinationBookingRow[], snapshot: null as null };
  const rows = (result.data || []) as DestinationBookingRow[];
  return {
    error: null,
    rows,
    snapshot: { bookings: rows.map((row) => ({ id: row.id, booking_status: row.booking_status, traveler_confirmed: row.traveler_confirmed, updated_at_epoch: row.updated_at ? Math.floor(new Date(row.updated_at).getTime() / 1000) : null, superseded_by_booking_id: row.superseded_by_booking_id })) }
  };
}

export function evaluateDestinationBookings(rows: DestinationBookingRow[]): DestinationEligibility {
  for (const row of rows) {
    const status = text(row.booking_status).toLowerCase();
    if (row.traveler_confirmed === true || ["booked", "paid", "reserved", "confirmed", "modified", "completed"].includes(status)) {
      return { ok: false, code: "DESTINATION_CHANGE_BOOKING_BLOCKED", message: "This trip has a current booking that Roamly will not change." };
    }
    if (!["recommended", "clicked", "cancelled", "refunded"].includes(status)) {
      return { ok: false, code: "DESTINATION_CHANGE_BOOKING_REVIEW_REQUIRED", message: "This trip has booking evidence that must be reviewed before changing destination." };
    }
  }
  return { ok: true };
}

export function buildDestinationChangePreview(current: DestinationSnapshot | null, requested: DestinationSnapshot, bookingStatuses: string[]) {
  return {
    currentDestination: current,
    requestedDestination: requested,
    existingBookingsChanged: false,
    bookingStatuses,
    refreshes: ["flights", "hotels", "activities", "events", "prices", "routing", "requirements", "connectivity"],
    note: "Existing bookings will not be changed. Your original trip remains available until the new itinerary succeeds."
  };
}

export function destinationIntentHash(intent: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}
