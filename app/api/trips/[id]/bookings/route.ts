import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { createTripBooking, listTripBookings, type BookingSegmentInput, type TripBookingInput } from "@/lib/roamly/bookingWallet";
import { reconcileTripBookings } from "@/lib/roamly/brain/bookingReconciliation";
import { resolveAffiliateReferral } from "@/lib/roamly/affiliateTracking";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(body: Record<string, unknown>, camel: string, snake?: string) {
  const value = body[camel] ?? (snake ? body[snake] : undefined);
  return typeof value === "string" ? value : null;
}

function numberValue(body: Record<string, unknown>, camel: string, snake?: string) {
  const value = body[camel] ?? (snake ? body[snake] : undefined);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jsonObject(body: Record<string, unknown>, camel: string, snake?: string) {
  const value = body[camel] ?? (snake ? body[snake] : undefined);
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function segmentInput(value: unknown): BookingSegmentInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const segment = record(item);
    return {
      sequence: numberValue(segment, "sequence") ?? index + 1,
      origin: text(segment, "origin"),
      destination: text(segment, "destination"),
      departureTime: text(segment, "departureTime", "departure_time"),
      arrivalTime: text(segment, "arrivalTime", "arrival_time"),
      provider: text(segment, "provider"),
      serviceNumber: text(segment, "serviceNumber", "service_number"),
      terminal: text(segment, "terminal"),
      gate: text(segment, "gate"),
      seat: text(segment, "seat"),
      status: text(segment, "status")
    };
  });
}

function bookingInput(body: Record<string, unknown>): TripBookingInput {
  return {
    bookingType: text(body, "bookingType", "booking_type"),
    // Browser input may describe a booking, but cannot establish authoritative confirmation.
    bookingStatus: null,
    provider: text(body, "provider"),
    providerBookingId: text(body, "providerBookingId", "provider_booking_id"),
    confirmationCode: text(body, "confirmationCode", "confirmation_code"),
    recommendationId: text(body, "recommendationId", "recommendation_id"),
    referralId: text(body, "referralId", "referral_id"),
    affiliateClickId: text(body, "affiliateClickId", "affiliate_click_id"),
    affiliateConversionId: text(body, "affiliateConversionId", "affiliate_conversion_id"),
    sourceType: text(body, "sourceType", "source_type"),
    sourceReference: text(body, "sourceReference", "source_reference"),
    title: text(body, "title"),
    startTime: text(body, "startTime", "start_time"),
    endTime: text(body, "endTime", "end_time"),
    timezone: text(body, "timezone"),
    origin: text(body, "origin"),
    destination: text(body, "destination"),
    locationName: text(body, "locationName", "location_name"),
    address: text(body, "address"),
    coordinates: jsonObject(body, "coordinates"),
    flightNumber: text(body, "flightNumber", "flight_number"),
    airlineCode: text(body, "airlineCode", "airline_code"),
    terminal: text(body, "terminal"),
    gate: text(body, "gate"),
    roomType: text(body, "roomType", "room_type"),
    checkInTime: text(body, "checkInTime", "check_in_time"),
    checkOutTime: text(body, "checkOutTime", "check_out_time"),
    reservationRequirements: jsonObject(body, "reservationRequirements", "reservation_requirements"),
    totalPrice: numberValue(body, "totalPrice", "total_price"),
    currency: text(body, "currency"),
    taxesAndFees: numberValue(body, "taxesAndFees", "taxes_and_fees"),
    cancellationDeadline: text(body, "cancellationDeadline", "cancellation_deadline"),
    cancellationTerms: text(body, "cancellationTerms", "cancellation_terms"),
    travelerConfirmed: false,
    metadata: jsonObject(body, "metadata"),
    lastSyncedAt: text(body, "lastSyncedAt", "last_synced_at"),
    segments: segmentInput(body.segments)
  };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const result = await listTripBookings({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id,
    includeSegments: true
  });

  if (result.error) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, bookings: result.bookings });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = record(await request.json().catch(() => ({})));

  const affiliateClickId = text(body, "affiliateClickId", "affiliate_click_id");
  const recommendationId = text(body, "recommendationId", "recommendation_id");
  let referral: Awaited<ReturnType<typeof resolveAffiliateReferral>>["referral"] = null;
  if (affiliateClickId) {
    const resolved = await resolveAffiliateReferral({
      supabase: auth.supabase,
      userId: auth.user.id,
      tripId: id,
      affiliateClickId,
      recommendationId
    });
    if (!resolved.referral) {
      return NextResponse.json({ ok: false, error: resolved.error || "AFFILIATE_REFERRAL_NOT_FOUND" }, { status: 400 });
    }
    referral = resolved.referral;
  }

  const inputBody = {
    ...body,
    bookingStatus: null,
    travelerConfirmed: false,
    bookingType: referral?.booking_type || text(body, "bookingType", "booking_type"),
    provider: referral?.provider || text(body, "provider"),
    recommendationId: referral?.recommendation_id || null,
    referralId: referral ? referral.id : null,
    affiliateConversionId: null,
    affiliateClickId: referral?.id || null,
    sourceType: referral ? "affiliate_click" : text(body, "sourceType", "source_type"),
    sourceReference: referral?.sub_id || text(body, "sourceReference", "source_reference"),
    metadata: {
      ...jsonObject(body, "metadata"),
      ...(referral ? { captureState: "customer_asserted", sourceReference: referral.sub_id } : {})
    }
  };

  const result = await createTripBooking({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id,
    input: bookingInput(inputBody)
  });

  if (result.error) {
    const status = result.error === "TRIP_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  const reconciliation = result.booking?.id
    ? await reconcileTripBookings({
        supabase: auth.supabase,
        userId: auth.user.id,
        tripId: id,
        sourceBookingId: result.booking.id
      }).catch(() => null)
    : null;

  return NextResponse.json({ ok: true, booking: result.booking, reconciliation: reconciliation?.ok ? reconciliation.output : null });
}
