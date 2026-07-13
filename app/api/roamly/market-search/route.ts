import { NextRequest, NextResponse } from "next/server";
import { enrichItineraryBookingSuggestions } from "@/lib/roamly/affiliateLinks";
import { requireUser } from "@/lib/roamly/auth";
import { getConfirmedBookingCostCents, getConfirmedBookingsForItinerary } from "@/lib/roamly/bookings";
import { calculateTripDateRange } from "@/lib/roamly/dateUtils";
import {
  applyPriceDiscoveryToItinerary,
  buildBudgetConstraintForItinerary,
  discoverTripPrices,
  savePriceDiscovery
} from "@/lib/roamly/priceDiscovery";
import {
  searchTravelMarket,
  searchTripMarketPrices,
  type TravelMarketCategory,
  type TravelMarketSearchRequest
} from "@/lib/roamly/travelMarketSearch";
import {
  getTripBudgetAmount,
  getTripBudgetCurrency,
  getTripDestinationLabel,
  getTripOriginLabel,
  getTripPlanningMetadata
} from "@/lib/roamly/tripMetadata";
import type { TravelerDetails, TripPlannerPayload, TripType } from "@/lib/trip-planner";
import { getTripBundle, isMissingTableError, syncGeneratedItinerary, type RoamlyTripRecord } from "@/lib/trips";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function positiveNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function category(value: unknown): TravelMarketCategory | null {
  if (value === "flight" || value === "hotel" || value === "attraction" || value === "tour" || value === "transport") return value;
  return null;
}

function tripType(value: unknown): TripType {
  return value === "multi_city" ? "multi_city" : "single_destination";
}

function tripTravelers(trip: RoamlyTripRecord): TravelerDetails {
  const planning = getTripPlanningMetadata(trip.metadata);
  const travelers = getRecord(planning.travelers);
  const travelersCount = positiveNumber(trip.travelers_count, positiveNumber(planning.travelersCount, 1));
  return {
    adults: Math.max(1, Math.round(positiveNumber(travelers.adults, travelersCount || 1))),
    children: Math.max(0, Math.round(positiveNumber(travelers.children, 0))),
    infants: Math.max(0, Math.round(positiveNumber(travelers.infants, 0)))
  };
}

function payloadFromTrip(trip: RoamlyTripRecord): TripPlannerPayload {
  const planning = getTripPlanningMetadata(trip.metadata);
  const travelers = tripTravelers(trip);
  const startDate = trip.start_date || getString(planning.startDate || planning.start_date);
  const endDate = trip.end_date || getString(planning.endDate || planning.end_date);
  const dateRange = calculateTripDateRange(startDate, endDate);
  return {
    tripType: tripType(planning.tripType || planning.trip_type),
    origin: getTripOriginLabel(trip),
    destination: getTripDestinationLabel(trip),
    destinationCity: getString(trip.destination_city || planning.destinationCity || planning.destination_city),
    destinationCountry: getString(trip.destination_country || planning.destinationCountry || planning.destination_country),
    destinationRegion: getString(trip.destination_region || planning.destinationRegion || planning.destination_region),
    destinationStops: Array.isArray(planning.destinationStops) ? (planning.destinationStops as TripPlannerPayload["destinationStops"]) : undefined,
    returnToOrigin: planning.returnToOrigin !== false && planning.return_to_origin !== false,
    flexibleCityOrder: planning.flexibleCityOrder === true || planning.flexible_city_order === true,
    flexibleDates: planning.flexibleDates === true || planning.flexible_dates === true,
    startDate,
    endDate,
    daysCount:
      dateRange.ok
        ? dateRange.days || 1
        : dateRange.errorCode === "MISSING_DATES"
          ? positiveNumber(trip.days_count, positiveNumber(planning.daysCount, 3))
          : 0,
    travelersCount: travelers.adults + travelers.children + (travelers.infants || 0),
    travelers,
    rooms: positiveNumber(planning.rooms, 1),
    bedPreference: getString(planning.bedPreference || planning.bed_preference) || "No preference",
    budgetAmount: getTripBudgetAmount(trip),
    budgetCurrency: getTripBudgetCurrency(trip),
    budgetIncludesFlights: trip.budget_includes_flights !== false && planning.budgetIncludesFlights !== false,
    budgetIncludesHotel: trip.budget_includes_hotel !== false && planning.budgetIncludesHotel !== false,
    budgetIncludesActivities: planning.budgetIncludesActivities !== false && planning.budget_includes_activities !== false,
    travelStyle: getString(trip.travel_style || planning.travelStyle || planning.travel_style) || "Balanced",
    interests: Array.isArray(trip.interests)
      ? trip.interests.filter((item): item is string => typeof item === "string")
      : Array.isArray(planning.interests)
        ? planning.interests.filter((item): item is string => typeof item === "string")
        : [],
    pace: getString(planning.pace) || "Balanced",
    walkingTolerance: getString(planning.walkingTolerance || planning.walking_tolerance) || "Medium",
    accommodationPreference: getString(trip.accommodation_preference || planning.accommodationPreference || planning.accommodation_preference) || "Not sure",
    transportationPreference: getString(trip.transportation_preference || planning.transportationPreference || planning.transportation_preference) || "Mixed",
    accessibilityNeeds: getString(planning.accessibilityNeeds || planning.accessibility_needs),
    dietaryPreference: getString(planning.dietaryPreference || planning.dietary_preference),
    specialNotes: getString(trip.special_notes || planning.specialNotes || planning.special_notes),
    language: getString(planning.language) || "en"
  };
}

