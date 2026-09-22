import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTripBundle } from "@/lib/trips";
import { getTripPlanningMetadata } from "@/lib/roamly/tripMetadata";
import { buildIntentBookingSnapshot, buildRequestedGenerationIntent, evaluateIntentChange, generationIntentForTrip, generationSnapshotForTrip, intentChangePreview, intentChangeSourceSnapshot, intentHash, normalizeGenerationIntentPatch } from "@/lib/roamly/customerTripIntentChange";

type RouteContext = { params: Promise<{ id: string }> };

const FORBIDDEN = new Set(["destination", "destinationStops", "destinationPlace", "startDate", "endDate", "daysCount", "budgetAmount", "budgetCurrency", "priceDiscoveryId", "budgetConstraint"]);

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const requested = body.intent && typeof body.intent === "object" && !Array.isArray(body.intent) ? body.intent as Record<string, unknown> : body;
  if ([...FORBIDDEN].some((field) => field in requested)) return NextResponse.json({ ok: false, error: "INTENT_CHANGE_SCOPE_REJECTED", message: "Destination, dates, and budget use their dedicated change flows." }, { status: 400 });
  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data?.trip || !bundle.data.itinerary) return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
  const trip = bundle.data.trip;
  if (!["generated", "locked", "planned"].includes(trip.status)) return NextResponse.json({ ok: false, error: "INTENT_CHANGE_TRIP_NOT_ELIGIBLE" }, { status: 409 });
  const planning = getTripPlanningMetadata(trip.metadata);
  if (!trip.start_date || !trip.end_date || trip.end_date < trip.start_date) return NextResponse.json({ ok: false, error: "INTENT_CHANGE_DATES_INVALID" }, { status: 409 });
  if (Array.isArray(planning.destinationStops) && planning.destinationStops.length > 0) return NextResponse.json({ ok: false, error: "INTENT_CHANGE_MULTI_CITY_UNSUPPORTED" }, { status: 409 });
  const patch = normalizeGenerationIntentPatch(requested);
  const eligible = evaluateIntentChange(trip as unknown as Record<string, unknown>, patch);
  if (!eligible.ok) return NextResponse.json({ ok: false, error: eligible.code, message: eligible.message }, { status: 400 });
  if (!patch) return NextResponse.json({ ok: false, error: "INTENT_CHANGE_FIELDS_REQUIRED" }, { status: 400 });
  const current = generationIntentForTrip(trip as unknown as Record<string, unknown>);
  const next = buildRequestedGenerationIntent(trip as unknown as Record<string, unknown>, patch);
  if (JSON.stringify(current) === JSON.stringify(next)) return NextResponse.json({ ok: false, error: "INTENT_CHANGE_UNCHANGED" }, { status: 400 });
  const bookings = await buildIntentBookingSnapshot(auth.supabase, auth.user.id, tripId);
  if (bookings.error || !bookings.snapshot) return NextResponse.json({ ok: false, error: "BOOKING_STATE_UNAVAILABLE" }, { status: 503 });
  const blockedBooking = bookings.rows.find((row) => row.traveler_confirmed === true || ["booked", "paid", "reserved", "confirmed", "modified", "completed"].includes(String(row.booking_status || "").toLowerCase()));
  if (blockedBooking) return NextResponse.json({ ok: false, error: "INTENT_CHANGE_BOOKING_REVIEW_REQUIRED", message: "Existing confirmed or reserved bookings remain attached to the current trip and require review before changing traveler intent." }, { status: 409 });
  const revision = Number((bundle.data.itinerary as typeof bundle.data.itinerary & { repair_revision?: number }).repair_revision);
  if (!Number.isSafeInteger(revision) || revision < 0) return NextResponse.json({ ok: false, error: "INTENT_CHANGE_SCHEMA_NOT_READY" }, { status: 503 });
  const hash = await auth.supabase.rpc("roamly_itinerary_content_hash", { value: bundle.data.itinerary.full_json });
  if (hash.error || typeof hash.data !== "string") return NextResponse.json({ ok: false, error: "INTENT_CHANGE_SCHEMA_NOT_READY" }, { status: 503 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "INTENT_CHANGE_STORAGE_UNAVAILABLE" }, { status: 503 });
  const preview = intentChangePreview(current, next, bookings.rows);
  const insert = await admin.from("roamly_customer_trip_intent_changes").insert({
    original_trip_id: tripId,
    user_id: auth.user.id,
    original_itinerary_id: bundle.data.itinerary.id,
    requested_intent_snapshot: next,
    requested_intent_hash: intentHash(next),
    expected_source_snapshot: intentChangeSourceSnapshot(trip as unknown as Record<string, unknown>),
    expected_intent_snapshot: current,
    expected_traveler_snapshot: current.travelers,
    expected_generation_snapshot: generationSnapshotForTrip(trip as unknown as Record<string, unknown>),
    expected_booking_snapshot: bookings.snapshot,
    expected_trip_status: trip.status,
    expected_itinerary_status: (trip as unknown as Record<string, unknown>).itinerary_status || null,
    expected_revision: revision,
    expected_content_hash: hash.data,
    expected_price_discovery_id: trip.latest_price_discovery_id || null,
    result: preview,
    status: "awaiting_approval"
  }).select("id,status,result,requested_intent_snapshot").single();
  if (insert.error || !insert.data) return NextResponse.json({ ok: false, error: insert.error?.code === "23505" ? "INTENT_CHANGE_ALREADY_PENDING" : "INTENT_CHANGE_CREATE_FAILED" }, { status: insert.error?.code === "23505" ? 409 : 500 });
  return NextResponse.json({ ok: true, proposal: insert.data });
}
