import { NextRequest, NextResponse } from "next/server";
import { generateRoamlyItinerary } from "@/lib/ai/roamly-itinerary";
import { buildPreviewFromItinerary } from "@/lib/itinerary";
import { normalizeLocale } from "@/lib/i18n";
import { getConfirmedBookingCostCents } from "@/lib/roamly/bookings";
import {
  canGenerateFinalItinerary,
  lockGeneratedItinerary,
  markFreeItineraryUsed,
  requireTripEditable
} from "@/lib/roamly/billing";
import {
  buildBudgetConstraintForItinerary,
  discoverTripPrices,
  savePriceDiscovery
} from "@/lib/roamly/priceDiscovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMissingTableError, syncGeneratedItinerary } from "@/lib/trips";
import type { TripPlannerPayload } from "@/lib/trip-planner";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getPositiveNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return null;
}

function cleanTextArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function daysBetween(startDate: string, endDate: string) {
  if (!startDate || !endDate) return null;

  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function cleanPayload(body: Record<string, unknown>): TripPlannerPayload {
  const startDate = getString(body.startDate);
  const endDate = getString(body.endDate);
  const explicitDays = getPositiveNumber(body.daysCount);

  return {
    origin: getString(body.origin),
    destination: getString(body.destination),
    startDate,
    endDate,
    daysCount: explicitDays ?? daysBetween(startDate, endDate),
    travelersCount: getPositiveNumber(body.travelersCount) || 1,
    budgetAmount: getPositiveNumber(body.budgetAmount),
    budgetCurrency: getString(body.budgetCurrency) || "CAD",
    budgetIncludesFlights: body.budgetIncludesFlights !== false,
    budgetIncludesHotel: body.budgetIncludesHotel !== false,
    travelStyle: getString(body.travelStyle) || "Balanced",
    interests: cleanTextArray(body.interests),
    pace: getString(body.pace) || "Normal",
    accommodationPreference: getString(body.accommodationPreference) || "Not sure",
    transportationPreference: getString(body.transportationPreference) || "Mixed",
    specialNotes: getString(body.specialNotes),
    language: normalizeLocale(getString(body.language)),
    priceDiscoveryId: getString(body.priceDiscoveryId) || null,
    budgetConstraint: getString(body.budgetConstraint)
  };
}

function payloadFromTrip(trip: Record<string, unknown>, language = "en"): TripPlannerPayload {
  return {
    origin: getString(trip.origin),
    destination: getString(trip.destination),
    startDate: getString(trip.start_date),
    endDate: getString(trip.end_date),
    daysCount: getPositiveNumber(trip.days_count) || 1,
    travelersCount: getPositiveNumber(trip.travelers_count) || 1,
    budgetAmount: getPositiveNumber(trip.budget_amount) || 1,
    budgetCurrency: getString(trip.budget_currency) || "CAD",
    budgetIncludesFlights: trip.budget_includes_flights !== false,
    budgetIncludesHotel: trip.budget_includes_hotel !== false,
    travelStyle: getString(trip.travel_style) || "Balanced",
    interests: Array.isArray(trip.interests) ? cleanTextArray(trip.interests) : [],
    pace: "Normal",
    accommodationPreference: getString(trip.accommodation_preference) || "Not sure",
    transportationPreference: getString(trip.transportation_preference) || "Mixed",
    specialNotes: getString(trip.special_notes),
    language: normalizeLocale(language),
    priceDiscoveryId: getString(trip.latest_price_discovery_id) || null
  };
}

function validatePayload(payload: TripPlannerPayload) {
  if (!payload.destination) return "Destination is required.";
  if (!payload.daysCount) return "Dates or number of days are required.";
  if (!payload.budgetAmount) return "Budget amount is required.";
  return "";
}

function paymentRequiredResponse(tripId: string, message?: string) {
  return NextResponse.json(
    {
      ok: false,
      error: "PAYMENT_REQUIRED",
      message: message || "Your free itinerary has been used. Unlock the full itinerary for this trip.",
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
  tripId: string;
  payload: TripPlannerPayload;
}) {
  const canGenerate = await canGenerateFinalItinerary(params.supabase, params.userId, params.tripId);

  if (!canGenerate.ok) {
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

  await params.supabase
    .from("roamly_trips")
    .update({ status: "generating", itinerary_status: "generating" })
    .eq("id", params.tripId)
    .eq("user_id", params.userId);

  const committed = await getConfirmedBookingCostCents(params.supabase, params.userId, params.tripId);
  const discovery = await discoverTripPrices({
    userId: params.userId,
    tripId: params.tripId,
    origin: params.payload.origin,
    destination: params.payload.destination,
    startDate: params.payload.startDate,
    endDate: params.payload.endDate,
    daysCount: params.payload.daysCount,
    travelersCount: params.payload.travelersCount,
    budgetAmount: params.payload.budgetAmount,
    budgetCurrency: params.payload.budgetCurrency,
    budgetIncludesFlights: params.payload.budgetIncludesFlights,
    budgetIncludesHotel: params.payload.budgetIncludesHotel,
    committedBudgetCents: committed.amountCents,
    accommodationPreference: params.payload.accommodationPreference,
    travelStyle: params.payload.travelStyle,
    interests: params.payload.interests
  });
  const savedDiscovery = await savePriceDiscovery(
    params.supabase,
    { userId: params.userId, tripId: params.tripId, ...params.payload },
    discovery
  );
  const generated = await generateRoamlyItinerary({
    ...params.payload,
    priceDiscoveryId: savedDiscovery.id || params.payload.priceDiscoveryId || null,
    budgetConstraint: buildBudgetConstraintForItinerary(discovery)
  });
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
  if (lock.error) return NextResponse.json({ ok: false, error: lock.error.message }, { status: 500 });

  return NextResponse.json(
    {
      ok: true,
      tripId: params.tripId,
      previewUrl: `/trip/${params.tripId}`,
      aiUsed: generated.aiUsed,
      model: generated.model,
      locked: true,
      unlockSource: canGenerate.source,
      preview: buildPreviewFromItinerary(generated.itinerary)
    },
    { status: 201 }
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }

  const { data, error: userError } = await supabase.auth.getUser();

  if (userError || !data.user) {
    return NextResponse.json({ ok: false, error: "Login required to generate an itinerary." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const existingTripId = getString(body.tripId);

  try {
    if (existingTripId) {
      const editable = await requireTripEditable(supabase, data.user.id, existingTripId);
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
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (tripError) return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
      if (!trip) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });

      const payload = payloadFromTrip(trip as Record<string, unknown>, getString(body.language));
      const validation = validatePayload(payload);
      if (validation) return NextResponse.json({ ok: false, error: validation }, { status: 400 });

      return finalizeItinerary({ supabase, userId: data.user.id, tripId: existingTripId, payload });
    }

    const payload = cleanPayload(body);
    const validation = validatePayload(payload);
    if (validation) return NextResponse.json({ ok: false, error: validation }, { status: 400 });

    const title = `${payload.destination} ${payload.daysCount}-day itinerary`;
    const { data: trip, error: insertError } = await supabase
      .from("roamly_trips")
      .insert({
        user_id: data.user.id,
        title,
        destination: payload.destination,
        origin: payload.origin || null,
        start_date: payload.startDate || null,
        end_date: payload.endDate || null,
        days_count: payload.daysCount,
        travelers_count: payload.travelersCount || 1,
        budget_amount: payload.budgetAmount,
        budget_currency: payload.budgetCurrency,
        budget_includes_flights: payload.budgetIncludesFlights !== false,
        budget_includes_hotel: payload.budgetIncludesHotel !== false,
        travel_style: payload.travelStyle,
        interests: payload.interests,
        accommodation_preference: payload.accommodationPreference,
        transportation_preference: payload.transportationPreference,
        special_notes: payload.specialNotes || null,
        status: "draft",
        is_activated: false,
        itinerary_status: "draft",
        itinerary_locked: false,
        itinerary_payment_status: "unpaid",
        tracking_unlocked: false
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

    return finalizeItinerary({ supabase, userId: data.user.id, tripId: trip.id, payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Itinerary generation failed.";
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
