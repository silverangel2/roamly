import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { getTripBundle } from "@/lib/trips";
import { deriveTripReadiness } from "@/lib/roamly/tripReadiness";

type RouteContext = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId, proposalId } = await context.params;
  const result = await auth.supabase.rpc("roamly_apply_customer_budget_change", { p_proposal_id: proposalId, p_trip_id: tripId });
  if (result.error) {
    const stale = result.error.code === "40001" || result.error.message.includes("STALE_");
    return NextResponse.json({ ok: false, error: stale ? "The trip changed while this budget update was waiting. Reload and review the budget again." : "This budget update could not be applied." }, { status: stale ? 409 : 400 });
  }
  if (result.data?.status === "stale") return NextResponse.json({ ok: false, error: "The trip changed while this budget update was waiting. Reload and review the budget again." }, { status: 409 });
  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data?.trip || !bundle.data.itinerary) return NextResponse.json({ ok: true, result: result.data });
  const budgetStatus = String(bundle.data.itinerary.full_json.estimated_budget_breakdown.budget_status || "unknown").toUpperCase();
  const readiness = deriveTripReadiness({ tripId, startDate: bundle.data.trip.start_date, endDate: bundle.data.trip.end_date, generationStatus: bundle.data.trip.itinerary_status, hasItinerary: true, budgetStatus: budgetStatus === "WITHIN_BUDGET" || budgetStatus === "TIGHT" || budgetStatus === "OVER_BUDGET" ? budgetStatus === "TIGHT" ? "LIKELY_WITHIN_BUDGET" : budgetStatus : "BUDGET_UNCERTAIN" });
  return NextResponse.json({ ok: true, result: result.data, readiness: { state: readiness.state, primaryAction: readiness.primaryAction } });
}
