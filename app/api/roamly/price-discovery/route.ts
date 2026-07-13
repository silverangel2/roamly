import { NextRequest, NextResponse } from "next/server";
import {
  buildBudgetConstraintForItinerary,
  discoverTripPrices
} from "@/lib/roamly/priceDiscovery";
import { normalizeLocale } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/roamly/auth";
import { calculateTripDateRange, type TripDateRangeResult } from "@/lib/roamly/dateUtils";
import { normalizeCustomPlace, type NormalizedPlace } from "@/lib/roamly/places";
import { searchTripMarketPrices } from "@/lib/roamly/travelMarketSearch";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

function invalidTripDatesResponse(range: TripDateRangeResult) {
  const message =
    range.errorCode === "END_BEFORE_START"
      ? "End date must be after or the same as the start date."
      : range.errorCode === "INVALID_DATES"
        ? "Enter valid start and end dates."
        : "Start date and end date are required.";

  return NextResponse.json(
    {
      ok: false,
      code: "INVALID_TRIP_DATES",
      message,
      error: message
    },
    { status: 400 }
  );
}

export async function POST(request: NextRequest) {
  const auth = await getCurrentUser();

  const currentUser = auth.user;

  if (process.env.NODE_ENV === "development" && !currentUser) {
    console.warn("[Roamly] Price discovery running anonymously before final generation");
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripType = getTripType(body.tripType || body.trip_type);
  const destinationStops = cleanStops(body.destinationStops || body.destination_stops);
  const destination =
    tripType === "multi_city" && destinationStops.length
      ? destinationStops.map((place) => place.value).join(" \u2192 ")
      : getString(body.destination);
  if (!destination) return NextResponse.json({ ok: false, error: "Destination is required." }, { status: 400 });

  const tripId = getString(body.tripId) || null;
  const startDate = getString(body.startDate || body.start_date);
  const endDate = getString(body.endDate || body.end_date);
  const dateRange = calculateTripDateRange(startDate, endDate);
  if (!dateRange.ok) return invalidTripDatesResponse(dateRange);
  const daysCount = dateRange.days || 1;
  // Keep anonymous budget checks working. Confirmed booking costs are applied later
  // in authenticated trip generation/saved-trip flows.
  const committedBudgetCents = 0;

  const input = {
    userId: auth.user?.id,
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
    startDate,
    endDate,
    daysCount,
    travelersCount: getNumber(body.travelersCount ?? body.travelers_count),
    travelers: getRecord(body.travelers) || {
      adults: getNumber(body.adults) || 1,
      children: getAnyNumber(body.children) || 0,
      infants: getAnyNumber(body.infants) || 0
    },
    rooms: getNumber(body.rooms),
    bedPreference: getString(body.bedPreference || body.bed_preference),
    budgetAmount: getNumber(body.budgetAmount ?? body.budget_total),
    budgetCurrency: getString(body.budgetCurrency || body.budget_currency) || "CAD",
    budgetIncludesFlights: body.budgetIncludesFlights !== false && body.budget_includes_flights !== false,
    budgetIncludesHotel: body.budgetIncludesHotel !== false && body.budget_includes_hotel !== false,
    budgetIncludesActivities: body.budgetIncludesActivities !== false && body.budget_includes_activities !== false,
    committedBudgetCents,
    accommodationPreference: getString(body.accommodationPreference),
    travelStyle: getString(body.travelStyle || body.travel_style),
    interests: Array.isArray(body.interests) ? body.interests.filter((item): item is string => typeof item === "string") : [],
    pace: getString(body.pace),
    walkingTolerance: getString(body.walkingTolerance || body.walking_tolerance),
    transportationPreference: getString(body.transportationPreference),
    accessibilityNeeds: getString(body.accessibilityNeeds || body.accessibility_needs),
    dietaryPreference: getString(body.dietaryPreference || body.dietary_preference)
  };

  let discovery;
  try {
    const supabase = await createSupabaseServerClient();
    const marketSearch = await searchTripMarketPrices(
      {
        ...input,
        destinationStops: input.destinationStops,
        travelers: {
          adults: getNumber((input.travelers as Record<string, unknown>).adults) || 1,
          children: getAnyNumber((input.travelers as Record<string, unknown>).children) || 0,
          infants: getAnyNumber((input.travelers as Record<string, unknown>).infants) || 0
        },
        specialNotes: "",
        language: normalizeLocale(getString(body.language))
      },
      { supabase, store: true }
    );
    discovery = await discoverTripPrices({
      ...input,
      marketResults: marketSearch.results
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Price discovery failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    discoveryId: null,
    discovery,
    budgetConstraint: buildBudgetConstraintForItinerary(discovery)
  });
}
