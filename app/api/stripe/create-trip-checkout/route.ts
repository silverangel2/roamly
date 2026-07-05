import { NextRequest, NextResponse } from "next/server";
import {
  createBundleCheckoutSession,
  createItineraryCheckoutSession,
  createTrackingCheckoutSession
} from "@/lib/roamly/billing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function normalizeKind(value: unknown) {
  if (value === "itinerary" || value === "itinerary_unlock") return "itinerary";
  if (value === "features" || value === "tracking" || value === "tracking_addon") return "tracking";
  return "bundle";
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  const kind = normalizeKind(body.checkoutKind || body.kind || body.purchaseType);

  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });

  const checkout =
    kind === "itinerary"
      ? await createItineraryCheckoutSession(supabase, data.user, tripId)
      : kind === "tracking"
        ? await createTrackingCheckoutSession(supabase, data.user, tripId)
        : await createBundleCheckoutSession(supabase, data.user, tripId);

  if (!checkout.ok) {
    return NextResponse.json(
      { ok: false, error: checkout.error, message: "message" in checkout ? checkout.message : undefined },
      { status: checkout.status || 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    url: checkout.url,
    alreadyActivated: "alreadyUnlocked" in checkout ? checkout.alreadyUnlocked : false
  });
}
