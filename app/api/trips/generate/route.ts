import { NextRequest, NextResponse } from "next/server";
import {
  generateRoamlyItinerary,
  RoamlyItineraryGenerationError
} from "@/lib/ai/roamly-itinerary";
import { buildPreviewFromItinerary } from "@/lib/itinerary";
import { normalizeLocale } from "@/lib/i18n";
import { getConfirmedBookingCostCents, getConfirmedBookingsForItinerary } from "@/lib/roamly/bookings";
import {
  canGenerateFinalItinerary,
  lockGeneratedItinerary,
  markTripAsQaTester,
  markFreeItineraryUsed,
  requireTripEditable
} from "@/lib/roamly/billing";
import { requireUser } from "@/lib/roamly/auth";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import {
  buildBudgetConstraintForItinerary,
  discoverTripPrices,
  savePriceDiscovery
} from "@/lib/roamly/priceDiscovery";
import { recordAppEvent, recordTripEvent } from "@/lib/roamly/events";
import { unlockLiveCompanion } from "@/lib/roamly/tripCompanion";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMissingTableError, syncGeneratedItinerary } from "@/lib/trips";
import { normalizeCustomPlace, type NormalizedPlace } from "@/lib/roamly/places";
import { buildTripPlanningMetadata, getTripPlanningMetadata } from "@/lib/roamly/tripMetadata";
import type { TravelerDetails, TripPlannerPayload, TripType } from "@/lib/trip-planner";

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

function getFirstString(...values: unknown[]) {
  for (const value of values) {
    const stringValue = getString(value);
    if (stringValue) return stringValue;
  }
  return "";
}

function getFirstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const numberValue = getPositiveNumber(value);
    if (numberValue) return numberValue;
  }
  return null;
}

