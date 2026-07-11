import { NextRequest, NextResponse } from "next/server";
import { normalizeExtractedBooking, saveConfirmedBooking } from "@/lib/roamly/bookings";
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

  const booking = normalizeExtractedBooking((body.booking || body) as Record<string, unknown>);
  const saved = await saveConfirmedBooking(auth.supabase, { userId: auth.user.id, tripId, booking });
  if (saved.error) return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });

  if (tripHasLiveCompanionUnlock(ownership.data)) {
    await scheduleCompanionEvents(auth.supabase, tripId);
  }
  return NextResponse.json({ ok: true, booking: saved.booking });
}
