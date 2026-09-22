import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTripBudgetCurrency, getTripBudgetSnapshot, getTripPlanningMetadata } from "@/lib/roamly/tripMetadata";
import { tripTravelerComposition } from "@/lib/roamly/tripTravelers";

export const CUSTOMER_TRIP_INTENT_CHANGE_STATUSES = ["awaiting_approval", "reserved", "generating", "applied", "failed", "stale", "rejected"] as const;

export type TravelerComposition = { adults: number; children: number; infants: number };

export type GenerationIntent = {
  travelersCount: number;
  travelers: TravelerComposition;
  rooms: number;
  bedPreference: string;
  travelStyle: string;
  interests: string[];
  pace: string;
  walkingTolerance: string;
  accommodationPreference: string;
  transportationPreference: string;
  accessibilityNeeds: unknown;
  dietaryPreference: unknown;
  specialNotes: unknown;
  constraints: unknown;
  explicitRequirements: unknown;
  planning: Record<string, unknown>;
};

export type IntentChangeEligibility = { ok: true } | { ok: false; code: string; message: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 20) : [];
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function jsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(jsonValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([key, item]) => [key, jsonValue(item)]));
  return null;
}

export function normalizeTravelerComposition(value: unknown): TravelerComposition | null {
  const row = record(value);
  const adults = nonNegativeInteger(row.adults);
  const children = nonNegativeInteger(row.children) ?? 0;
  const infants = nonNegativeInteger(row.infants) ?? 0;
  if (adults === null || adults < 1) return null;
  return { adults, children, infants };
}

function currentComposition(trip: Record<string, unknown>) {
  return tripTravelerComposition({ ...trip, id: typeof trip.id === "string" ? trip.id : "intent-change-trip" }) || { total: 1, adults: 1, children: 0, infants: 0 };
}

function currentPlanning(trip: Record<string, unknown>) {
  return getTripPlanningMetadata(trip.metadata);
}

function canonicalPlanning(trip: Record<string, unknown>, intent: Omit<GenerationIntent, "planning">) {
  const planning = currentPlanning(trip);
  const destinationStops = Array.isArray(planning.destinationStops) ? planning.destinationStops : [];
  return {
    tripType: planning.tripType || "single_destination",
    origin: trip.origin ?? planning.origin ?? null,
    originPlace: planning.originPlace ?? null,
    originPlaceId: planning.originPlaceId ?? null,
    originCity: planning.originCity ?? null,
    originRegion: planning.originRegion ?? null,
    originCountry: planning.originCountry ?? null,
    originLatitude: planning.originLatitude ?? null,
    originLongitude: planning.originLongitude ?? null,
    destination: trip.destination ?? planning.destination ?? null,
    destinationCity: trip.destination_city ?? planning.destinationCity ?? null,
    destinationCountry: trip.destination_country ?? planning.destinationCountry ?? null,
    destinationRegion: trip.destination_region ?? planning.destinationRegion ?? null,
    destinationLatitude: planning.destinationLatitude ?? null,
    destinationLongitude: planning.destinationLongitude ?? null,
    destinationPlace: planning.destinationPlace ?? null,
    destinationPlaceId: planning.destinationPlaceId ?? null,
    destinationStops,
    returnToOrigin: planning.returnToOrigin !== false,
    flexibleCityOrder: planning.flexibleCityOrder === true,
    flexibleDates: planning.flexibleDates === true,
    startDate: trip.start_date ?? planning.startDate ?? null,
    endDate: trip.end_date ?? planning.endDate ?? null,
    daysCount: trip.days_count ?? planning.daysCount ?? null,
    travelersCount: intent.travelersCount,
    travelers: intent.travelers,
    rooms: intent.rooms,
    bedPreference: intent.bedPreference,
    budgetAmount: getTripBudgetSnapshot(trip).effectiveAmount,
    budgetCurrency: getTripBudgetCurrency(trip),
    budgetIncludesFlights: planning.budgetIncludesFlights !== false,
    budgetIncludesHotel: planning.budgetIncludesHotel !== false,
    budgetIncludesActivities: planning.budgetIncludesActivities !== false,
    travelStyle: intent.travelStyle,
    interests: intent.interests,
    pace: intent.pace,
    walkingTolerance: intent.walkingTolerance,
    accommodationPreference: intent.accommodationPreference,
    transportationPreference: intent.transportationPreference,
    accessibilityNeeds: intent.accessibilityNeeds,
    dietaryPreference: intent.dietaryPreference,
    specialNotes: intent.specialNotes,
    language: planning.language || "en",
    constraints: intent.constraints,
    explicitRequirements: intent.explicitRequirements
  };
}

