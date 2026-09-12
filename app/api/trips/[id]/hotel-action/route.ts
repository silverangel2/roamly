import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { getConfirmedBookingsForItinerary } from "@/lib/roamly/bookings";
import { refreshedHotelTruthChanged } from "@/lib/roamly/hotelActionPolicy";
import { findSelectedHotelForRevalidation, loadSelectedHotelActionContext, refreshTripMarketPricesForTrip } from "@/lib/roamly/marketPriceRefresh";
import { getTripBundle, isMissingTableError } from "@/lib/trips";

function providerUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && (host === "booking.com" || host.endsWith(".booking.com")) ? url.toString() : "";
  } catch {
    return "";
  }
}

function tripPath(id: string, reason: string) {
  return `/trip/${encodeURIComponent(id)}?hotel_action=${encodeURIComponent(reason)}`;
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const bundle = await getTripBundle(auth.supabase, auth.user.id, id);
  if (!bundle.data) {
    if (isMissingTableError(bundle.error)) return NextResponse.json({ ok: false, error: "Trip tables are not ready." }, { status: 503 });
    return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  }

  const { trip, itinerary } = bundle.data;
  const confirmed = await getConfirmedBookingsForItinerary(auth.supabase, auth.user.id, id);
  const context = await loadSelectedHotelActionContext(auth.supabase, trip, itinerary, confirmed.bookings);
  if (!context || context.confirmed) return NextResponse.json({ ok: false, action: "review", path: tripPath(id, "confirmed") }, { status: 409 });

  const currentUrl = providerUrl(context.market.booking_url);
  if (context.fresh) {
    if (!currentUrl) return NextResponse.json({ ok: false, action: "review", path: tripPath(id, "action_unavailable") }, { status: 409 });
    return NextResponse.json({ ok: true, action: "redirect", url: currentUrl, candidateId: context.selectedId });
  }

  const stale = await findSelectedHotelForRevalidation(auth.supabase, trip, itinerary, confirmed.bookings);
  if (!stale) return NextResponse.json({ ok: false, action: "review", path: tripPath(id, "refresh_required") }, { status: 409 });
  const oldPrice = typeof context.market.price_amount === "number" ? context.market.price_amount : null;
  let refreshed;
  try {
    refreshed = await refreshTripMarketPricesForTrip({
      supabase: auth.supabase,
      userId: auth.user.id,
      tripId: id,
      trip,
      itinerary,
      selectedHotelForRevalidation: stale,
      forceRefresh: true
    });
  } catch {
    return NextResponse.json({ ok: false, action: "review", path: tripPath(id, "verification_failed") }, { status: 502 });
  }

  const result = refreshed.refreshedHotelResult;
  const state = refreshed.revalidationState;
  if (state === "unavailable") return NextResponse.json({ ok: false, action: "review", path: tripPath(id, "unavailable") }, { status: 409 });
  if (state === "unknown" || !result || result.id !== context.selectedId) return NextResponse.json({ ok: false, action: "review", path: tripPath(id, "verification_failed") }, { status: 502 });
  const newPrice = typeof (result as { price_amount?: unknown }).price_amount === "number" ? (result as { price_amount: number }).price_amount : null;
  const oldCurrency = typeof context.market.currency === "string" ? context.market.currency : "";
  const newCurrency = typeof result.currency === "string" ? result.currency : "";
  const oldProviderPayload = context.market.metadata && typeof context.market.metadata === "object" ? (context.market.metadata as Record<string, unknown>).providerPayload : null;
  const newProviderPayload = result.metadata && typeof result.metadata === "object" ? (result.metadata as Record<string, unknown>).providerPayload : null;
  const changed = refreshedHotelTruthChanged({
    oldPrice,
    newPrice,
    oldCurrency,
    newCurrency,
    oldTaxesFees: (oldProviderPayload as Record<string, unknown> | null)?.taxes_fees,
    newTaxesFees: (newProviderPayload as Record<string, unknown> | null)?.taxes_fees,
    oldTaxesIncluded: (oldProviderPayload as Record<string, unknown> | null)?.taxes_included,
    newTaxesIncluded: (newProviderPayload as Record<string, unknown> | null)?.taxes_included,
    oldFeesIncluded: (oldProviderPayload as Record<string, unknown> | null)?.fees_included,
    newFeesIncluded: (newProviderPayload as Record<string, unknown> | null)?.fees_included
  });
  const refreshedUrl = providerUrl(result.booking_url);
  if (changed || !refreshedUrl) return NextResponse.json({ ok: true, action: "review", path: tripPath(id, changed ? "price_changed" : "action_unavailable"), candidateId: context.selectedId });
  return NextResponse.json({ ok: true, action: "redirect", url: refreshedUrl, candidateId: context.selectedId });
}
