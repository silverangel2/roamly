import type {
  ActivityConstraints,
  ExplicitTravelRequirement,
  FlightConstraints,
  HotelConstraints,
  TravelConstraints,
  TripPlannerPayload
} from "@/lib/trip-planner";
import { calculateTripDateRange } from "@/lib/roamly/dateUtils";
import { resolveCityPlace } from "@/lib/roamly/placeResolver";

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

function priority(value: unknown): "hard" | "soft" | null {
  return value === "hard" || value === "soft" ? value : null;
}

function constraint<T>(value: unknown, cleanValue: (value: unknown) => T | null) {
  const row = getRecord(value);
  const itemPriority = priority(row?.priority);
  const itemValue = cleanValue(row?.value);
  return itemPriority && itemValue !== null ? { value: itemValue, priority: itemPriority } : undefined;
}

function stringValue(value: unknown) {
  const result = getString(value);
  return result || null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

function timeWindow(value: unknown) {
  const row = getRecord(value);
  const start = stringValue(row?.start);
  const end = stringValue(row?.end);
  return start && end ? { start, end } : null;
}

export function normalizeExplicitRequirements(value: unknown): ExplicitTravelRequirement[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ExplicitTravelRequirement[] => {
    const row = getRecord(item);
    const type = row?.type;
    const itemPriority = priority(row?.priority);
    if (!itemPriority || !["activity", "hotel", "flight"].includes(String(type))) return [];
    const request = stringValue(row?.request);
    if (type === "hotel") return request ? [{ type, request, priority: itemPriority }] : [];
    if (type === "flight") {
      const airline = stringValue(row?.airline);
      const airport = stringValue(row?.airport);
      return airline || airport ? [{ type, priority: itemPriority, ...(airline ? { airline } : {}), ...(airport ? { airport } : {}) }] : [];
    }
    if (!request) return [];
    const date = stringValue(row?.date);
    const time = stringValue(row?.time);
    return [{ type: "activity", request, priority: itemPriority, ...(date ? { date } : {}), ...(time ? { time } : {}) }];
  });
}

export function normalizeTravelConstraints(value: unknown): TravelConstraints | undefined {
  const root = getRecord(value);
  if (!root) return undefined;
  const flightRow = getRecord(root.flight);
  const hotelRow = getRecord(root.hotel);
  const activityRow = getRecord(root.activity);
  const flight: FlightConstraints = {
    origin: constraint(flightRow?.origin, stringValue), destination: constraint(flightRow?.destination, stringValue),
    departureDate: constraint(flightRow?.departureDate, stringValue), returnDate: constraint(flightRow?.returnDate, stringValue),
    travelerCount: constraint(flightRow?.travelerCount, numberValue), cabin: constraint(flightRow?.cabin, stringValue),
    maxStops: constraint(flightRow?.maxStops, numberValue), nonstopRequired: constraint(flightRow?.nonstopRequired, booleanValue),
    departureTimeWindow: constraint(flightRow?.departureTimeWindow, timeWindow),
    arrivalTimeWindow: constraint(flightRow?.arrivalTimeWindow, timeWindow),
    baggageRequirement: constraint(flightRow?.baggageRequirement, stringValue),
    preferredAirlines: stringArray(flightRow?.preferredAirlines) || undefined,
    requiredAirlines: stringArray(flightRow?.requiredAirlines) || undefined,
    excludedAirlines: stringArray(flightRow?.excludedAirlines) || undefined,
    preferredAirports: stringArray(flightRow?.preferredAirports) || undefined,
    requiredAirports: stringArray(flightRow?.requiredAirports) || undefined
  };
  const hotel: HotelConstraints = {
    destination: constraint(hotelRow?.destination, stringValue), checkIn: constraint(hotelRow?.checkIn, stringValue), checkOut: constraint(hotelRow?.checkOut, stringValue),
    travelers: constraint(hotelRow?.travelers, numberValue), rooms: constraint(hotelRow?.rooms, numberValue),
    exactPropertyRequest: constraint(hotelRow?.exactPropertyRequest, stringValue),
    preferredNeighborhood: stringValue(hotelRow?.preferredNeighborhood) || undefined,
    requiredNeighborhood: constraint(hotelRow?.requiredNeighborhood, stringValue), minimumQuality: constraint(hotelRow?.minimumQuality, numberValue),
    maximumNightlyPrice: constraint(hotelRow?.maximumNightlyPrice, numberValue), requiredAmenities: constraint(hotelRow?.requiredAmenities, stringArray),
    preferredAmenities: stringArray(hotelRow?.preferredAmenities) || undefined, parkingRequired: constraint(hotelRow?.parkingRequired, booleanValue),
    accessibilityRequirements: constraint(hotelRow?.accessibilityRequirements, stringArray)
  };
  const activity: ActivityConstraints = {
    explicitRequestedActivities: normalizeExplicitRequirements(activityRow?.explicitRequestedActivities),
    mustDoActivities: normalizeExplicitRequirements(activityRow?.mustDoActivities),
    preferredActivities: stringArray(activityRow?.preferredActivities) || undefined,
    dateConstraints: constraint(activityRow?.dateConstraints, stringArray), timeConstraints: constraint(activityRow?.timeConstraints, stringArray),
    budgetLimit: constraint(activityRow?.budgetLimit, numberValue), accessibilityRequirements: constraint(activityRow?.accessibilityRequirements, stringArray)
  };
  return { flight, hotel, activity };
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
    budgetConstraint: payload.budgetConstraint || null,
    constraints: normalizeTravelConstraints(payload.constraints),
    explicitRequirements: normalizeExplicitRequirements(payload.explicitRequirements)
  };
}

export function getTripDestinationLabel(trip: {
  destination?: unknown;
  destination_name?: unknown;
  metadata?: unknown;
}) {
  const planning = getTripPlanningMetadata(trip.metadata);
  const raw = getString(trip.destination) || getString(trip.destination_name) || getString(planning.destination);
  return resolveCityPlace(raw)?.searchLabel || raw;
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
  const range = calculateTripDateRange(startDate, endDate);
  if (range.ok) return range.days || 1;
  if (range.errorCode === "MISSING_DATES") return storedDays;
  return 0;
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
