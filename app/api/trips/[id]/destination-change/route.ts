import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTripBundle } from "@/lib/trips";
import { buildBudgetSnapshot, buildDestinationBookingSnapshot, buildDestinationChangePreview, buildGenerationSnapshot, buildOriginSnapshot, buildSuccessorDestinationIntent, destinationIntentHash, destinationLifecycleAllowed, destinationSnapshotForTrip, destinationSnapshotHash, destinationSourceDatesEligible, evaluateDestinationBookings, normalizeDestinationSnapshot, validateDestinationRequest } from "@/lib/roamly/customerDestinationChange";
import { getTripPlanningMetadata } from "@/lib/roamly/tripMetadata";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const requested = normalizeDestinationSnapshot(body.destination);
  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data?.trip || !bundle.data.itinerary) return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
  const trip = bundle.data.trip;
  if (!destinationLifecycleAllowed(trip.status)) return NextResponse.json({ ok: false, error: "DESTINATION_CHANGE_TRIP_NOT_ELIGIBLE" }, { status: 409 });
  const dates = destinationSourceDatesEligible(trip.start_date, trip.end_date);
  if (!dates.ok) return NextResponse.json({ ok: false, error: dates.code, message: dates.message }, { status: 409 });
  const planning = getTripPlanningMetadata(trip.metadata);
  if (Array.isArray(planning.destinationStops) && planning.destinationStops.length > 0) return NextResponse.json({ ok: false, error: "MULTI_CITY_DESTINATION_NOT_SUPPORTED" }, { status: 409 });
  const current = destinationSnapshotForTrip(trip as unknown as Record<string, unknown>);
  if (!current) return NextResponse.json({ ok: false, error: "CURRENT_DESTINATION_UNRESOLVED", message: "This trip's current destination is not structured enough to create a safe successor." }, { status: 409 });
  const valid = validateDestinationRequest(current, requested);
  if (!valid.ok) return NextResponse.json({ ok: false, error: valid.code, message: valid.message }, { status: 400 });
  const bookings = await buildDestinationBookingSnapshot(auth.supabase, auth.user.id, tripId);
  if (bookings.error || !bookings.snapshot) return NextResponse.json({ ok: false, error: "BOOKING_STATE_UNAVAILABLE" }, { status: 503 });
  const eligible = evaluateDestinationBookings(bookings.rows);
  if (!eligible.ok) return NextResponse.json({ ok: false, error: eligible.code, message: eligible.message }, { status: 409 });
  const revision = Number((bundle.data.itinerary as typeof bundle.data.itinerary & { repair_revision?: number }).repair_revision);
  if (!Number.isSafeInteger(revision) || revision < 0) return NextResponse.json({ ok: false, error: "DESTINATION_CHANGE_SCHEMA_NOT_READY" }, { status: 503 });
  const hash = await auth.supabase.rpc("roamly_itinerary_content_hash", { value: bundle.data.itinerary.full_json });
  if (hash.error || typeof hash.data !== "string") return NextResponse.json({ ok: false, error: "DESTINATION_CHANGE_SCHEMA_NOT_READY" }, { status: 503 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "DESTINATION_CHANGE_STORAGE_UNAVAILABLE" }, { status: 503 });
  const requestedSnapshot = requested!;
  const intent = buildSuccessorDestinationIntent(trip as unknown as Record<string, unknown>, requestedSnapshot);
  const preview = buildDestinationChangePreview(current, requestedSnapshot, bookings.rows.map((row) => String(row.booking_status || "unknown")));
  const insert = await admin.from("roamly_customer_trip_destination_changes").insert({
    original_trip_id: tripId,
    user_id: auth.user.id,
    original_itinerary_id: bundle.data.itinerary.id,
    requested_destination_snapshot: requestedSnapshot,
    requested_destination_hash: destinationSnapshotHash(requestedSnapshot),
    expected_destination_snapshot: current,
    expected_destination_hash: destinationSnapshotHash(current),
    expected_origin_snapshot: buildOriginSnapshot(trip as unknown as Record<string, unknown>),
    expected_trip_status: trip.status,
    expected_itinerary_status: (trip as unknown as Record<string, unknown>).itinerary_status || null,
    expected_revision: revision,
    expected_content_hash: hash.data,
    expected_booking_snapshot: bookings.snapshot,
    expected_budget_snapshot: buildBudgetSnapshot(trip as unknown as Record<string, unknown>),
    expected_intent_snapshot: intent,
    expected_intent_hash: destinationIntentHash(intent),
    expected_price_discovery_id: trip.latest_price_discovery_id || null,
    expected_generation_snapshot: buildGenerationSnapshot(trip as unknown as Record<string, unknown>),
    result: preview,
    status: "awaiting_approval"
  }).select("id,status,result,requested_destination_snapshot").single();
  if (insert.error || !insert.data) return NextResponse.json({ ok: false, error: insert.error?.code === "23505" ? "DESTINATION_CHANGE_ALREADY_PENDING" : "DESTINATION_CHANGE_CREATE_FAILED" }, { status: insert.error?.code === "23505" ? 409 : 500 });
  return NextResponse.json({ ok: true, proposal: insert.data });
}
