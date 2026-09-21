import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { scheduleStagedGenerationAdvance } from "@/lib/roamly/stagedGenerationBackground";
import { getTripBundle } from "@/lib/trips";
import { payloadFromTrip } from "@/lib/roamly/marketPriceRefresh";
import { prepareStagedGenerationContext, startStagedItineraryGeneration } from "@/lib/roamly/stagedItineraryGeneration";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteContext = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId, proposalId } = await context.params;
  const result = await auth.supabase.rpc("roamly_reserve_customer_trip_date_change", { p_proposal_id: proposalId, p_trip_id: tripId });
  if (result.error) {
    const stale = result.error.code === "40001" || result.error.message.includes("DATE_CHANGE_");
    return NextResponse.json({ ok: false, error: stale ? "The trip changed while this request was waiting. Review the dates again." : "The date change could not be started." }, { status: stale ? 409 : 400 });
  }
  const successorTripId = result.data?.successorTripId as string | null;
  if (successorTripId && result.data?.status === "generating" && result.data?.idempotent !== true) {
    try {
      const successor = await getTripBundle(auth.supabase, auth.user.id, successorTripId);
      if (!successor.data?.trip) throw new Error("SUCCESSOR_TRIP_NOT_FOUND");
      const payload = payloadFromTrip(successor.data.trip);
      const context = await prepareStagedGenerationContext({ supabase: auth.supabase, userId: auth.user.id, tripId: successorTripId, payload });
      await startStagedItineraryGeneration({ supabase: auth.supabase, userId: auth.user.id, tripId: successorTripId, payload: { ...payload, priceDiscoveryId: context.priceDiscoveryId, budgetConstraint: context.budgetConstraint }, requestId: proposalId, unlockSource: "admin", context });
    } catch (error) {
      const admin = createSupabaseAdminClient();
      if (admin) await admin.rpc("roamly_fail_customer_trip_date_change", { p_proposal_id: proposalId, p_user_id: auth.user.id, p_successor_trip_id: successorTripId, p_reason: error instanceof Error ? error.message : "GENERATION_START_FAILED" });
      return NextResponse.json({ ok: false, error: "The new itinerary could not be started. Your original trip is unchanged." }, { status: 502 });
    }
    scheduleStagedGenerationAdvance({ tripId: successorTripId, origin: new URL(request.url).origin, reason: "customer_date_change_successor", requestId: proposalId });
  }
  return NextResponse.json({ ok: true, status: result.data?.status || "generating", successorTripId });
}
