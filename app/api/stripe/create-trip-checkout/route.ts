import { NextRequest, NextResponse } from "next/server";
import {
  createBundleCheckoutSession,
  createItineraryCheckoutSession,
  createTrackingCheckoutSession
} from "@/lib/roamly/billing";
import { requireUser } from "@/lib/roamly/auth";
import { recordAppEvent } from "@/lib/roamly/events";

function normalizeKind(value: unknown) {
  if (value === "itinerary" || value === "itinerary_unlock") return "itinerary";
  if (value === "features" || value === "tracking" || value === "tracking_addon") return "tracking";
  return "bundle";
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  const kind = normalizeKind(body.checkoutKind || body.kind || body.purchaseType);

  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });

  const checkout =
    kind === "itinerary"
      ? await createItineraryCheckoutSession(auth.supabase, auth.user, tripId)
      : kind === "tracking"
        ? await createTrackingCheckoutSession(auth.supabase, auth.user, tripId)
        : await createBundleCheckoutSession(auth.supabase, auth.user, tripId);

  if (!checkout.ok) {
    return NextResponse.json(
      { ok: false, error: checkout.error, message: "message" in checkout ? checkout.message : undefined },
      { status: checkout.status || 500 }
    );
  }

  await recordAppEvent(auth.supabase, {
    userId: auth.user.id,
    eventType: "checkout_opened",
    metadata: {
      tripId,
      checkoutKind: kind,
      qa_tester: "tester" in checkout ? checkout.tester === true : false,
      alreadyUnlocked: "alreadyUnlocked" in checkout ? checkout.alreadyUnlocked : false
    }
  });

  return NextResponse.json({
    ok: true,
    url: checkout.url,
    tester: "tester" in checkout ? checkout.tester === true : false,
    alreadyActivated: "alreadyUnlocked" in checkout ? checkout.alreadyUnlocked : false
  });
}
