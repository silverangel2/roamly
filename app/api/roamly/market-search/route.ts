import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { getConfirmedBookingsForItinerary } from "@/lib/roamly/bookings";
import {
  searchTravelMarket,
  type TravelMarketCategory,
  type TravelMarketSearchRequest
} from "@/lib/roamly/travelMarketSearch";
import { findSelectedHotelForRevalidation, refreshTripMarketPricesForTrip } from "@/lib/roamly/marketPriceRefresh";
import { getTripBundle, isMissingTableError } from "@/lib/trips";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
  if (value === "flight" || value === "hotel" || value === "attraction" || value === "tour" || value === "restaurant" || value === "transport") return value;
  return null;
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
  const confirmedBookingRows = await getConfirmedBookingsForItinerary(auth.supabase, auth.user.id, tripId);
  const selectedHotelForRevalidation = await findSelectedHotelForRevalidation(auth.supabase, trip, itinerary, confirmedBookingRows.bookings);
  const refreshed = await refreshTripMarketPricesForTrip({ supabase: auth.supabase, userId: auth.user.id, tripId, trip, itinerary, forceRefresh, selectedHotelForRevalidation });

  return NextResponse.json({
    ok: true,
    tripId,
    results: refreshed.marketSearch.results,
    warnings: refreshed.marketSearch.providerWarnings,
    discovery: refreshed.discovery,
    discoveryId: refreshed.savedDiscovery.id,
    updated: Boolean(refreshed.updatedItinerary)
  });
}
