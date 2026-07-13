import { NextRequest, NextResponse } from "next/server";
import { normalizeLocale } from "@/lib/i18n";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { requireUser } from "@/lib/roamly/auth";
import { calculateTripDateRange, type TripDateRangeResult } from "@/lib/roamly/dateUtils";
import { recordAppEvent } from "@/lib/roamly/events";
import { normalizeCustomPlace, type NormalizedPlace } from "@/lib/roamly/places";
import { buildTripPlanningMetadata } from "@/lib/roamly/tripMetadata";
import type { TravelerDetails, TripPlannerPayload, TripType } from "@/lib/trip-planner";
import { isMissingTableError } from "@/lib/trips";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getPositiveNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getTripType(value: unknown): TripType {
  return value === "multi_city" ? "multi_city" : "single_destination";
}

function cleanTextArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
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
    latitude: getNumber(record.latitude) ?? undefined,
    longitude: getNumber(record.longitude) ?? undefined,
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

function cleanTravelers(value: unknown, travelersCount: number): TravelerDetails {
  const record = getRecord(value);
  const adults = Math.max(1, Math.round(getPositiveNumber(record?.adults) || travelersCount || 1));
  const children = Math.max(0, Math.round(getNumber(record?.children) || 0));
  const infants = Math.max(0, Math.round(getNumber(record?.infants) || 0));
  return { adults, children, infants };
}

function cleanPayload(body: Record<string, unknown>): TripPlannerPayload {
  const startDate = getString(body.startDate || body.start_date);
  const endDate = getString(body.endDate || body.end_date);
  const explicitDays = getPositiveNumber(body.daysCount ?? body.days_count);
  const dateRange = calculateTripDateRange(startDate, endDate);
  const resolvedDaysCount = dateRange.ok ? dateRange.days || 1 : dateRange.errorCode === "MISSING_DATES" ? explicitDays ?? 3 : 0;
  const tripType = getTripType(body.tripType || body.trip_type);
  const destinationStops = cleanStops(body.destinationStops || body.destination_stops);
  const destinationPlace = cleanPlace(body.destinationPlace || body.destination_place);
  const originPlace = cleanPlace(body.originPlace || body.origin_place);
  const destination =
    tripType === "multi_city" && destinationStops.length
      ? destinationStops.map((place) => place.value).join(" -> ")
      : getString(body.destination) || destinationPlace?.value || "";
  const travelersCount = getPositiveNumber(body.travelersCount ?? body.travelers_count) || 1;
  const travelers = cleanTravelers(
    getRecord(body.travelers) || {
      adults: getPositiveNumber(body.adults) || travelersCount,
      children: getNumber(body.children) || 0,
      infants: getNumber(body.infants) || 0
    },
    travelersCount
  );

  return {
    tripType,
    origin: getString(body.origin) || originPlace?.value || "",
    originPlaceId: getString(body.originPlaceId || body.origin_place_id || originPlace?.place_id) || undefined,
    originCity: getString(body.originCity || body.origin_city || originPlace?.city) || undefined,
    originRegion: getString(body.originRegion || body.origin_region || originPlace?.region) || undefined,
    originCountry: getString(body.originCountry || body.origin_country || originPlace?.country) || undefined,
    originLatitude: getNumber(body.originLatitude ?? body.origin_latitude ?? originPlace?.latitude) ?? undefined,
    originLongitude: getNumber(body.originLongitude ?? body.origin_longitude ?? originPlace?.longitude) ?? undefined,
    originPlace,
    destination,
    destinationPlaceId: getString(body.destinationPlaceId || body.destination_place_id || destinationPlace?.place_id) || undefined,
    destinationCity: getString(body.destinationCity || body.destination_city || destinationPlace?.city || destinationStops.at(-1)?.city) || undefined,
    destinationCountry:
      getString(body.destinationCountry || body.destination_country || destinationPlace?.country || destinationStops.at(-1)?.country) || undefined,
    destinationRegion:
      getString(body.destinationRegion || body.destination_region || destinationPlace?.region || destinationStops.at(-1)?.region) || undefined,
    destinationLatitude: getNumber(body.destinationLatitude ?? body.destination_latitude ?? destinationPlace?.latitude ?? destinationStops.at(-1)?.latitude) ?? undefined,
    destinationLongitude:
      getNumber(body.destinationLongitude ?? body.destination_longitude ?? destinationPlace?.longitude ?? destinationStops.at(-1)?.longitude) ?? undefined,
    destinationPlace,
    destinationStops: tripType === "multi_city" ? destinationStops : undefined,
    returnToOrigin: getBoolean(body.returnToOrigin ?? body.return_to_origin, true),
    flexibleCityOrder: getBoolean(body.flexibleCityOrder ?? body.flexible_city_order, false),
    flexibleDates: getBoolean(body.flexibleDates ?? body.flexible_dates, false),
    startDate,
    endDate,
    daysCount: resolvedDaysCount,
    travelersCount: travelers.adults + travelers.children + (travelers.infants || 0),
    travelers,
    rooms: getPositiveNumber(body.rooms) || 1,
    bedPreference: getString(body.bedPreference || body.bed_preference) || "No preference",
    budgetAmount: getPositiveNumber(body.budgetAmount ?? body.budget_total),
    budgetCurrency: getString(body.budgetCurrency || body.budget_currency) || "CAD",
    budgetIncludesFlights: body.budgetIncludesFlights !== false && body.budget_includes_flights !== false,
    budgetIncludesHotel: body.budgetIncludesHotel !== false && body.budget_includes_hotel !== false,
    budgetIncludesActivities: body.budgetIncludesActivities !== false && body.budget_includes_activities !== false,
    travelStyle: getString(body.travelStyle || body.travel_style) || "Balanced",
    interests: cleanTextArray(body.interests),
    pace: getString(body.pace) || "Balanced",
    walkingTolerance: getString(body.walkingTolerance || body.walking_tolerance) || "Medium",
    accommodationPreference: getString(body.accommodationPreference) || "Not sure",
    transportationPreference: getString(body.transportationPreference) || "Mixed",
    accessibilityNeeds: getString(body.accessibilityNeeds || body.accessibility_needs),
    dietaryPreference: getString(body.dietaryPreference || body.dietary_preference),
    specialNotes: getString(body.specialNotes || body.special_notes),
    language: normalizeLocale(getString(body.language)),
    priceDiscoveryId: getString(body.priceDiscoveryId) || null,
    budgetConstraint: getString(body.budgetConstraint)
  };
}

