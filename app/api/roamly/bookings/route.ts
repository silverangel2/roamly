import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { listTripBookings } from "@/lib/roamly/bookingWallet";

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const tripId = request.nextUrl.searchParams.get("tripId") || "";
  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });

  const result = await listTripBookings({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId,
    includeSegments: true
  });

  if (result.error) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, bookings: result.bookings });
}