function getFirstBoolean(fallback: boolean, ...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return fallback;
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

function daysBetween(startDate: string, endDate: string) {
  if (!startDate || !endDate) return null;

  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function cleanPayload(body: Record<string, unknown>): TripPlannerPayload {
  const startDate = getString(body.startDate || body.start_date);
  const endDate = getString(body.endDate || body.end_date);
  const explicitDays = getPositiveNumber(body.daysCount ?? body.days_count);
  const resolvedDaysCount = explicitDays ?? daysBetween(startDate, endDate) ?? 3;
  const tripType = getTripType(body.tripType || body.trip_type);
  const destinationStops = cleanStops(body.destinationStops || body.destination_stops);
  const destinationPlace = cleanPlace(body.destinationPlace || body.destination_place);
  const originPlace = cleanPlace(body.originPlace || body.origin_place);
  const destination =
    tripType === "multi_city" && destinationStops.length
      ? destinationStops.map((place) => place.value).join(" \u2192 ")
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
    specialNotes: getString(body.specialNotes),
    language: normalizeLocale(getString(body.language)),
    priceDiscoveryId: getString(body.priceDiscoveryId) || null,
    budgetConstraint: getString(body.budgetConstraint)
  };
}

function payloadFromTrip(trip: Record<string, unknown>, language = "en"): TripPlannerPayload {
  const planning = getTripPlanningMetadata(trip.metadata);
  const destinationStops = cleanStops(planning.destinationStops || planning.destination_stops);
  const tripType = getTripType(planning.tripType || planning.trip_type || (destinationStops.length >= 2 ? "multi_city" : "single_destination"));
  const travelersCount = getFirstPositiveNumber(trip.travelers_count, planning.travelersCount, planning.travelers_count) || 1;
  const travelers = cleanTravelers(planning.travelers, travelersCount);
  const startDate = getFirstString(trip.start_date, planning.startDate, planning.start_date);
  const endDate = getFirstString(trip.end_date, planning.endDate, planning.end_date);
  const daysCount = getFirstPositiveNumber(trip.days_count, planning.daysCount, planning.days_count) || daysBetween(startDate, endDate) || 3;

  return {
    tripType,
    origin: getFirstString(trip.origin, planning.origin),
    originPlaceId: getString(planning.originPlaceId || planning.origin_place_id) || undefined,
    originCity: getString(planning.originCity || planning.origin_city) || undefined,
    originRegion: getString(planning.originRegion || planning.origin_region) || undefined,
    originCountry: getString(planning.originCountry || planning.origin_country) || undefined,
    originLatitude: getNumber(planning.originLatitude ?? planning.origin_latitude) ?? undefined,
    originLongitude: getNumber(planning.originLongitude ?? planning.origin_longitude) ?? undefined,
    originPlace: cleanPlace(planning.originPlace || planning.origin_place),
    destination: getFirstString(trip.destination, trip.destination_name, planning.destination),
    destinationCity: getFirstString(trip.destination_city, planning.destinationCity, planning.destination_city),
    destinationCountry: getFirstString(trip.destination_country, planning.destinationCountry, planning.destination_country),
    destinationRegion: getFirstString(trip.destination_region, planning.destinationRegion, planning.destination_region),
    destinationPlace: cleanPlace(planning.destinationPlace || planning.destination_place),
    destinationStops: tripType === "multi_city" ? destinationStops : undefined,
    returnToOrigin: getBoolean(planning.returnToOrigin ?? planning.return_to_origin, true),
    flexibleCityOrder: getBoolean(planning.flexibleCityOrder ?? planning.flexible_city_order, false),
    flexibleDates: getBoolean(planning.flexibleDates ?? planning.flexible_dates, false),
    startDate,
    endDate,
    daysCount,
    travelersCount: travelers.adults + travelers.children + (travelers.infants || 0),
    travelers,
    rooms: getPositiveNumber(planning.rooms) || 1,
    bedPreference: getString(planning.bedPreference || planning.bed_preference) || "No preference",
    budgetAmount: getFirstPositiveNumber(trip.budget_amount, planning.budgetAmount, planning.budget_amount, planning.budget_total) || 1,
    budgetCurrency: getFirstString(trip.budget_currency, planning.budgetCurrency, planning.budget_currency) || "CAD",
    budgetIncludesFlights: getFirstBoolean(true, trip.budget_includes_flights, planning.budgetIncludesFlights, planning.budget_includes_flights),
    budgetIncludesHotel: getFirstBoolean(true, trip.budget_includes_hotel, planning.budgetIncludesHotel, planning.budget_includes_hotel),
    budgetIncludesActivities: getBoolean(planning.budgetIncludesActivities ?? planning.budget_includes_activities, true),
    travelStyle: getFirstString(trip.travel_style, planning.travelStyle, planning.travel_style) || "Balanced",
    interests: Array.isArray(trip.interests) ? cleanTextArray(trip.interests) : cleanTextArray(planning.interests),
    pace: getString(planning.pace) || "Balanced",
    walkingTolerance: getString(planning.walkingTolerance || planning.walking_tolerance) || "Medium",
    accommodationPreference: getFirstString(trip.accommodation_preference, planning.accommodationPreference, planning.accommodation_preference) || "Not sure",
    transportationPreference: getFirstString(trip.transportation_preference, planning.transportationPreference, planning.transportation_preference) || "Mixed",
    accessibilityNeeds: getString(planning.accessibilityNeeds || planning.accessibility_needs),
    dietaryPreference: getString(planning.dietaryPreference || planning.dietary_preference),
    specialNotes: getFirstString(trip.special_notes, planning.specialNotes, planning.special_notes),
    language: normalizeLocale(language),
    priceDiscoveryId: getFirstString(trip.latest_price_discovery_id, planning.priceDiscoveryId, planning.price_discovery_id) || null
  };
}

function validatePayload(payload: TripPlannerPayload) {
  if (!payload.origin || payload.origin.trim().length < 2) return "Please choose or enter your origin before continuing.";
  if (!payload.destination || payload.destination.trim().length < 2) return "Please choose or enter a destination before continuing.";
  if (payload.tripType === "multi_city" && (!payload.destinationStops || payload.destinationStops.length < 2)) {
    return "Please add at least two cities for a multi-city trip.";
  }
  if (!payload.budgetAmount) return "Budget amount is required.";
  return "";
}

function paymentRequiredResponse(tripId: string, message?: string) {
  return NextResponse.json(
    {
      ok: false,
      error: "PAYMENT_REQUIRED",
      message: message || "You’ve used your free itinerary. Unlock this trip to generate a new full itinerary.",
      tripId,
      previewUrl: `/trip/${tripId}?payment=required`,
      checkout: {
        itinerary: "/api/stripe/checkout/itinerary",
        features: "/api/stripe/checkout/features",
        completeTrip: "/api/stripe/checkout/complete-trip",
        bundle: "/api/stripe/checkout/bundle"
      }
    },
    { status: 402 }
  );
}

async function clearGeneratedTripArtifacts(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  userId: string,
  tripId: string
) {
  await Promise.all([
    supabase.from("roamly_itineraries").delete().eq("trip_id", tripId).eq("user_id", userId),
    supabase.from("roamly_itinerary_days").delete().eq("trip_id", tripId),
    supabase.from("roamly_trip_activities").delete().eq("trip_id", tripId),
    supabase.from("roamly_trip_checklists").delete().eq("trip_id", tripId).eq("user_id", userId),
    supabase.from("roamly_trip_days").delete().eq("trip_id", tripId).then((result) => {
      if (result.error && !isMissingTableError(result.error.message)) console.error(result.error.message);
      return result;
    }),
    supabase.from("roamly_activities").delete().eq("trip_id", tripId).then((result) => {
      if (result.error && !isMissingTableError(result.error.message)) console.error(result.error.message);
      return result;
    })
  ]);
}

async function finalizeItinerary(params: {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  userId: string;
  userEmail?: string | null;
  tripId: string;
  payload: TripPlannerPayload;
}) {
  const access = getRoamlyAccessForUser(params.userEmail);
  const canGenerate = await canGenerateFinalItinerary(params.supabase, params.userId, params.tripId, params.userEmail);

  if (!canGenerate.ok) {
    await recordAppEvent(params.supabase, {
      userId: params.userId,
      eventType: "itinerary_generation_failed",
      metadata: {
        tripId: params.tripId,
        destination: params.payload.destination,
        error: canGenerate.error
      }
    });
    if (canGenerate.error === "PAYMENT_REQUIRED" && canGenerate.trip?.id) {
      await params.supabase
        .from("roamly_trips")
        .update({ status: "payment_required", itinerary_status: "payment_required" })
        .eq("id", params.tripId)
        .eq("user_id", params.userId);
      return paymentRequiredResponse(params.tripId, canGenerate.message);
    }

    return NextResponse.json(
      {
        ok: false,
        error: canGenerate.error,
        message: "message" in canGenerate ? canGenerate.message : undefined
      },
      { status: canGenerate.status || 500 }
    );
  }

  const qaTester = access.hasQaAccess || ("qaTester" in canGenerate && canGenerate.qaTester === true);
  if (qaTester) {
    await markTripAsQaTester(params.supabase, params.userId, params.tripId, {
      qa_access_role: access.role,
      qa_generation: true
    });
  }

  await params.supabase
    .from("roamly_trips")
    .update({ status: "generating", itinerary_status: "generating" })
    .eq("id", params.tripId)
    .eq("user_id", params.userId);
  await recordTripEvent(params.supabase, {
    userId: params.userId,
    tripId: params.tripId,
    eventType: "itinerary_generation_started",
    eventTitle: "Itinerary generation started",
    metadata: {
      tripType: params.payload.tripType || "single_destination",
      destination: params.payload.destination,
      stops: params.payload.destinationStops || [],
      qa_tester: qaTester
    }
  });

  const [committed, confirmedBookings] = await Promise.all([
    getConfirmedBookingCostCents(params.supabase, params.userId, params.tripId),
    getConfirmedBookingsForItinerary(params.supabase, params.userId, params.tripId)
  ]);
  const discovery = await discoverTripPrices({
    userId: params.userId,
    tripId: params.tripId,
    ...params.payload,
    committedBudgetCents: committed.amountCents,
  });
  const savedDiscovery = await savePriceDiscovery(
    params.supabase,
    { userId: params.userId, tripId: params.tripId, ...params.payload },
    discovery
  );
  let generated: Awaited<ReturnType<typeof generateRoamlyItinerary>>;
  try {
    generated = await generateRoamlyItinerary({
      ...params.payload,
      priceDiscoveryId: savedDiscovery.id || params.payload.priceDiscoveryId || null,
      budgetConstraint: buildBudgetConstraintForItinerary(discovery),
      priceDiscovery: discovery as unknown as Record<string, unknown>,
      confirmedBookings: confirmedBookings.bookings
    });
  } catch (error) {
    const generationError =
      error instanceof RoamlyItineraryGenerationError
        ? error
        : new RoamlyItineraryGenerationError(
            "Roamly could not finish itinerary generation. Please try again in a moment.",
            "AI_GENERATION_FAILED",
            502
          );
    await params.supabase
      .from("roamly_trips")
      .update({ status: "draft", itinerary_status: "draft" })
      .eq("id", params.tripId)
      .eq("user_id", params.userId);
    await recordTripEvent(params.supabase, {
      userId: params.userId,
      tripId: params.tripId,
      eventType: "itinerary_generation_failed",
      eventTitle: "Itinerary generation failed",
      eventBody: generationError.message,
      metadata: {
        destination: params.payload.destination,
        error: generationError.code,
        aiUsed: false
      }
    });
    return NextResponse.json(
      {
        ok: false,
        error: generationError.code,
        message: generationError.message
      },
      { status: generationError.status }
    );
  }
  const sync = await syncGeneratedItinerary(params.supabase, {
    tripId: params.tripId,
    userId: params.userId,
    itinerary: generated.itinerary,
    status: "generated"
  });

  if (sync.error) {
    await params.supabase
      .from("roamly_trips")
      .update({ status: "draft", itinerary_status: "draft" })
      .eq("id", params.tripId)
      .eq("user_id", params.userId);
    await recordTripEvent(params.supabase, {
      userId: params.userId,
      tripId: params.tripId,
      eventType: "itinerary_generation_failed",
      eventTitle: "Itinerary generation failed",
      eventBody: sync.error,
      metadata: { destination: params.payload.destination }
    });
    return NextResponse.json(
      {
        ok: false,
        error: sync.error,
        setupHint: "Confirm all roamly_ tables and itinerary locking migration are applied."
      },
      { status: 500 }
    );
  }

  if (canGenerate.source === "free") {
    const marked = await markFreeItineraryUsed(params.supabase, params.userId, params.tripId);
    if (!marked.ok) {
      await params.supabase
        .from("roamly_trips")
        .update({
          status: "payment_required",
          itinerary_status: "payment_required",
          itinerary_payment_status: "unpaid"
        })
        .eq("id", params.tripId)
        .eq("user_id", params.userId);
      await clearGeneratedTripArtifacts(params.supabase, params.userId, params.tripId);
      return paymentRequiredResponse(params.tripId, "Your free itinerary was already used. Unlock this itinerary to continue.");
    }
  }

  const lock = await lockGeneratedItinerary(params.supabase, params.userId, params.tripId, canGenerate.source);
  if (lock.error) {
    await recordTripEvent(params.supabase, {
      userId: params.userId,
      tripId: params.tripId,
      eventType: "itinerary_generation_failed",
      eventTitle: "Itinerary lock failed",
      eventBody: lock.error.message,
      metadata: { destination: params.payload.destination }
    });
    return NextResponse.json({ ok: false, error: lock.error.message }, { status: 500 });
  }

  if (qaTester) {
    await unlockLiveCompanion(params.supabase, params.tripId, "admin");
  }

  await recordTripEvent(params.supabase, {
    userId: params.userId,
    tripId: params.tripId,
    eventType: "itinerary_generation_completed",
    eventTitle: "Itinerary generated and locked",
    metadata: {
      source: canGenerate.source,
      qa_tester: qaTester,
      tripType: params.payload.tripType || "single_destination",
      destination: params.payload.destination,
      aiUsed: generated.aiUsed,
      model: generated.model
    }
  });

  return NextResponse.json(
    {
      ok: true,
      tripId: params.tripId,
      previewUrl: `/trip/${params.tripId}`,
      aiUsed: generated.aiUsed,
      model: generated.model,
      locked: true,
      unlockSource: canGenerate.source,
      qaTester,
      preview: buildPreviewFromItinerary(generated.itinerary)
    },
    { status: 201 }
  );
}


async function checkRoamlyGenerationSchema(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  if (!supabase) {
    return {
      ok: false,
      missing: ["supabase_client"]
    };
  }
  const required: Record<string, string[]> = {
    roamly_trips: [
      "id",
      "user_id",
      "title",
      "destination_name",
      "start_date",
      "end_date",
      "status",
      "metadata"
    ],
    roamly_trip_days: [
      "id",
      "trip_id",
      "day_number",
      "date",
      "title",
      "summary"
    ],
    roamly_activities: [
      "id",
      "trip_id",
      "trip_day_id",
      "title",
      "description",
      "category",
      "address",
      "sort_order",
      "status",
      "metadata"
    ],
    roamly_trip_usage: [
      "id",
      "user_id",
      "usage_date",
      "itinerary_generations"
    ]
  };

  const { data, error } = await supabase
    .from("information_schema.columns")
    .select("table_name,column_name")
    .eq("table_schema", "public")
    .in("table_name", Object.keys(required));

  if (error) {
    return {
      ok: false,
      missing: [`schema_check_failed: ${error.message}`]
    };
  }

  const existing = new Set(
    (data || []).map((row: { table_name: string; column_name: string }) => `${row.table_name}.${row.column_name}`)
  );

  const missing = Object.entries(required).flatMap(([table, columns]) =>
    columns
      .filter((column) => !existing.has(`${table}.${column}`))
      .map((column) => `${table}.${column}`)
  );

  return {
    ok: missing.length === 0,
    missing
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { supabase, user } = auth;
  
  const schemaReady = await checkRoamlyGenerationSchema(supabase);
  if (!schemaReady.ok) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Roamly] Generation blocked because migrations are missing", schemaReady.missing);
    }

    return NextResponse.json(
      {
        ok: false,
        code: "ROAMLY_MIGRATIONS_REQUIRED",
        message: "Roamly database migrations need to be applied before saving itinerary drafts.",
        missing: schemaReady.missing
      },
      { status: 503 }
    );
  }

