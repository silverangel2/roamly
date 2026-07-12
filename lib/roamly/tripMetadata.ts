import type { TripPlannerPayload } from "@/lib/trip-planner";
import { calculateInclusiveTripDays } from "@/lib/roamly/dateUtils";

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getPositiveNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return null;
}

export function getTripPlanningMetadata(metadata: unknown) {
  const root = getRecord(metadata);
  return getRecord(root?.planning) || {};
}

export function buildTripPlanningMetadata(payload: TripPlannerPayload) {
  return {
    tripType: payload.tripType || "single_destination",
    origin: payload.origin || null,
    originPlace: payload.originPlace || null,
    originPlaceId: payload.originPlaceId || null,
    originCity: payload.originCity || null,
    originRegion: payload.originRegion || null,
    originCountry: payload.originCountry || null,
    originLatitude: payload.originLatitude ?? null,
    originLongitude: payload.originLongitude ?? null,
    destination: payload.destination,
    destinationCity: payload.destinationCity || null,
    destinationCountry: payload.destinationCountry || null,
    destinationRegion: payload.destinationRegion || null,
    destinationLatitude: payload.destinationLatitude ?? null,
    destinationLongitude: payload.destinationLongitude ?? null,
    destinationPlace: payload.destinationPlace || null,
    destinationPlaceId: payload.destinationPlaceId || null,
    destinationStops: payload.destinationStops || [],
    returnToOrigin: payload.returnToOrigin !== false,
    flexibleCityOrder: payload.flexibleCityOrder === true,
    flexibleDates: payload.flexibleDates === true,
    startDate: payload.startDate || null,
    endDate: payload.endDate || null,
    daysCount: payload.daysCount || null,
    travelersCount: payload.travelersCount || 1,
    travelers: payload.travelers || null,
    rooms: payload.rooms || 1,
    bedPreference: payload.bedPreference || "No preference",
    budgetAmount: payload.budgetAmount || null,
    budgetCurrency: payload.budgetCurrency || "CAD",
    budgetIncludesFlights: payload.budgetIncludesFlights !== false,
    budgetIncludesHotel: payload.budgetIncludesHotel !== false,
    budgetIncludesActivities: payload.budgetIncludesActivities !== false,
    travelStyle: payload.travelStyle || "Balanced",
    interests: payload.interests || [],
    pace: payload.pace || "Balanced",
    walkingTolerance: payload.walkingTolerance || "Medium",
    accommodationPreference: payload.accommodationPreference || "Not sure",
    transportationPreference: payload.transportationPreference || "Mixed",
    accessibilityNeeds: payload.accessibilityNeeds || null,
    dietaryPreference: payload.dietaryPreference || null,
    specialNotes: payload.specialNotes || null,
    language: payload.language || "en",
    priceDiscoveryId: payload.priceDiscoveryId || null,
    budgetConstraint: payload.budgetConstraint || null
  };
}

export function getTripDestinationLabel(trip: {
  destination?: unknown;
  destination_name?: unknown;
  metadata?: unknown;
}) {
  const planning = getTripPlanningMetadata(trip.metadata);
  return getString(trip.destination) || getString(trip.destination_name) || getString(planning.destination);
}

export function getTripOriginLabel(trip: { origin?: unknown; metadata?: unknown }) {
  const planning = getTripPlanningMetadata(trip.metadata);
  return getString(trip.origin) || getString(planning.origin);
}

export function getTripDaysCount(trip: { start_date?: unknown; end_date?: unknown; days_count?: unknown; metadata?: unknown }) {
  const planning = getTripPlanningMetadata(trip.metadata);
  const storedDays = getPositiveNumber(trip.days_count) || getPositiveNumber(planning.daysCount) || getPositiveNumber(planning.days_count) || 3;
  const startDate = getString(trip.start_date) || getString(planning.startDate) || getString(planning.start_date);
  const endDate = getString(trip.end_date) || getString(planning.endDate) || getString(planning.end_date);
  return calculateInclusiveTripDays(startDate, endDate, storedDays);
}

export function getTripBudgetAmount(trip: { budget_amount?: unknown; metadata?: unknown }) {
  const planning = getTripPlanningMetadata(trip.metadata);
  return (
    getPositiveNumber(trip.budget_amount) ||
    getPositiveNumber(planning.budgetAmount) ||
    getPositiveNumber(planning.budget_amount) ||
    getPositiveNumber(planning.budget_total)
  );
}

export function getTripBudgetCurrency(trip: { budget_currency?: unknown; metadata?: unknown }) {
  const planning = getTripPlanningMetadata(trip.metadata);
  return getString(trip.budget_currency) || getString(planning.budgetCurrency) || getString(planning.budget_currency) || "CAD";
}
