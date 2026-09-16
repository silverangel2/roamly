import { NextResponse } from "next/server";
import { getTripBundle } from "@/lib/trips";
import { validateItineraryDeterministically } from "@/lib/roamly/itineraryValidation";
import { deriveTripReadiness } from "@/lib/roamly/tripReadiness";
import { payloadFromTrip } from "@/lib/roamly/marketPriceRefresh";
import { verifyAppliedRepair } from "@/lib/roamly/itineraryRepair";
import { requireUser } from "@/lib/roamly/auth";

type RouteContext = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId, proposalId } = await context.params;
  const proposal = await auth.supabase
    .from("roamly_planning_repair_proposals")
    .select("id,trip_id,itinerary_id,day_id,conflict_id,target_item_id,status")
    .eq("id", proposalId)
    .eq("trip_id", tripId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (proposal.error || !proposal.data) {
    return NextResponse.json({ ok: false, result: "REJECTED", error: "This planning change is no longer available." }, { status: 404 });
  }
  const result = await auth.supabase.rpc("roamly_apply_planning_repair", {
    p_proposal_id: proposalId,
    p_trip_id: tripId
  });
  if (result.error) {
    const stale = result.error.code === "40001" || result.error.message.includes("STALE_");
    return NextResponse.json({ ok: false, result: stale ? "STALE_ITINERARY_STATE" : "REJECTED", error: stale ? "The trip changed while this change was waiting. Reload the trip and review it again." : "This planning change could not be applied." }, { status: stale ? 409 : 400 });
  }

  const rpcResult = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
  const databaseStatus = rpcResult.status === "already_applied" ? "ALREADY_APPLIED" : "APPLIED";
  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data?.itinerary) {
    return NextResponse.json({
      ok: true,
      result: databaseStatus === "ALREADY_APPLIED" ? "ALREADY_APPLIED" : "APPLIED_VERIFICATION_PENDING",
      message: "The change was applied. Reload the trip to check the latest schedule."
    });
  }

  try {
    const currentItinerary = bundle.data.itinerary.full_json;
    const validation = validateItineraryDeterministically({
      itinerary: currentItinerary,
      payload: payloadFromTrip(bundle.data.trip)
    });
    const verification = verifyAppliedRepair({
      itinerary: currentItinerary,
      dayId: String(proposal.data.day_id),
      conflictId: String(proposal.data.conflict_id),
      targetItemId: String(proposal.data.target_item_id),
      validationOk: validation.ok
    });
    const full = currentItinerary;
    const conflictCount = full.daily_itinerary.filter((day) => day.plan_status === "conflict").length;
    const uncertainItemCount = full.daily_itinerary.reduce((count, day) => count + (day.plan_status === "uncertain" || day.live_timeline.some((item) => item.routing_status === "UNCERTAIN") ? 1 : 0), 0);
    const rawBudgetStatus = String(full.estimated_budget_breakdown.budget_status || "").toUpperCase();
    const budgetStatus = rawBudgetStatus === "WITHIN_BUDGET" ? "WITHIN_BUDGET" : rawBudgetStatus === "TIGHT" || rawBudgetStatus === "LIKELY_WITHIN_BUDGET" ? "LIKELY_WITHIN_BUDGET" : rawBudgetStatus === "OVER_BUDGET" ? "OVER_BUDGET" : rawBudgetStatus === "BUDGET_UNCERTAIN" || rawBudgetStatus === "UNKNOWN" ? "BUDGET_UNCERTAIN" : null;
    const readiness = deriveTripReadiness({
      tripId,
      startDate: bundle.data.trip.start_date,
      endDate: bundle.data.trip.end_date,
      generationStatus: bundle.data.trip.itinerary_status,
      hasItinerary: true,
      conflictCount,
      uncertainItemCount,
      budgetStatus
    });
    return NextResponse.json({
      ok: true,
      result: verification,
      databaseResult: databaseStatus,
      readiness: { state: readiness.state, primaryAction: readiness.primaryAction }
    });
  } catch {
    return NextResponse.json({
      ok: true,
      result: databaseStatus === "ALREADY_APPLIED" ? "ALREADY_APPLIED" : "APPLIED_VERIFICATION_PENDING",
      message: "The change was applied. Reload the trip to check the latest schedule."
    });
  }
}
