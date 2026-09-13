import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { getConfirmedBookingsForItinerary } from "@/lib/roamly/bookings";
import { hotelInventoryInputFromPayload, createBookingDemandProvider } from "@/lib/roamly/hotelInventory";
import { loadSelectedHotelActionContext, payloadFromTrip } from "@/lib/roamly/marketPriceRefresh";
import { getTripBundle, isMissingTableError, type RoamlyTripRecord } from "@/lib/trips";
import { revalidateSelectedHotelProduct } from "@/lib/roamly/selectedHotelProductAvailability";
import { createHotelProductChoice } from "@/lib/roamly/selectedHotelProductChoice";
import {
  clearPendingHotelProductChoice,
  getPendingHotelProductChoice,
  replacePendingHotelProductChoice,
  storageInputFromActiveChoiceResult
} from "@/lib/roamly/hotelProductChoiceStorage";

type RouteContext = { params: Promise<{ id: string }> };
type SupabaseErrorResult = { error?: string | null };

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

function safePending(choice: Awaited<ReturnType<typeof getPendingHotelProductChoice>>["choice"]) {
  if (!choice) return null;
  return {
    state: "PENDING_CUSTOMER_PRODUCT_CHOICE" as const,
    tripId: choice.tripId,
    provider: choice.choice.provider,
    providerPropertyId: choice.choice.providerPropertyId,
    selectedHotelCandidateId: choice.choice.selectedHotelCandidateId,
    providerProductId: choice.choice.providerProductId,
    revalidatedAt: choice.choice.revalidatedAt,
    chosenAt: choice.choice.chosenAt,
    acknowledgedMaterialChanges: choice.acknowledgedMaterialChanges,
    bookingContinuity: "UNVERIFIED" as const,
    actionability: "INFORMATIONAL_ONLY" as const
  };
}

function confirmedResponse() {
  return NextResponse.json({ ok: false, error: "CONFIRMED_BOOKING_AUTHORITATIVE" }, { status: 409 });
}

function tripResponse(bundle: Awaited<ReturnType<typeof getTripBundle>>) {
  if (bundle.data) return null;
  return NextResponse.json({ ok: false, error: isMissingTableError(bundle.error) ? "TRIP_DATA_UNAVAILABLE" : "TRIP_NOT_FOUND" }, { status: isMissingTableError(bundle.error) ? 503 : 404 });
}

function storageFailure(result: SupabaseErrorResult) {
  return result.error ? NextResponse.json({ ok: false, error: "PENDING_CHOICE_STORAGE_UNAVAILABLE" }, { status: 503 }) : null;
}

const ACCEPTED_POST_FIELDS = new Set(["providerProductId", "acknowledgedMaterialChanges"]);

function validatePostBody(body: Record<string, unknown>) {
  const unexpected = Object.keys(body).filter((key) => !ACCEPTED_POST_FIELDS.has(key));
  if (unexpected.length) return { error: "UNSUPPORTED_CHOICE_INPUT" as const };
  const providerProductId = validProductId(body.providerProductId);
  if (!providerProductId) return { error: "INVALID_PRODUCT_ID" as const };
  const acknowledgedMaterialChanges = body.acknowledgedMaterialChanges;
  if (acknowledgedMaterialChanges !== undefined && !Array.isArray(acknowledgedMaterialChanges)) return { error: "INVALID_ACKNOWLEDGEMENT" as const };
  return { providerProductId, acknowledgedMaterialChanges };
}

export type HotelProductChoiceDependencies = {
  requireUser: typeof requireUser;
  getTripBundle: typeof getTripBundle;
  getConfirmedBookingsForItinerary: typeof getConfirmedBookingsForItinerary;
  loadSelectedHotelActionContext: typeof loadSelectedHotelActionContext;
  payloadFromTrip: typeof payloadFromTrip;
  hotelInventoryInputFromPayload: typeof hotelInventoryInputFromPayload;
  createBookingDemandProvider: typeof createBookingDemandProvider;
  revalidateSelectedHotelProduct: typeof revalidateSelectedHotelProduct;
  getPendingHotelProductChoice: typeof getPendingHotelProductChoice;
  replacePendingHotelProductChoice: typeof replacePendingHotelProductChoice;
  clearPendingHotelProductChoice: typeof clearPendingHotelProductChoice;
  createHotelProductChoice: typeof createHotelProductChoice;
};

const productionDependencies: HotelProductChoiceDependencies = {
  requireUser,
  getTripBundle,
  getConfirmedBookingsForItinerary,
  loadSelectedHotelActionContext,
  payloadFromTrip,
  hotelInventoryInputFromPayload,
  createBookingDemandProvider,
  revalidateSelectedHotelProduct,
  getPendingHotelProductChoice,
  replacePendingHotelProductChoice,
  clearPendingHotelProductChoice,
  createHotelProductChoice
};

