import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { getConfirmedBookingsForItinerary } from "@/lib/roamly/bookings";
import { hotelInventoryInputFromPayload, createBookingDemandProvider, type HotelProductOption } from "@/lib/roamly/hotelInventory";
import { revalidateSelectedHotelProduct, type SelectedHotelProductAvailabilityResult } from "@/lib/roamly/selectedHotelProductAvailability";
import { payloadFromTrip, loadSelectedHotelActionContext } from "@/lib/roamly/marketPriceRefresh";
import { getTripBundle, isMissingTableError, type RoamlyTripRecord } from "@/lib/trips";

type RouteContext = { params: Promise<{ id: string }> };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function validProductId(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.trim() === value ? value : null;
}

function confirmedHotel(bookings: Array<{ booking_type?: string | null; booking_status?: string | null }>) {
  const statuses = new Set(["booked", "paid", "reserved", "confirmed", "modified", "completed"]);
  return bookings.some((booking) => booking.booking_type === "hotel" && statuses.has((booking.booking_status || "").toLowerCase()));
}

function selectedHotelFromContext(context: Awaited<ReturnType<typeof loadSelectedHotelActionContext>>) {
  if (!context) return null;
  const metadata = record(context.market.metadata);
  const providerPayload = record(metadata.providerPayload);
  return {
    candidateId: context.selectedId,
    source: "Booking.com Demand API" as const,
    sourceType: "provider_api" as const,
    providerPropertyId: context.selected.providerPropertyId,
    productOptions: Array.isArray(providerPayload.product_options) ? providerPayload.product_options : undefined
  };
}

function safeProduct(option: HotelProductOption | null) {
  if (!option) return null;
  return {
    providerProductId: option.providerProductId,
    roomDescription: option.roomDescription,
    totalStayPrice: option.totalStayPrice,
    currency: option.currency,
    taxesFees: option.taxesFees,
    taxInclusionStatus: option.taxInclusionStatus,
    feeInclusionStatus: option.feeInclusionStatus,
    availabilityStatus: option.availabilityStatus,
    cancellationPolicy: option.cancellationPolicy
  };
}

function safeResult(result: SelectedHotelProductAvailabilityResult) {
  return {
    status: result.status,
    providerProductId: result.refreshedProduct?.providerProductId || result.intendedProviderProductId,
    product: safeProduct(result.refreshedProduct),
    previousProduct: safeProduct(result.previousProduct),
    searchedAt: result.searchedAt,
    factualChanges: result.factualChanges,
    comparisonStatus: result.comparisonStatus,
    bookingContinuity: result.bookingContinuity
  };
}

function statusFor(result: SelectedHotelProductAvailabilityResult) {
  if (result.status === "INVALID_PRODUCT_ID") return 400;
  if (result.status === "REQUEST_CONTEXT_MISSING") return 422;
  if (result.status === "SELECTED_HOTEL_MISSING") return 409;
  if (result.status === "PROVIDER_ERROR") return 502;
  if (result.status === "MALFORMED_PROVIDER_RESPONSE") return 502;
  return 200;
}

export type HotelProductRevalidationDependencies = {
  requireUser: typeof requireUser;
  getTripBundle: typeof getTripBundle;
  getConfirmedBookingsForItinerary: typeof getConfirmedBookingsForItinerary;
  loadSelectedHotelActionContext: typeof loadSelectedHotelActionContext;
  payloadFromTrip: typeof payloadFromTrip;
  hotelInventoryInputFromPayload: typeof hotelInventoryInputFromPayload;
  createBookingDemandProvider: typeof createBookingDemandProvider;
  revalidateSelectedHotelProduct: typeof revalidateSelectedHotelProduct;
};

const productionDependencies: HotelProductRevalidationDependencies = {
  requireUser,
  getTripBundle,
  getConfirmedBookingsForItinerary,
  loadSelectedHotelActionContext,
  payloadFromTrip,
  hotelInventoryInputFromPayload,
  createBookingDemandProvider,
  revalidateSelectedHotelProduct
};

function createHotelProductRevalidationHandler(dependencies: HotelProductRevalidationDependencies = productionDependencies) {
  return async function POST(request: NextRequest, { params }: RouteContext) {
    const auth = await dependencies.requireUser();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const body = record(await request.json().catch(() => ({})));
    const intendedProviderProductId = validProductId(body.providerProductId);
    if (!intendedProviderProductId) return NextResponse.json({ ok: false, error: "INVALID_PRODUCT_ID" }, { status: 400 });

    const bundle = await dependencies.getTripBundle(auth.supabase, auth.user.id, id);
    if (!bundle.data) {
      if (isMissingTableError(bundle.error)) return NextResponse.json({ ok: false, error: "TRIP_DATA_UNAVAILABLE" }, { status: 503 });
      return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
    }

    const confirmed = await dependencies.getConfirmedBookingsForItinerary(auth.supabase, auth.user.id, id);
    if (confirmed.error) return NextResponse.json({ ok: false, error: "BOOKING_STATE_UNAVAILABLE" }, { status: 500 });
    if (confirmedHotel(confirmed.bookings)) return NextResponse.json({ ok: false, error: "CONFIRMED_BOOKING_AUTHORITATIVE" }, { status: 409 });

    const context = await dependencies.loadSelectedHotelActionContext(auth.supabase, bundle.data.trip, bundle.data.itinerary, confirmed.bookings);
    const selectedHotel = selectedHotelFromContext(context);
    if (!selectedHotel) return NextResponse.json({ ok: false, error: "SELECTED_HOTEL_UNAVAILABLE" }, { status: 409 });

    const payload = dependencies.payloadFromTrip(bundle.data.trip as RoamlyTripRecord);
    const requestContext = dependencies.hotelInventoryInputFromPayload(payload);
    const result = await dependencies.revalidateSelectedHotelProduct(
      dependencies.createBookingDemandProvider(),
      { selectedHotel, request: requestContext, intendedProviderProductId }
    );
    return NextResponse.json({ ok: result.status === "CURRENT" || result.status === "DISAPPEARED", ...safeResult(result) }, { status: statusFor(result) });
  };
}

export const POST = createHotelProductRevalidationHandler();
