import { NextRequest, NextResponse } from "next/server";
import {
  buildBudgetConstraintForItinerary,
  discoverTripPrices,
  savePriceDiscovery
} from "@/lib/roamly/priceDiscovery";
import { getConfirmedBookingCostCents } from "@/lib/roamly/bookings";
import { requireUser } from "@/lib/roamly/auth";
import { normalizeCustomPlace, type NormalizedPlace } from "@/lib/roamly/places";
import type { TripType } from "@/lib/trip-planner";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function getAnyNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getTripType(value: unknown): TripType {
  return value === "multi_city" ? "multi_city" : "single_destination";
}

function cleanPlace(value: unknown): NormalizedPlace | undefined {
  if (typeof value === "string" && value.trim().length >= 2) return normalizeCustomPlace(value);
  const record = getRecord(value);
  if (!record) return undefined;
  const label = getString(record.label || record.value || record.formatted_address);
  const placeValue = getString(record.value || record.label || record.formatted_address);
  if (placeValue.length < 2 && label.length < 2) return undefined;
  return {
    label: label || placeValue,
    value: placeValue || label,
    city: getString(record.city) || undefined,
    region: getString(record.region) || undefined,
    country: getString(record.country) || undefined,
    place_id: getString(record.place_id || record.placeId) || undefined,
    latitude: getAnyNumber(record.latitude) ?? undefined,
    longitude: getAnyNumber(record.longitude) ?? undefined,
    formatted_address: getString(record.formatted_address || record.formattedAddress) || undefined,
    currency: getString(record.currency) || undefined,
    timezone: getString(record.timezone) || undefined,
    source: record.source === "google" || record.source === "local" ? record.source : "custom"
  };
}

function cleanStops(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanPlace).filter((place): place is NormalizedPlace => Boolean(place)).slice(0, 12);
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripType = getTripType(body.tripType || body.trip_type);
  const destinationStops = cleanStops(body.destinationStops || body.destination_stops);
  const destination =
    tripType === "multi_city" && destinationStops.length
      ? destinationStops.map((place) => place.value).join(" \u2192 ")
      : getString(body.destination);
  if (!destination) return NextResponse.json({ ok: false, error: "Destination is required." }, { status: 400 });

  const tripId = getString(body.tripId) || null;
  let committedBudgetCents = 0;
  if (tripId) {
    const cost = await getConfirmedBookingCostCents(auth.supabase, auth.user.id, tripId);
    committedBudgetCents = cost.amountCents;
  }

  const input = {
    userId: auth.user.id,
    tripId,
    tripType,
    origin: getString(body.origin),
    originPlace: cleanPlace(body.originPlace || body.origin_place),
    destination,
    destinationPlace: cleanPlace(body.destinationPlace || body.destination_place),
    destinationStops: tripType === "multi_city" ? destinationStops : undefined,
    returnToOrigin: body.returnToOrigin !== false && body.return_to_origin !== false,
    flexibleCityOrder: body.flexibleCityOrder === true || body.flexible_city_order === true,
    flexibleDates: body.flexibleDates === true || body.flexible_dates === true,
    startDate: getString(body.startDate),
    endDate: getString(body.endDate),
    daysCount: getNumber(body.daysCount),
    travelersCount: getNumber(body.travelersCount),
    travelers: getRecord(body.travelers) || undefined,
    rooms: getNumber(body.rooms),
    bedPreference: getString(body.bedPreference || body.bed_preference),
    budgetAmount: getNumber(body.budgetAmount),
    budgetCurrency: getString(body.budgetCurrency) || "CAD",
    budgetIncludesFlights: body.budgetIncludesFlights !== false,
    budgetIncludesHotel: body.budgetIncludesHotel !== false,
    budgetIncludesActivities: body.budgetIncludesActivities !== false,
    committedBudgetCents,
    accommodationPreference: getString(body.accommodationPreference),
    travelStyle: getString(body.travelStyle),
    interests: Array.isArray(body.interests) ? body.interests.filter((item): item is string => typeof item === "string") : [],
    pace: getString(body.pace),
    walkingTolerance: getString(body.walkingTolerance || body.walking_tolerance),
    transportationPreference: getString(body.transportationPreference),
    accessibilityNeeds: getString(body.accessibilityNeeds || body.accessibility_needs),
    dietaryPreference: getString(body.dietaryPreference || body.dietary_preference)
  };

  const discovery = await discoverTripPrices(input);
  const saved = await savePriceDiscovery(auth.supabase, input, discovery);

  if (saved.error) {
    return NextResponse.json(
      { ok: false, error: saved.error, setupHint: "Run the Roamly budget/booking/companion migration." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    discoveryId: saved.id,
    discovery,
    budgetConstraint: buildBudgetConstraintForItinerary(discovery)
  });
}
