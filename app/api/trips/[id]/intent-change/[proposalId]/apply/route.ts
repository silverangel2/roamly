import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTripBundle } from "@/lib/trips";
import { reconcileTripCompanionSlots } from "@/lib/roamly/tripTravelers";
import { payloadFromTrip } from "@/lib/roamly/marketPriceRefresh";
import { prepareStagedGenerationContext, startStagedItineraryGeneration } from "@/lib/roamly/stagedItineraryGeneration";
import { scheduleStagedGenerationAdvance } from "@/lib/roamly/stagedGenerationBackground";

type RouteContext = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(request: Request, context: RouteContext) {
  void request;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId, proposalId } = await context.params;
  const result = await auth.supabase.rpc("roamly_reserve_customer_trip_intent_change", { p_proposal_id: proposalId, p_trip_id: tripId });
  if (result.error) {
    const stale = result.error.code === "40001" || result.error.message.includes("INTENT_CHANGE_");
    return NextResponse.json({ ok: false, error: stale ? "The trip changed while this request was waiting. Review travelers and preferences again." : "The intent change could not be started." }, { status: stale ? 409 : 400 });
  }
  const successorTripId = result.data?.successorTripId as string | null;
  if (successorTripId && result.data?.status === "generating" && result.data?.idempotent !== true) {
    try {
      const successor = await getTripBundle(auth.supabase, auth.user.id, successorTripId);
      if (!successor.data?.trip) throw new Error("SUCCESSOR_TRIP_NOT_FOUND");
      const admin = createSupabaseAdminClient();
      if (!admin) throw new Error("INTENT_CHANGE_STORAGE_UNAVAILABLE");
      const slots = await reconcileTripCompanionSlots({ admin, trip: successor.data.trip });
      if (!slots.ok) throw new Error(slots.error);
      const payload = payloadFromTrip(successor.data.trip);
      const generationContext = await prepareStagedGenerationContext({ supabase: auth.supabase, userId: auth.user.id, tripId: successorTripId, payload });
      await startStagedItineraryGeneration({ supabase: auth.supabase, userId: auth.user.id, tripId: successorTripId, payload: { ...payload, priceDiscoveryId: generationContext.priceDiscoveryId, budgetConstraint: generationContext.budgetConstraint }, requestId: proposalId, unlockSource: "admin", context: generationContext });
    } catch (error) {
      const admin = createSupabaseAdminClient();
      if (admin) await admin.rpc("roamly_fail_customer_trip_intent_change", { p_proposal_id: proposalId, p_user_id: auth.user.id, p_successor_trip_id: successorTripId, p_reason: error instanceof Error ? error.message : "GENERATION_START_FAILED" });
      return NextResponse.json({ ok: false, error: "The new itinerary could not be started. Your original trip is unchanged." }, { status: 502 });
    }
    scheduleStagedGenerationAdvance({ tripId: successorTripId, origin: new URL(request.url).origin, reason: "customer_trip_intent_change_successor", requestId: proposalId });
  }
  return NextResponse.json({ ok: true, status: result.data?.status || "generating", successorTripId });
}
