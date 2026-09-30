import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { getConfirmedBookingsForItinerary } from "@/lib/roamly/bookings";
import {
  searchTravelMarket
} from "@/lib/roamly/travelMarketSearch";
import { findSelectedHotelForRevalidation, refreshTripMarketPricesForTrip } from "@/lib/roamly/marketPriceRefresh";
import { getTripBundle, isMissingTableError } from "@/lib/trips";
import { parseMarketSearchRequest } from "@/lib/roamly/marketSearchRequest";
import { consumeMarketSearchQuota } from "@/lib/roamly/marketSearchQuota";
import { consumePublicMarketSearchQuota, publicMarketActorHash, publicMarketSearchAdminClient, trustedPublicMarketClientIp } from "@/lib/roamly/publicMarketSearchQuota";
import { resolveAffiliateLink } from "@/lib/roamly/affiliateResolver";

const MAX_REQUEST_BYTES = 16_384;

function getString(value: unknown, maxLength = 100) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ ok: false, error: "Search request is too large." }, { status: 413 });
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "A valid JSON search request is required." }, { status: 400 });
  }
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return NextResponse.json({ ok: false, error: "A valid search request is required." }, { status: 400 });
  }
  const body = parsedBody as Record<string, unknown>;
  const tripId = getString(body.trip_id || body.tripId, 100);
  const forceRefresh = body.force_refresh === true || body.forceRefresh === true;

  if (!tripId) {
    const marketRequest = parseMarketSearchRequest(body);
    if (!marketRequest) return NextResponse.json({ ok: false, error: "A valid category is required." }, { status: 400 });
    // Ordinary logged-out Finds flight and hotel discovery are public provider handoffs.
    // It never exposes trip/account data and deliberately does not write cache rows.
    if (marketRequest.category === "flight" || marketRequest.category === "hotel") {
      const admin = publicMarketSearchAdminClient();
      const clientIp = trustedPublicMarketClientIp(request.headers.get("x-forwarded-for"));
      const actorHash = clientIp ? publicMarketActorHash(clientIp, process.env.SUPABASE_SERVICE_ROLE_KEY) : null;
      if (!admin || !actorHash) {
        return NextResponse.json({ ok: false, error: "Public live search is temporarily unavailable. Please try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
      const quota = await consumePublicMarketSearchQuota(admin, actorHash);
      if (!quota.ok) {
        return NextResponse.json({ ok: false, error: "Public live search is temporarily unavailable. Please try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
      if (!quota.allowed) {
        return NextResponse.json({ ok: false, error: "Public live-search limit reached. Please try again after the reset." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(quota.retryAfterSeconds) } });
      }
      const response = await searchTravelMarket(marketRequest, { forceRefresh, store: false });
      return NextResponse.json({
        ok: true,
        ...response,
        warning: response.warning || (response.providerUsed === "provider_api"
          ? undefined
          : "Continue to the travel partner to check current fares and availability.")
      });
    }
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const quota = await consumeMarketSearchQuota(auth.supabase);
    if (!quota.ok) {
      return NextResponse.json({ ok: false, error: "Live search is temporarily unavailable. Please try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (!quota.allowed) {
      return NextResponse.json(
        { ok: false, error: "You’ve reached the live-search limit. Please try again after the reset." },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(quota.retryAfterSeconds) } }
      );
    }
    const response = await searchTravelMarket(marketRequest, {
      supabase: auth.supabase,
      forceRefresh,
      store: body.store !== false
    });
    const results = response.results.map((result) => {
      if (result.category !== "hotel" || result.source !== "booking_demand") return result;
      const affiliate = resolveAffiliateLink({
        category: "hotel",
        title: result.title,
        destination: marketRequest.destination || marketRequest.city,
        startDate: marketRequest.start_date,
        endDate: marketRequest.end_date,
        travelers: marketRequest.travelers,
        adults: marketRequest.travelers,
        rooms: marketRequest.rooms,
        currency: marketRequest.currency
      });
      return affiliate.finalUrl
        ? { ...result, affiliate_url: affiliate.finalUrl, affiliate_provider: affiliate.provider }
        : result;
    });
    return NextResponse.json({ ok: true, ...response, results });
  }

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data) {
    if (isMissingTableError(bundle.error)) return NextResponse.json({ ok: false, error: "Trip tables are not ready." }, { status: 503 });
    return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  }

  const quota = await consumeMarketSearchQuota(auth.supabase);
  if (!quota.ok) {
    return NextResponse.json({ ok: false, error: "Live search is temporarily unavailable. Please try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!quota.allowed) {
    return NextResponse.json(
      { ok: false, error: "You’ve reached the live-search limit. Please try again after the reset." },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(quota.retryAfterSeconds) } }
    );
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
