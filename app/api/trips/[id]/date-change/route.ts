import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTripBundle } from "@/lib/trips";
import { buildBookingSnapshot, buildDateChangePreview, buildSuccessorIntentSnapshot, dateChangeLifecycleAllowed, evaluateDateChangeBookingStatuses, validateRequestedDateChange } from "@/lib/roamly/customerDateChange";

type RouteContext = { params: Promise<{ id: string }> };
const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const requestedStart = date(body.startDate);
  const requestedEnd = date(body.endDate);
  if (!requestedStart || !requestedEnd) return NextResponse.json({ ok: false, error: "INVALID_DATE_RANGE" }, { status: 400 });
  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data?.trip || !bundle.data.itinerary) return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
  const trip = bundle.data.trip;
  if (!dateChangeLifecycleAllowed(trip.status)) return NextResponse.json({ ok: false, error: "DATE_CHANGE_TRIP_NOT_ELIGIBLE" }, { status: 409 });
  const valid = validateRequestedDateChange(requestedStart, requestedEnd, trip.start_date, trip.end_date);
  if (!valid.ok) return NextResponse.json({ ok: false, error: valid.code, message: valid.message }, { status: 400 });
  const bookings = await buildBookingSnapshot(auth.supabase, auth.user.id, tripId);
  if (bookings.error || !bookings.snapshot) return NextResponse.json({ ok: false, error: "BOOKING_STATE_UNAVAILABLE" }, { status: 503 });
  const eligible = evaluateDateChangeBookingStatuses(bookings.statuses);
  if (!eligible.ok) return NextResponse.json({ ok: false, error: eligible.code, message: eligible.message }, { status: 409 });
  const revision = Number((bundle.data.itinerary as typeof bundle.data.itinerary & { repair_revision?: number }).repair_revision);
  if (!Number.isSafeInteger(revision) || revision < 0) return NextResponse.json({ ok: false, error: "DATE_CHANGE_SCHEMA_NOT_READY" }, { status: 503 });
  const hash = await auth.supabase.rpc("roamly_itinerary_content_hash", { value: bundle.data.itinerary.full_json });
  if (hash.error || typeof hash.data !== "string") return NextResponse.json({ ok: false, error: "DATE_CHANGE_SCHEMA_NOT_READY" }, { status: 503 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "DATE_CHANGE_STORAGE_UNAVAILABLE" }, { status: 503 });
  const intent = buildSuccessorIntentSnapshot(trip as unknown as Record<string, unknown>);
  const preview = buildDateChangePreview({ currentStart: trip.start_date, currentEnd: trip.end_date, requestedStart, requestedEnd, bookingStatuses: bookings.statuses });
  const insert = await admin.from("roamly_customer_trip_date_changes").insert({ original_trip_id: tripId, user_id: auth.user.id, original_itinerary_id: bundle.data.itinerary.id, requested_start_date: requestedStart, requested_end_date: requestedEnd, expected_start_date: trip.start_date, expected_end_date: trip.end_date, expected_trip_status: trip.status, expected_revision: revision, expected_content_hash: hash.data, expected_booking_snapshot: bookings.snapshot, intent_snapshot: intent, result: preview, status: "awaiting_approval" }).select("id,requested_start_date,requested_end_date,result,status").single();
  if (insert.error || !insert.data) return NextResponse.json({ ok: false, error: insert.error?.code === "23505" ? "DATE_CHANGE_ALREADY_PENDING" : "DATE_CHANGE_CREATE_FAILED" }, { status: insert.error?.code === "23505" ? 409 : 500 });
  return NextResponse.json({ ok: true, proposal: insert.data });
}
