import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import type { TripBookingInput } from "@/lib/roamly/bookingWallet";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Lists email-extracted bookings that still need the traveler's review:
 * extractions that could not be matched to a trip ("unmatched"), plus ones
 * matched to this trip but held back for confirmation ("needs_confirmation").
 *
 * G13: also lists quarantined messages — travel_email_messages rows
 * with processing_result "error", which the sync loop writes when a
 * single message fails processing instead of stalling the cursor on
 * it. They carry no booking (the message could not be read), so they
 * are returned separately as `quarantined`, never merged into
 * `imports` and never silently dropped. A later successful reprocess
 * (reconnect backfill) overwrites the row and it leaves this list.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const { data, error } = await auth.supabase
    .from("booking_extraction_results")
    .select("id,trip_id,match_status,overall_confidence,match_reasons,extracted_booking_json,created_at")
    .eq("user_id", auth.user.id)
    .in("match_status", ["unmatched", "needs_confirmation"])
    .or(`trip_id.eq.${id},trip_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json(
      { ok: false, error: "We could not load email imports right now." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  // Quarantined messages fail soft: if this query fails, the imports
  // above still render and the list is empty rather than erroring.
  const { data: quarantinedRows } = await auth.supabase
    .from("travel_email_messages")
    .select("id,provider_message_id,subject,filter_reasons,created_at")
    .eq("user_id", auth.user.id)
    .eq("provider", "gmail")
    .eq("processing_result", "error")
    .order("created_at", { ascending: false })
    .limit(20);
  const quarantined = ((quarantinedRows || []) as Array<{
    id: unknown;
    provider_message_id: unknown;
    subject: unknown;
    filter_reasons: unknown;
    created_at: unknown;
  }>).map((row) => ({
    id: String(row.id),
    providerMessageId: typeof row.provider_message_id === "string" ? row.provider_message_id : null,
    subject: text(row.subject),
    reasons: Array.isArray(row.filter_reasons)
      ? row.filter_reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
    createdAt: typeof row.created_at === "string" ? row.created_at : null
  }));

  const imports = ((data || []) as Array<{
    id: unknown;
    trip_id: unknown;
    overall_confidence: unknown;
    match_reasons: unknown;
    extracted_booking_json: unknown;
  }>).map((row) => {
    const booking = ((row.extracted_booking_json || {}) as Partial<TripBookingInput>) || {};
    return {
      id: String(row.id),
      tripId: typeof row.trip_id === "string" ? row.trip_id : null,
      bookingType: text(booking.bookingType),
      title: text(booking.title),
      provider: text(booking.provider),
      confirmationCode: text(booking.confirmationCode),
      flightNumber: text(booking.flightNumber),
      startTime: text(booking.startTime) || text(booking.checkInTime),
      endTime: text(booking.endTime) || text(booking.checkOutTime),
      origin: text(booking.origin),
      destination: text(booking.destination),
      overallConfidence: typeof row.overall_confidence === "number" ? row.overall_confidence : null,
      matchReasons: Array.isArray(row.match_reasons)
        ? row.match_reasons.filter((reason): reason is string => typeof reason === "string")
        : []
    };
  });

  return NextResponse.json({ ok: true, imports, quarantined }, { headers: { "Cache-Control": "private, no-store" } });
}
