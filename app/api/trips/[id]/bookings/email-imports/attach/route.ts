import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { createTripBooking, type TripBookingInput } from "@/lib/roamly/bookingWallet";
import { reconcileTripBookings } from "@/lib/roamly/brain/bookingReconciliation";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const PENDING_STATUSES = new Set(["unmatched", "needs_confirmation"]);

/**
 * Attaches an email-extracted booking to this trip. The traveler explicitly
 * choosing "Attach to this trip" is the confirmation: the booking facts came
 * from a real confirmation email and the traveler confirmed the placement.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const extractionId =
    body && typeof body === "object" && typeof body.extractionId === "string" ? body.extractionId : "";
  if (!extractionId) {
    return NextResponse.json({ ok: false, error: "Choose an import to attach." }, { status: 400 });
  }

  const { data: row, error: lookupError } = await auth.supabase
    .from("booking_extraction_results")
    .select("id,user_id,trip_id,match_status,source_reference,email_message_id,extracted_booking_json")
    .eq("id", extractionId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (lookupError || !row) {
    return NextResponse.json({ ok: false, error: "That import could not be found." }, { status: 404 });
  }
  if (!PENDING_STATUSES.has(String(row.match_status))) {
    return NextResponse.json({ ok: false, error: "That import was already handled." }, { status: 409 });
  }

  const extracted = ((row.extracted_booking_json || {}) as Partial<TripBookingInput>) || {};
  const attachedAt = new Date().toISOString();

  const saved = await createTripBooking({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id,
    input: {
      ...extracted,
      sourceType: "email",
      sourceReference:
        extracted.sourceReference ||
        (typeof row.source_reference === "string" ? row.source_reference : null) ||
        (typeof row.email_message_id === "string" ? row.email_message_id : null),
      bookingStatus: extracted.bookingStatus || "confirmed",
      travelerConfirmed: true,
      lastSyncedAt: attachedAt,
      reservationRequirements: {
        ...(extracted.reservationRequirements && typeof extracted.reservationRequirements === "object"
          ? extracted.reservationRequirements
          : {}),
        email_import: {
          attached_by: "traveler",
          extraction_id: extractionId,
          attached_at: attachedAt
        }
      }
    }
  });

  if (saved.error || !saved.booking) {
    return NextResponse.json(
      { ok: false, error: "We could not save that booking. Your trip is unchanged." },
      { status: 400 }
    );
  }

  await auth.supabase
    .from("booking_extraction_results")
    .update({
      trip_id: id,
      match_status: "attached",
      matched_booking_id: saved.booking.id,
      applied_at: attachedAt
    })
    .eq("id", extractionId)
    .eq("user_id", auth.user.id);

  await reconcileTripBookings({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id,
    sourceBookingId: saved.booking.id
  }).catch(() => null);

  return NextResponse.json({ ok: true, bookingId: saved.booking.id });
}
