import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTripBundle } from "@/lib/trips";
import { reconcileTripCompanionSlots } from "@/lib/roamly/tripTravelers";
import { payloadFromTrip } from "@/lib/roamly/marketPriceRefresh";
import { getStagedGenerationState, prepareStagedGenerationContext, startStagedItineraryGeneration } from "@/lib/roamly/stagedItineraryGeneration";
import { createOrResumeGenerationJob } from "@/lib/roamly/generationQueue";
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
  // KF-2 M6a (2026-11-02): the start block runs on a fresh reserve AND on
  // an idempotent replay that finds NO v2 generation state on the
  // successor. The reserve RPC inserts the successor draft/draft with
  // no generation key; a hard kill between reserve and the start's
  // first persist used to leave an orphan that a replay then reported
  // as 200 "generating" while skipping the start forever. A replay
  // WITH state keeps the old blind-200 behaviour: that trip is
  // generating and the recovery sweep (class C) can adopt it.
  // Route difference (traced): the intent start block additionally
  // reconciles companion slots via an admin client before preparing
  // the generation context; the replay re-runs that same block, so a
  // replayed orphan gets the slot reconciliation the fresh path gets.
  const freshStart = Boolean(successorTripId && result.data?.status === "generating" && result.data?.idempotent !== true);
  let replayStart = false;
  if (!freshStart && successorTripId && result.data?.status === "generating" && result.data?.idempotent === true) {
    const existing = await getTripBundle(auth.supabase, auth.user.id, successorTripId);
    replayStart = Boolean(existing.data?.trip && !getStagedGenerationState(existing.data.trip.metadata, successorTripId));
  }
  if (successorTripId && (freshStart || replayStart)) {
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
      // KF-2 M6a: state first, job second — the M6b order proven in
      // tripGenerationRoute. The queue row is created at write time
      // (not left for a later wake's ensureTripJob), so the successor
      // is visible to the queue/cron surfaces from this moment. A
      // queue failure throws into the catch below, which fails the
      // successor via roamly_fail_customer_trip_intent_change exactly
      // like a start failure — never a state-without-job orphan.
      const queueResult = await createOrResumeGenerationJob({ supabase: auth.supabase, tripId: successorTripId, userId: auth.user.id, payload: { ...payload, priceDiscoveryId: generationContext.priceDiscoveryId, budgetConstraint: generationContext.budgetConstraint }, reason: "customer_trip_intent_change_successor" });
      if (!queueResult.ok) throw new Error(queueResult.error || "GENERATION_JOB_NOT_CREATED");
    } catch (error) {
      const admin = createSupabaseAdminClient();
      if (admin) await admin.rpc("roamly_fail_customer_trip_intent_change", { p_proposal_id: proposalId, p_user_id: auth.user.id, p_successor_trip_id: successorTripId, p_reason: error instanceof Error ? error.message : "GENERATION_START_FAILED" });
      return NextResponse.json({ ok: false, error: "The new itinerary could not be started. Your original trip is unchanged." }, { status: 502 });
    }
    scheduleStagedGenerationAdvance({ tripId: successorTripId, origin: new URL(request.url).origin, reason: "customer_trip_intent_change_successor", requestId: proposalId });
  }
  return NextResponse.json({ ok: true, status: result.data?.status || "generating", successorTripId });
}
