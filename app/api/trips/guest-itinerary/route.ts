import { randomUUID, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { generateTripForActor } from "@/lib/roamly/tripGenerationRoute";
import {
  GUEST_ITINERARY_COOKIE,
  guestItineraryCookieOptions,
  signGuestItineraryCookie,
  verifyGuestItineraryCookie
} from "@/lib/roamly/guestItineraryAccess";
import {
  GUEST_ITINERARY_PATH,
  GUEST_PAID_ENTITLEMENT_MESSAGE,
  guestFreeItineraryEntitlement,
  publicGuestItineraryView
} from "@/lib/roamly/guestItineraryView";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 90;

const GUEST_TRIP_COLUMNS = "id,user_id,title,destination_name,status,itinerary_status,itinerary_payment_status,itinerary_unlock_source,tracking_unlocked,live_companion_unlocked,metadata";

function guestUnavailable(message = "Roamly could not start a free itinerary right now.") {
  return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_UNAVAILABLE", message }, { status: 503 });
}

function guestPaymentRequired() {
  return NextResponse.json(
    { ok: false, error: "PAYMENT_REQUIRED", message: GUEST_PAID_ENTITLEMENT_MESSAGE },
    { status: 402 }
  );
}

function guestFreeQueued(tripId: string) {
  return NextResponse.json(
    { ok: true, status: "queued", tripId, previewUrl: GUEST_ITINERARY_PATH, unlockSource: "free" },
    { status: 202 }
  );
}

async function guestUserRecord(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, userId: string) {
  const result = await admin.auth.admin.getUserById(userId);
  return result.data.user || null;
}

function isGuestItineraryUser(user: { user_metadata?: Record<string, unknown> | null } | null) {
  return user?.user_metadata?.roamly_guest_itinerary === true;
}

async function loadGuestTrip(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, tripId: string, userId: string) {
  return admin
    .from("roamly_trips")
    .select(GUEST_TRIP_COLUMNS)
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
}

async function guestGenerationRequest(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  delete body.tripId;
  delete body.trip_id;
  return new NextRequest(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function GET(request: NextRequest) {
  const access = verifyGuestItineraryCookie(request.cookies.get(GUEST_ITINERARY_COOKIE)?.value);
  if (!access) {
    return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_REQUIRED" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return guestUnavailable();

  const guestUser = await guestUserRecord(admin, access.userId);
  if (!isGuestItineraryUser(guestUser)) return guestPaymentRequired();

  const { data: trip, error } = await loadGuestTrip(admin, access.tripId, access.userId);
  if (error) return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_UNAVAILABLE" }, { status: 500 });
  if (!trip) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  if (!guestFreeItineraryEntitlement(trip).allowed) return guestPaymentRequired();

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

  return NextResponse.json({ ok: true, tripId: access.tripId, unlockSource: "free", ...view });
}

export async function POST(request: NextRequest) {
  const existing = verifyGuestItineraryCookie(request.cookies.get(GUEST_ITINERARY_COOKIE)?.value);
  const admin = createSupabaseAdminClient();
  if (!admin) return guestUnavailable();

  if (existing) {
    const guestUser = await guestUserRecord(admin, existing.userId);
    if (!isGuestItineraryUser(guestUser)) return guestPaymentRequired();
    const { data: trip, error } = await loadGuestTrip(admin, existing.tripId, existing.userId);
    if (error) return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_UNAVAILABLE" }, { status: 500 });
    if (!trip || !guestFreeItineraryEntitlement(trip).allowed) return guestPaymentRequired();
    return guestFreeQueued(existing.tripId);
  }

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

  const generated = await generateTripForActor(await guestGenerationRequest(request), {
    supabase: admin as NonNullable<Parameters<typeof generateTripForActor>[1]["supabase"]>,
    user: { id: created.data.user.id, email: null }
  });
  const payload = (await generated.json().catch(() => null)) as { tripId?: string; unlockSource?: string; error?: string; message?: string } | null;
  if (generated.status === 202 && payload?.tripId && payload.unlockSource === "free") {
    const token = signGuestItineraryCookie(String(payload.tripId), created.data.user.id);
    const response = guestFreeQueued(String(payload.tripId));
    if (token) response.cookies.set(GUEST_ITINERARY_COOKIE, token, guestItineraryCookieOptions());
    return response;
  }

  if (generated.status === 402 || payload?.error === "PAYMENT_REQUIRED" || (payload?.unlockSource && payload.unlockSource !== "free")) {
    return guestPaymentRequired();
  }

  return NextResponse.json(
    {
      ok: false,
      error: payload?.error || "GUEST_ITINERARY_UNAVAILABLE",
      message: payload?.message || "Roamly could not start a free itinerary right now."
    },
    { status: generated.status || 500 }
  );
}