function requestFromBody(body: Record<string, unknown>): TravelMarketSearchRequest | null {
  const parsedCategory = category(body.category);
  if (!parsedCategory) return null;
  return {
    category: parsedCategory,
    origin: getString(body.origin),
    destination: getString(body.destination),
    city: getString(body.city),
    country: getString(body.country),
    start_date: getString(body.start_date || body.startDate || body.date),
    end_date: getString(body.end_date || body.endDate),
    travelers: positiveNumber(body.travelers, 1),
    rooms: positiveNumber(body.rooms, 1),
    room_type: getString(body.room_type || body.roomType),
    title: getString(body.title || body.query),
    currency: getString(body.currency) || "CAD"
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = getString(body.trip_id || body.tripId);
  const forceRefresh = body.force_refresh === true || body.forceRefresh === true;

  if (!tripId) {
    const marketRequest = requestFromBody(body);
    if (!marketRequest) return NextResponse.json({ ok: false, error: "A valid category is required." }, { status: 400 });
    const response = await searchTravelMarket(marketRequest, {
      supabase: auth.supabase,
      forceRefresh,
      store: true
    });
    return NextResponse.json({ ok: true, ...response });
  }

  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data) {
    if (isMissingTableError(bundle.error)) return NextResponse.json({ ok: false, error: "Trip tables are not ready." }, { status: 503 });
    return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  }

  const { trip, itinerary } = bundle.data;
  const payload = payloadFromTrip(trip);
  const dateRange = calculateTripDateRange(payload.startDate, payload.endDate);
  if (!dateRange.ok) {
    const message =
      dateRange.errorCode === "END_BEFORE_START"
        ? "End date must be after or the same as the start date."
        : dateRange.errorCode === "INVALID_DATES"
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
  const [marketSearch, committed, confirmedBookings] = await Promise.all([
    searchTripMarketPrices(payload, { supabase: auth.supabase, forceRefresh, store: true }),
    getConfirmedBookingCostCents(auth.supabase, auth.user.id, tripId),
    getConfirmedBookingsForItinerary(auth.supabase, auth.user.id, tripId)
  ]);
  const discovery = await discoverTripPrices({
    userId: auth.user.id,
    tripId,
    ...payload,
    committedBudgetCents: committed.amountCents,
    confirmedBookings: confirmedBookings.bookings,
    marketResults: marketSearch.results
  });
  const savedDiscovery = await savePriceDiscovery(auth.supabase, { userId: auth.user.id, tripId, ...payload }, discovery);
  const full = itinerary?.full_json || null;
  const updatedItinerary = full
    ? enrichItineraryBookingSuggestions(
        applyPriceDiscoveryToItinerary(full, discovery),
        {
          ...payload,
          priceDiscoveryId: savedDiscovery.id || payload.priceDiscoveryId || null,
          budgetConstraint: buildBudgetConstraintForItinerary(discovery),
          priceDiscovery: discovery as unknown as Record<string, unknown>,
          confirmedBookings: confirmedBookings.bookings
        }
      )
    : null;

  if (updatedItinerary) {
    await syncGeneratedItinerary(auth.supabase, {
      tripId,
      userId: auth.user.id,
      itinerary: updatedItinerary,
      status: "locked"
    });
  }

  return NextResponse.json({
    ok: true,
    tripId,
    results: marketSearch.results,
    warnings: marketSearch.providerWarnings,
    discovery,
    discoveryId: savedDiscovery.id,
    updated: Boolean(updatedItinerary)
  });
}
