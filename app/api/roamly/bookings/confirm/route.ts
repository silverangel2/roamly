import { NextRequest, NextResponse } from "next/server";
import { normalizeExtractedBooking, verifyBookingEvidenceToken } from "@/lib/roamly/bookings";
import { createTripBooking } from "@/lib/roamly/bookingWallet";
import { scheduleCompanionEvents, tripHasLiveCompanionUnlock } from "@/lib/roamly/tripCompanion";
import { requireUser } from "@/lib/roamly/auth";

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });

  const ownership = await auth.supabase
    .from("roamly_trips")
    .select("id,tracking_unlocked")
    .eq("id", tripId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (ownership.error) return NextResponse.json({ ok: false, error: ownership.error.message }, { status: 500 });
  if (!ownership.data) return NextResponse.json({ ok: false, error: "Trip access denied." }, { status: 403 });

  const extracted = verifyBookingEvidenceToken(typeof body.evidenceToken === "string" ? body.evidenceToken : "", { userId: auth.user.id, tripId });
  if (!extracted) return NextResponse.json({ ok: false, error: "Fresh server-verified booking evidence is required." }, { status: 400 });
  const booking = normalizeExtractedBooking(extracted);
  const dateTime = (date: string, time: string) => date ? `${date}T${time || "00:00:00"}Z` : null;
  const saved = await createTripBooking({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId,
    input: {
      bookingType: booking.booking_type,
      bookingStatus: "needs_confirmation",
      travelerConfirmed: false,
      provider: booking.provider_name,
      confirmationCode: booking.confirmation_number,
      sourceType: "screenshot",
      title: booking.title,
      startTime: dateTime(booking.start_date, booking.start_time),
      endTime: dateTime(booking.end_date, booking.end_time),
      origin: booking.origin,
      destination: booking.destination,
      locationName: booking.city,
      address: booking.address,
      flightNumber: booking.flight_number,
      airlineCode: booking.airline_code,
      terminal: booking.terminal,
      gate: booking.gate,
      totalPrice: booking.amount_cents == null ? null : booking.amount_cents / 100,
      currency: booking.currency,
      metadata: {
        evidenceState: "pending",
        extractionConfidence: booking.extraction_confidence,
        rawExtractedText: booking.raw_extracted_text,
        sourceMetadata: booking.metadata
      }
    }
  });
  if (saved.error) return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });

  if (tripHasLiveCompanionUnlock(ownership.data)) {
    await scheduleCompanionEvents(auth.supabase, tripId);
  }
  return NextResponse.json({ ok: true, booking: saved.booking });
}
