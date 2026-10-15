import { NextRequest, NextResponse } from "next/server";
import { requireUserOrFieldTest } from "@/lib/roamly/fieldTestAccess";
import { dismissTripGap, getTripGapCards, type GapWatcherTrip } from "@/lib/roamly/tripGapWatcher";
import { TRIP_GAP_TYPES, type TripGapType } from "@/lib/roamly/tripGapCore";
import { tripHasTrackingUnlock } from "@/lib/roamly/billing";

function isGapType(value: unknown): value is TripGapType {
  return typeof value === "string" && (TRIP_GAP_TYPES as readonly string[]).includes(value);
}

/**
 * GET /api/roamly/trips/[tripId]/gaps
 * Dismissible trip-gap offers for the itinerary page.
 * Only for paid/active (tracking-unlocked) trips — never for free previews,
 * so the free-tier funnel and the ONE-free-itinerary rule are untouched.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await context.params;
  const auth = await requireUserOrFieldTest(tripId);
  if (!auth.ok) return auth.response;

  const { data: trip, error } = await auth.supabase
    .from("roamly_trips")
    .select("id,user_id,destination_name,metadata,tracking_unlocked,live_companion_unlocked,status")
    .eq("id", tripId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!trip) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  if (String(trip.status || "").toLowerCase() === "cancelled") {
    return NextResponse.json({ ok: true, gaps: [] });
  }
  if (!tripHasTrackingUnlock(trip as { tracking_unlocked?: boolean | null })) {
    return NextResponse.json({ ok: true, gaps: [], gated: "tracking_locked" });
  }

  try {
    const cards = await getTripGapCards({
      supabase: auth.supabase,
      userId: auth.userId,
      trip: trip as unknown as GapWatcherTrip
    });
    return NextResponse.json({ ok: true, gaps: cards.filter((card) => !card.dismissed) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Gap lookup failed." }, { status: 500 });
  }
}

/**
 * POST /api/roamly/trips/[tripId]/gaps { gapType }
 * Dismiss a gap card. Dismissed gaps are never offered again.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await context.params;
  const auth = await requireUserOrFieldTest(tripId);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { gapType?: unknown };
  if (!isGapType(body.gapType)) {
    return NextResponse.json({ ok: false, error: "gapType is required." }, { status: 400 });
  }
  const result = await dismissTripGap({ supabase: auth.supabase, userId: auth.userId, tripId, gapType: body.gapType });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, dismissed: body.gapType });
}
