import { NextRequest, NextResponse } from "next/server";
import {
  GUEST_ITINERARY_COOKIE,
  verifyGuestItineraryCookie
} from "@/lib/roamly/guestItineraryAccess";
import {
  findConflictingGuestDeliveryEmail,
  isValidGuestDeliveryEmail,
  normalizeGuestDeliveryEmail,
  withGuestDeliveryEmail
} from "@/lib/roamly/guestDelivery";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/*
 * Guest delivery email (owner law, 2026-10-24): the guest saves an email
 * when day 1 is ready so the rest of the itinerary can be sent to them.
 * The email is also the one-free-per-email key — a second guest trip
 * cannot claim an email that already holds a free itinerary.
 */

function unavailable() {
  return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_UNAVAILABLE" }, { status: 503 });
}

export async function POST(request: NextRequest) {
  const access = verifyGuestItineraryCookie(request.cookies.get(GUEST_ITINERARY_COOKIE)?.value);
  if (!access) {
    return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_REQUIRED" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return unavailable();

  const guestUser = await admin.auth.admin.getUserById(access.userId);
  if (guestUser.data.user?.user_metadata?.roamly_guest_itinerary !== true) {
    return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_REQUIRED" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const rawEmail = typeof body?.email === "string" ? body.email : "";
  if (!isValidGuestDeliveryEmail(rawEmail)) {
    return NextResponse.json(
      { ok: false, error: "GUEST_EMAIL_INVALID", message: "That email doesn't look right — check it and try again." },
      { status: 400 }
    );
  }
  const email = normalizeGuestDeliveryEmail(rawEmail);

  const { data: trip, error: tripError } = await admin
    .from("roamly_trips")
    .select("id,user_id,metadata")
    .eq("id", access.tripId)
    .eq("user_id", access.userId)
    .maybeSingle();
  if (tripError) return unavailable();
  if (!trip) return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_REQUIRED" }, { status: 404 });

  // Re-saving the same email on the same trip is a no-op success.
  const existing = trip.metadata as Record<string, unknown> | null;
  if (typeof existing?.guestDeliveryEmail === "string" && normalizeGuestDeliveryEmail(existing.guestDeliveryEmail) === email) {
    return NextResponse.json({ ok: true, deliveryEmail: email });
  }

  // One free per email: another guest trip already holding this email
  // blocks a second claim. Only guest-owned trips count — a real
  // account's trip metadata never carries a guest delivery email, but
  // the owner check below keeps the rule exact anyway.
  const { data: candidates, error: candidatesError } = await admin
    .from("roamly_trips")
    .select("id,user_id,metadata")
    .filter("metadata->>guestDeliveryEmail", "eq", email);
  if (candidatesError) return unavailable();
  const rows = (candidates ?? []).filter((row) => row.id !== access.tripId);
  for (const row of rows) {
    const owner = await admin.auth.admin.getUserById(row.user_id);
    if (owner.data.user?.user_metadata?.roamly_guest_itinerary !== true) continue;
    if (findConflictingGuestDeliveryEmail([row], access.tripId, email)) {
      return NextResponse.json(
        {
          ok: false,
          error: "GUEST_EMAIL_ALREADY_USED",
          message:
            "This email already has a free itinerary. Use the recovery link below to get that trip back instead of starting a second free one."
        },
        { status: 409 }
      );
    }
  }

  const merged = withGuestDeliveryEmail(trip.metadata, email);
  const { error: updateError } = await admin
    .from("roamly_trips")
    .update({ metadata: merged })
    .eq("id", access.tripId)
    .eq("user_id", access.userId);
  if (updateError) return unavailable();

  return NextResponse.json({ ok: true, deliveryEmail: email });
}