const access = getRoamlyAccessForUser(user.email);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const existingTripId = getString(body.tripId);

  try {
    if (existingTripId) {
      const editable = await requireTripEditable(supabase, user.id, existingTripId);
      if (!editable.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: editable.error,
            message: "message" in editable ? editable.message : undefined
          },
          { status: editable.status || 500 }
        );
      }

      const { data: trip, error: tripError } = await supabase
        .from("roamly_trips")
        .select("*")
        .eq("id", existingTripId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (tripError) return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
      if (!trip) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });

      const payload = payloadFromTrip(trip as Record<string, unknown>, getString(body.language));
      const validation = validatePayload(payload);
      if (validation) return NextResponse.json({ ok: false, error: validation }, { status: 400 });

      return finalizeItinerary({ supabase, userId: user.id, userEmail: user.email, tripId: existingTripId, payload });
    }

    const payload = cleanPayload(body);
    const validation = validatePayload(payload);
    if (validation) return NextResponse.json({ ok: false, error: validation }, { status: 400 });

    const title = `${payload.destination} ${payload.daysCount}-day itinerary`;
    const planningMetadata = buildTripPlanningMetadata(payload);
    const { data: trip, error: insertError } = await supabase
      .from("roamly_trips")
      .insert({
        user_id: user.id,
        title,
        destination_name: payload.destination,
        destination_city: payload.destinationCity || null,
        destination_country: payload.destinationCountry || null,
        destination_region: payload.destinationRegion || null,
        start_date: payload.startDate || null,
        end_date: payload.endDate || null,
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

    return finalizeItinerary({ supabase, userId: user.id, userEmail: user.email, tripId: trip.id, payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Itinerary generation failed.";
    await recordAppEvent(supabase, {
      userId: user.id,
      eventType: "itinerary_generation_failed",
      metadata: {
        tripId: existingTripId || null,
        destination: getString(body.destination),
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