export function generationIntentForTrip(trip: Record<string, unknown>): GenerationIntent {
  const planning = currentPlanning(trip);
  const composition = currentComposition(trip);
  const intent = {
    travelersCount: composition.total,
    travelers: { adults: composition.adults, children: composition.children, infants: composition.infants },
    rooms: nonNegativeInteger(planning.rooms) || 1,
    bedPreference: text(planning.bedPreference, "No preference"),
    travelStyle: text(trip.travel_style ?? planning.travelStyle, "Balanced"),
    interests: stringArray(Array.isArray(trip.interests) && trip.interests.length ? trip.interests : planning.interests),
    pace: text(planning.pace, "Balanced"),
    walkingTolerance: text(planning.walkingTolerance, "Medium"),
    accommodationPreference: text(trip.accommodation_preference ?? planning.accommodationPreference, "Not sure"),
    transportationPreference: text(trip.transportation_preference ?? planning.transportationPreference, "Mixed"),
    accessibilityNeeds: jsonValue(planning.accessibilityNeeds ?? planning.accessibility_needs),
    dietaryPreference: jsonValue(planning.dietaryPreference ?? planning.dietary_preference),
    specialNotes: jsonValue(trip.special_notes ?? planning.specialNotes ?? planning.special_notes),
    constraints: jsonValue(planning.constraints),
    explicitRequirements: jsonValue(planning.explicitRequirements)
  } satisfies Omit<GenerationIntent, "planning">;
  return { ...intent, planning: canonicalPlanning(trip, intent) };
}

export function normalizeGenerationIntentPatch(value: unknown): Partial<Omit<GenerationIntent, "planning">> | null {
  const row = record(value);
  const patch: Partial<Omit<GenerationIntent, "planning">> = {};
  if ("travelers" in row) {
    const travelers = normalizeTravelerComposition(row.travelers);
    if (!travelers) return null;
    patch.travelers = travelers;
    patch.travelersCount = travelers.adults + travelers.children + travelers.infants;
  }
  if ("travelersCount" in row) return null;
  if ("rooms" in row) {
    const rooms = nonNegativeInteger(row.rooms);
    if (rooms === null || rooms < 1 || rooms > 20) return null;
    patch.rooms = rooms;
  }
  for (const field of ["bedPreference", "travelStyle", "pace", "walkingTolerance", "accommodationPreference", "transportationPreference"] as const) {
    if (field in row) {
      if (typeof row[field] !== "string" || !row[field].trim()) return null;
      patch[field] = row[field].trim();
    }
  }
  if ("interests" in row) {
    if (!Array.isArray(row.interests)) return null;
    patch.interests = stringArray(row.interests);
  }
  for (const field of ["accessibilityNeeds", "dietaryPreference", "specialNotes"] as const) if (field in row) patch[field] = jsonValue(row[field]);
  if ("constraints" in row || "explicitRequirements" in row) return null;
  return Object.keys(patch).length ? patch : null;
}