function validatePayload(payload: TripPlannerPayload) {
  if (!payload.origin || payload.origin.trim().length < 2) return "Please choose or enter your origin before continuing.";
  if (!payload.destination || payload.destination.trim().length < 2) return "Please choose or enter a destination before continuing.";
  if (payload.tripType === "multi_city" && (!payload.destinationStops || payload.destinationStops.length < 2)) {
    return "Please add at least two cities for a multi-city trip.";
  }
  const dateRange = calculateTripDateRange(payload.startDate, payload.endDate);
  if (!dateRange.ok) return dateRange;
  if (!payload.budgetAmount) return "Budget amount is required.";
  return "";
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
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const payload = cleanPayload(body);
  const validation = validatePayload(payload);
  if (typeof validation === "object") return invalidTripDatesResponse(validation);
  if (validation) return NextResponse.json({ ok: false, error: validation }, { status: 400 });

  const access = getRoamlyAccessForUser(auth.user.email);
  const title = `${payload.destination} ${payload.daysCount}-day itinerary`;
  const planningMetadata = buildTripPlanningMetadata(payload);

  try {
    const { data: trip, error: insertError } = await auth.supabase
      .from("roamly_trips")
      .insert({
        user_id: auth.user.id,
        title,
        destination_name: payload.destination,
        destination_city: payload.destinationCity || null,
        destination_country: payload.destinationCountry || null,
        destination_region: payload.destinationRegion || null,
        start_date: payload.startDate || null,
        end_date: payload.endDate || null,
        days_count: payload.daysCount,
        status: "draft",
        itinerary_status: "draft",
        itinerary_locked: false,
        itinerary_payment_status: "unpaid",
        tracking_unlocked: false,
        metadata: {
          planning: planningMetadata,
          ...(access.hasQaAccess ? { qa_tester: true, qa_access_role: access.role } : {})
        }
      })
      .select("id")
      .single();

    if (insertError) {
      return NextResponse.json(
        {
          ok: false,
          error: insertError.message,
          setupHint: "Run the Roamly Supabase migrations before saving itinerary drafts."
        },
        { status: 500 }
      );
    }

    await recordAppEvent(auth.supabase, {
      userId: auth.user.id,
      eventType: "trip_draft_created",
      metadata: {
        tripId: trip.id,
        destination: payload.destination,
        source: "planner_checkout"
      }
    });

    return NextResponse.json(
      {
        ok: true,
        tripId: trip.id,
        previewUrl: `/trip/${trip.id}`
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trip draft could not be saved.";
    await recordAppEvent(auth.supabase, {
      userId: auth.user.id,
      eventType: "trip_draft_failed",
      metadata: {
        destination: payload.destination,
        error: message
      }
    });
    return NextResponse.json(
      {
        ok: false,
        error: message,
        setupHint: isMissingTableError(message) ? "Run supabase/migrations/20260705_roamly_itinerary_locking.sql." : undefined
      },
      { status: 500 }
    );
  }
}
