import { NextResponse } from "next/server";
import { getTripBundle, isMissingTableError, syncGeneratedItinerary } from "@/lib/trips";
import { sanitizeStoredItinerary } from "@/lib/itinerary";
import { requireUser } from "@/lib/roamly/auth";
import { getConfirmedBookingsForItinerary } from "@/lib/roamly/bookings";
import { savePriceDiscovery } from "@/lib/roamly/priceDiscovery";
import { prepareStaySelectionSave } from "@/lib/roamly/staySelectionSave";
import { getTripDaysCount } from "@/lib/roamly/tripMetadata";

type RouteContext = { params: Promise<{ id: string }> };

// The same confirmed-status set the market refresh path uses: a
// confirmed hotel booking outranks any selector pick (priority law —
// confirmed booking > traveller selection > recommendation), so a
// booked stay can never be re-picked from the selector.
const confirmedStatuses = new Set(["booked", "paid", "reserved", "confirmed", "modified", "completed"]);

/**
 * Persist the traveller's stay pick from the detailed itinerary's
 * stay selector. The pick is applied to the trip's latest price
 * discovery (rehydrated from its stored row) with the engine's own
 * re-tabulation, saved as the next discovery row through
 * savePriceDiscovery, and written into the itinerary's budget
 * breakdown through syncGeneratedItinerary — the same append-only
 * pattern the market refresh path uses, so the pick (and its totals)
 * survive reload and are honoured by later refreshes/generations.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const optionId = typeof body.optionId === "string" ? body.optionId.trim() : "";
  if (!optionId) return NextResponse.json({ ok: false, error: "STAY_OPTION_REQUIRED" }, { status: 400 });

  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data) {
    if (isMissingTableError(bundle.error)) return NextResponse.json({ ok: false, error: "Trip tables are not ready." }, { status: 503 });
    return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  }
  const { trip, itinerary: itineraryRecord } = bundle.data;
  const itinerary = itineraryRecord?.full_json ? sanitizeStoredItinerary(itineraryRecord.full_json) : null;
  if (!itinerary) return NextResponse.json({ ok: false, error: "ITINERARY_NOT_EDITABLE" }, { status: 409 });
  if (!["generated", "locked", "activated", "planned", "active"].includes(trip.status)) {
    return NextResponse.json({ ok: false, error: "TRIP_NOT_ACTIVE" }, { status: 409 });
  }

  const confirmed = await getConfirmedBookingsForItinerary(auth.supabase, auth.user.id, tripId);
  const hotelBooked = confirmed.bookings.some(
    (booking) => booking.booking_type === "hotel" && confirmedStatuses.has(String(booking.booking_status || "").toLowerCase())
  );
  if (hotelBooked) return NextResponse.json({ ok: false, error: "STAY_ALREADY_BOOKED" }, { status: 409 });

  if (!trip.latest_price_discovery_id) {
    return NextResponse.json({ ok: false, error: "STAY_SELECTION_UNAVAILABLE" }, { status: 409 });
  }
  const discoveryResult = await auth.supabase
    .from("roamly_price_discoveries")
    .select("*")
    .eq("id", trip.latest_price_discovery_id)
    .eq("trip_id", tripId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (discoveryResult.error || !discoveryResult.data) {
    return NextResponse.json({ ok: false, error: "STAY_SELECTION_UNAVAILABLE" }, { status: 409 });
  }

  const nights = Math.max(1, (getTripDaysCount(trip) || 1) - 1);
  const prepared = prepareStaySelectionSave({
    discoveryRow: discoveryResult.data as Record<string, unknown>,
    itinerary,
    optionId,
    nights
  });
  if (!prepared.ok) {
    return NextResponse.json({ ok: false, error: `STAY_SELECTION_${prepared.reason}` }, { status: 409 });
  }

  const saved = await savePriceDiscovery(auth.supabase, prepared.input, prepared.discovery);
  if (saved.error || !saved.id) {
    return NextResponse.json({ ok: false, error: "STAY_SELECTION_SAVE_FAILED" }, { status: 502 });
  }
  const synced = await syncGeneratedItinerary(auth.supabase, {
    tripId,
    userId: auth.user.id,
    itinerary: prepared.itinerary,
    status: "locked"
  });
  if (synced.error) {
    // The stamp is saved on the new discovery row; the itinerary
    // breakdown sync is what failed. Report it plainly — a later
    // refresh re-applies the discovery to the itinerary.
    return NextResponse.json({ ok: false, error: "STAY_SELECTION_SYNC_FAILED", discoveryId: saved.id }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    selection: prepared.selection,
    totals: prepared.totals,
    discoveryId: saved.id
  });
}
