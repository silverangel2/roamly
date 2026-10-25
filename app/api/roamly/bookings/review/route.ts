import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { reviewTripBooking, type BookingReviewAction } from "@/lib/roamly/bookingWallet";

/**
 * Traveler review of one wallet booking (B11). Actions are recorded in the
 * row's metadata only — booking_status and traveler_confirmed are never
 * changed here, so a customer assertion can never become provider
 * confirmation. "assert" = these details are mine; "dismiss" = ignore this
 * item (optional reason); "correct" = store corrected fields as a pending
 * customer assertion.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  const bookingId = typeof body.bookingId === "string" ? body.bookingId : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!tripId || !bookingId) return NextResponse.json({ ok: false, error: "Trip and booking are required." }, { status: 400 });
  if (action !== "assert" && action !== "dismiss" && action !== "correct") {
    return NextResponse.json({ ok: false, error: "Unknown review action." }, { status: 400 });
  }

  const result = await reviewTripBooking({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId,
    bookingId,
    action: action as BookingReviewAction,
    reason: typeof body.reason === "string" ? body.reason : null,
    corrections: body.corrections
  });
  if (!result.ok) {
    const status = result.error === "TRIP_NOT_FOUND" || result.error === "BOOKING_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, reviewState: result.reviewState, pendingCorrections: result.pendingCorrections });
}
