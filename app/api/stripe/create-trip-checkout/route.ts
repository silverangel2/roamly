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
  if (value === "bundle" || value === "complete" || value === "complete_trip") return "bundle";
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  const kind = normalizeKind(body.checkoutKind || body.kind || body.purchaseType);

  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });
  if (!kind) {
    return NextResponse.json(
      { ok: false, error: "INVALID_CHECKOUT_KIND", code: "INVALID_CHECKOUT_KIND", message: "Choose a valid Roamly checkout option." },
      { status: 400 }
    );
  }

  const checkout = await (async () => {
    try {
      return kind === "itinerary"
        ? await createItineraryCheckoutSession(auth.supabase, auth.user, tripId)
        : kind === "tracking"
          ? await createTrackingCheckoutSession(auth.supabase, auth.user, tripId)
          : await createBundleCheckoutSession(auth.supabase, auth.user, tripId);
    } catch (error) {
      console.error("[Roamly] Checkout creation failed", {
        userId: auth.user.id,
        tripId,
        checkoutKind: kind,
        error: error instanceof Error ? error.message : "Unknown checkout error"
      });
      return {
        ok: false as const,
        status: 500,
        error: "CHECKOUT_SESSION_CREATE_FAILED",
        message: "Stripe checkout could not be opened. Please retry or contact support if this persists."
      };
    }
  })();

  if (!checkout.ok) {
    console.error("[Roamly] Checkout unavailable", {
      userId: auth.user.id,
      tripId,
      checkoutKind: kind,
      code: checkout.error,
      status: checkout.status || 500,
      technicalMessage:
        "message" in checkout && typeof checkout.message === "string"
          ? checkout.message
          : undefined
    });

    return NextResponse.json(
      {
        ok: false,
        error: checkout.error,
        code: checkout.error,
        message:
          "This purchase option is temporarily unavailable. You have not been charged."
      },
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
