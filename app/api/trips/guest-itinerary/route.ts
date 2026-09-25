import { randomUUID, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { generateTripForActor } from "@/app/api/trips/generate/route";
import {
  GUEST_ITINERARY_COOKIE,
  guestItineraryCookieOptions,
  signGuestItineraryCookie,
  verifyGuestItineraryCookie
} from "@/lib/roamly/guestItineraryAccess";
import { GUEST_ITINERARY_PATH, publicGuestItineraryView } from "@/lib/roamly/guestItineraryView";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 90;

function guestUnavailable(message = "Roamly could not start a free itinerary right now.") {
  return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_UNAVAILABLE", message }, { status: 503 });
}

export async function GET(request: NextRequest) {
  const access = verifyGuestItineraryCookie(request.cookies.get(GUEST_ITINERARY_COOKIE)?.value);
  if (!access) {
    return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_REQUIRED" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return guestUnavailable();

  const { data: trip, error } = await admin
    .from("roamly_trips")
    .select("id,title,destination_name,status,itinerary_status,metadata")
    .eq("id", access.tripId)
    .eq("user_id", access.userId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_UNAVAILABLE" }, { status: 500 });
  if (!trip) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });

  const itineraryResult = await admin
    .from("roamly_itineraries")
    .select("full_json")
    .eq("trip_id", access.tripId)
    .eq("user_id", access.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const view = publicGuestItineraryView({
    tripTitle: trip.title,
    destination: trip.destination_name,
    tripStatus: trip.status,
    itineraryStatus: trip.itinerary_status,
    fullJson: itineraryResult.data?.full_json,
    metadata: trip.metadata
  });

  return NextResponse.json({ ok: true, tripId: access.tripId, ...view });
}

export async function POST(request: NextRequest) {
  const existing = verifyGuestItineraryCookie(request.cookies.get(GUEST_ITINERARY_COOKIE)?.value);
  if (existing) {
    return NextResponse.json(
      { ok: true, status: "queued", tripId: existing.tripId, previewUrl: GUEST_ITINERARY_PATH },
      { status: 202 }
    );
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return guestUnavailable();

  const created = await admin.auth.admin.createUser({
    email: `guest.${randomUUID()}@example.com`,
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
    user_metadata: { roamly_guest_itinerary: true }
  });
  if (created.error || !created.data.user) {
    console.error("[Roamly guest itinerary] Guest user create failed", created.error?.message);
    return guestUnavailable();
  }

  const generated = await generateTripForActor(request, {
    supabase: admin as NonNullable<Parameters<typeof generateTripForActor>[1]["supabase"]>,
    user: { id: created.data.user.id, email: created.data.user.email }
  });
  const payload = (await generated.json().catch(() => null)) as { tripId?: string } | null;
  if (generated.status === 202 && payload?.tripId) {
    const token = signGuestItineraryCookie(String(payload.tripId), created.data.user.id);
    const response = NextResponse.json({ ...payload, previewUrl: GUEST_ITINERARY_PATH }, { status: 202 });
    if (token) response.cookies.set(GUEST_ITINERARY_COOKIE, token, guestItineraryCookieOptions());
    return response;
  }

  return NextResponse.json(payload || { ok: false, error: "ITINERARY_GENERATION_FAILED" }, { status: generated.status });
}
