import { NextRequest, NextResponse } from "next/server";
import { normalizeExtractedBooking, saveConfirmedBooking } from "@/lib/roamly/bookings";
import { scheduleCompanionEvents, tripHasLiveCompanionUnlock } from "@/lib/roamly/tripCompanion";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });

  const ownership = await supabase
    .from("roamly_trips")
    .select("id,live_companion_unlocked,tracking_unlocked")
    .eq("id", tripId)
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (ownership.error) return NextResponse.json({ ok: false, error: ownership.error.message }, { status: 500 });
  if (!ownership.data) return NextResponse.json({ ok: false, error: "Trip access denied." }, { status: 403 });

  const booking = normalizeExtractedBooking((body.booking || body) as Record<string, unknown>);
  const saved = await saveConfirmedBooking(supabase, { userId: data.user.id, tripId, booking });
  if (saved.error) return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });

  if (tripHasLiveCompanionUnlock(ownership.data)) {
    await scheduleCompanionEvents(supabase, tripId);
  }
  return NextResponse.json({ ok: true, booking: saved.booking });
}