function createHotelProductChoiceHandler(dependencies: HotelProductChoiceDependencies = productionDependencies) {
  async function ownedTrip(auth: Awaited<ReturnType<typeof requireUser>>, id: string) {
    if (!auth.ok) return { response: auth.response };
    const bundle = await dependencies.getTripBundle(auth.supabase, auth.user.id, id);
    const response = tripResponse(bundle);
    return response ? { response } : { auth, bundle };
  }

  async function confirmed(auth: Extract<Awaited<ReturnType<typeof requireUser>>, { ok: true }>, id: string) {
    const bookings = await dependencies.getConfirmedBookingsForItinerary(auth.supabase, auth.user.id, id);
    if (bookings.error) return { response: NextResponse.json({ ok: false, error: "BOOKING_STATE_UNAVAILABLE" }, { status: 503 }) };
    return { response: confirmedHotel(bookings.bookings) ? confirmedResponse() : null, bookings: bookings.bookings };
  }

  return {
    async POST(request: NextRequest, { params }: RouteContext) {
      const auth = await dependencies.requireUser();
      if (!auth.ok) return auth.response;
      const { id } = await params;
      const parsed = validatePostBody(record(await request.json().catch(() => ({}))));
      if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
      const trip = await ownedTrip(auth, id);
      if (trip.response) return trip.response;
      const ownedBundle = trip.bundle.data;
      if (!ownedBundle) return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
      const booking = await confirmed(auth, id);
      if (booking.response) return booking.response;
      const context = await dependencies.loadSelectedHotelActionContext(auth.supabase, ownedBundle.trip, ownedBundle.itinerary, booking.bookings);
      const selectedHotel = selectedHotelFromContext(context);
      if (!selectedHotel) return NextResponse.json({ ok: false, error: "SELECTED_HOTEL_UNAVAILABLE" }, { status: 409 });
      const requestContext = dependencies.hotelInventoryInputFromPayload(dependencies.payloadFromTrip(ownedBundle.trip as RoamlyTripRecord));
      const revalidation = await dependencies.revalidateSelectedHotelProduct(dependencies.createBookingDemandProvider(), {
        selectedHotel,
        request: requestContext,
        intendedProviderProductId: parsed.providerProductId
      });
      if (revalidation.status !== "CURRENT") {
        const error = revalidation.status === "DISAPPEARED" ? "PRODUCT_NO_LONGER_CURRENT" : revalidation.status === "PROVIDER_ERROR" ? "PRODUCT_REVALIDATION_FAILED" : revalidation.status === "MALFORMED_PROVIDER_RESPONSE" ? "PRODUCT_REVALIDATION_INVALID" : "PRODUCT_REVALIDATION_REQUIRED";
        return NextResponse.json({ ok: false, error }, { status: revalidation.status === "DISAPPEARED" ? 409 : 502 });
      }
      const decision = dependencies.createHotelProductChoice({
        selectedHotel: { selectedHotelCandidateId: selectedHotel.candidateId, provider: "booking_demand", providerPropertyId: selectedHotel.providerPropertyId },
        revalidation,
        confirmedBooking: false,
        chosenAt: new Date().toISOString(),
        acknowledgedMaterialChanges: parsed.acknowledgedMaterialChanges
      });
      if (decision.status !== "ACTIVE_CHOICE") {
        const error = decision.status === "REQUIRES_MATERIAL_CHANGE_ACKNOWLEDGEMENT" ? "MATERIAL_CHANGE_ACKNOWLEDGEMENT_REQUIRED" : decision.reasonCodes.includes("UNKNOWN_FACTUAL_CHANGE") ? "UNKNOWN_MATERIAL_CHANGE" : "INVALID_PRODUCT_CHOICE";
        return NextResponse.json({ ok: false, error, materialChanges: decision.materialChanges }, { status: 409 });
      }
      const storageInput = storageInputFromActiveChoiceResult(decision);
      if (!storageInput) return NextResponse.json({ ok: false, error: "INVALID_PRODUCT_CHOICE" }, { status: 409 });
      // Provider validation and persistence are separate operations. The
      // database guarantees one pending row per trip; the last successful
      // validated upsert wins, without claiming a cross-system transaction.
      const stored = await dependencies.replacePendingHotelProductChoice(auth.supabase, id, storageInput);
      const storageError = storageFailure(stored);
      if (storageError) return storageError;
      return NextResponse.json({ ok: true, pendingChoice: safePending(stored.choice) });
    },

    async GET(_request: NextRequest, { params }: RouteContext) {
      const auth = await dependencies.requireUser();
      if (!auth.ok) return auth.response;
      const { id } = await params;
      const trip = await ownedTrip(auth, id);
      if (trip.response) return trip.response;
      const booking = await confirmed(auth, id);
      if (booking.response) return booking.response;
      const result = await dependencies.getPendingHotelProductChoice(auth.supabase, id);
      const storageError = storageFailure(result);
      if (storageError) return storageError;
      return NextResponse.json({ ok: true, pendingChoice: safePending(result.choice) });
    },

    async DELETE(_request: NextRequest, { params }: RouteContext) {
      const auth = await dependencies.requireUser();
      if (!auth.ok) return auth.response;
      const { id } = await params;
      const trip = await ownedTrip(auth, id);
      if (trip.response) return trip.response;
      const result = await dependencies.clearPendingHotelProductChoice(auth.supabase, id);
      const storageError = storageFailure(result);
      if (storageError) return storageError;
      return NextResponse.json({ ok: true, pendingChoice: null });
    }
  };
}

const handlers = createHotelProductChoiceHandler();
export const POST = handlers.POST;
export const GET = handlers.GET;
export const DELETE = handlers.DELETE;