export function buildRequestedGenerationIntent(trip: Record<string, unknown>, patch: Partial<Omit<GenerationIntent, "planning">>) {
  const current = generationIntentForTrip(trip);
  const next = { ...current, ...patch, travelers: patch.travelers || current.travelers };
  next.travelersCount = next.travelers.adults + next.travelers.children + next.travelers.infants;
  return { ...next, planning: canonicalPlanning(trip, next) } satisfies GenerationIntent;
}

export function intentChangeSourceSnapshot(trip: Record<string, unknown>) {
  const planning = currentPlanning(trip);
  const budget = getTripBudgetSnapshot(trip);
  return {
    destination: trip.destination ?? planning.destination ?? null,
    destinationCity: trip.destination_city ?? planning.destinationCity ?? null,
    destinationCountry: trip.destination_country ?? planning.destinationCountry ?? null,
    destinationRegion: trip.destination_region ?? planning.destinationRegion ?? null,
    origin: trip.origin ?? planning.origin ?? null,
    startDate: trip.start_date ?? planning.startDate ?? null,
    endDate: trip.end_date ?? planning.endDate ?? null,
    daysCount: trip.days_count ?? planning.daysCount ?? null,
    budgetAmount: budget.effectiveAmount,
    budgetCurrency: getTripBudgetCurrency(trip),
    latestPriceDiscoveryId: trip.latest_price_discovery_id ?? null
  };
}

export function generationSnapshotForTrip(trip: Record<string, unknown>) {
  const metadata = record(trip.metadata);
  return { generation: metadata.generation ?? null, itineraryStatus: trip.itinerary_status ?? null, itineraryLocked: trip.itinerary_locked ?? null };
}

export function intentHash(intent: GenerationIntent) {
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

export async function buildIntentBookingSnapshot(supabase: SupabaseClient, userId: string, tripId: string) {
  const result = await supabase.from("roamly_bookings").select("id,booking_status,traveler_confirmed,updated_at,superseded_by_booking_id").eq("user_id", userId).eq("trip_id", tripId).is("superseded_by_booking_id", null).order("id");
  if (result.error) return { error: result.error.message || "BOOKING_STATE_UNAVAILABLE", snapshot: null as null, rows: [] as Record<string, unknown>[] };
  const rows = (result.data || []) as Record<string, unknown>[];
  return { error: null, rows, snapshot: { bookings: rows.map((row) => ({ id: row.id, booking_status: row.booking_status, traveler_confirmed: row.traveler_confirmed, updated_at_epoch: typeof row.updated_at === "string" ? Math.floor(new Date(row.updated_at).getTime() / 1000) : null, superseded_by_booking_id: row.superseded_by_booking_id })) } };
}

export function evaluateIntentChange(trip: Record<string, unknown>, patch: Partial<Omit<GenerationIntent, "planning">> | null): IntentChangeEligibility {
  if (!tripTravelerComposition({ ...trip, id: typeof trip.id === "string" ? trip.id : "intent-change-trip" })) return { ok: false, code: "INTENT_CHANGE_TRAVELER_COMPOSITION_UNAVAILABLE", message: "This trip's traveler composition is not safe to change." };
  if (!patch) return { ok: false, code: "INTENT_CHANGE_FIELDS_REQUIRED", message: "Choose at least one traveler or preference change." };
  return { ok: true };
}

export function intentChangePreview(current: GenerationIntent, requested: GenerationIntent, bookingRows: Record<string, unknown>[]) {
  const changed = Object.keys(requested).filter((key) => key !== "planning" && JSON.stringify(current[key as keyof GenerationIntent]) !== JSON.stringify(requested[key as keyof GenerationIntent]));
  return {
    changedFields: changed,
    unchanged: ["destination", "dates", "budget", "existing bookings"],
    note: "Roamly will create a fresh grounded trip plan. Existing external bookings remain attached to the current trip and are not moved.",
    bookingReviewRequired: bookingRows.length > 0,
    originalRemainsUntilSuccess: true
  };
}
