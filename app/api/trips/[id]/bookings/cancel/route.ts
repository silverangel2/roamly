import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { cancelTripBooking } from "@/lib/roamly/bookingWallet";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Traveler cancel for one tracked booking. The booking must belong to the
 * signed-in user and their trip or the request is refused. Cancel only
 * stops Roamly tracking: it never touches Stripe, never refunds anything,
 * and never cancels a Roamly purchase/unlock. The row stays in history
 * with status "cancelled" — it is never hard-deleted.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const bookingId =
    typeof body.bookingId === "string"
      ? body.bookingId
      : typeof body.booking_id === "string"
        ? body.booking_id
        : "";
  if (!bookingId) {
    return NextResponse.json({ ok: false, error: "BOOKING_ID_REQUIRED" }, { status: 400 });
  }

  const result = await cancelTripBooking({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId,
    bookingId
  });

  if (!result.ok) {
    const status =
      result.error === "BOOKING_NOT_FOUND" || result.error === "TRIP_NOT_FOUND"
        ? 404
        : result.error === "BOOKING_ALREADY_SUPERSEDED" ||
            result.error === "BOOKING_ALREADY_REFUNDED"
          ? 400
          : 500;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  return NextResponse.json({
    ok: true,
    idempotent: result.idempotent,
    alreadyCancelled: result.alreadyCancelled,
    booking: result.booking
  });
}
