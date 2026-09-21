import { NextResponse } from "next/server";
import { getTripBundle } from "@/lib/trips";
import { validateItineraryDeterministically } from "@/lib/roamly/itineraryValidation";
import { deriveTripReadiness } from "@/lib/roamly/tripReadiness";
import { payloadFromTrip } from "@/lib/roamly/marketPriceRefresh";
import { requireUser } from "@/lib/roamly/auth";

type RouteContext = { params: Promise<{ id: string; editId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId, editId } = await context.params;
  const edit = await auth.supabase.from("roamly_customer_itinerary_edits")
    .select("id,trip_id,operation,status")
    .eq("id", editId).eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  if (edit.error || !edit.data || edit.data.operation !== "REPLACE_OPTIONAL_ACTIVITY") return NextResponse.json({ ok: false, error: "CUSTOMER_REPLACEMENT_NOT_FOUND" }, { status: 404 });
  const result = await auth.supabase.rpc("roamly_apply_customer_itinerary_replacement", { p_edit_id: editId, p_trip_id: tripId });
  if (result.error) {
    const stale = result.error.code === "40001" || result.error.message.includes("STALE_");
    const protectedTarget = /PROTECTED|BOOKING/.test(result.error.message);
    const candidate = /CANDIDATE|FEASIBILITY|FRESHNESS/.test(result.error.message);
    return NextResponse.json({
      ok: false,
      result: stale ? "STALE_ITINERARY_STATE" : "REJECTED",
      error: stale ? "The trip changed while this replacement was waiting. Reload the trip and review it again." : protectedTarget ? "Roamly cannot replace an activity with protected booking evidence." : candidate ? "That alternative is no longer current or feasible. Choose another option." : "This replacement could not be applied."
    }, { status: stale ? 409 : 400 });
  }
  const databaseStatus = result.data && typeof result.data === "object" && (result.data as Record<string, unknown>).status === "already_applied" ? "ALREADY_APPLIED" : "APPLIED";
  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data?.itinerary) return NextResponse.json({ ok: true, result: databaseStatus });
  try {
    const current = bundle.data.itinerary.full_json;
    const validation = validateItineraryDeterministically({ itinerary: current, payload: payloadFromTrip(bundle.data.trip) });
    const conflictCount = current.daily_itinerary.filter((day) => day.plan_status === "conflict").length;
    const uncertainItemCount = current.daily_itinerary.reduce((count, day) => count + (day.plan_status === "uncertain" || day.live_timeline.some((item) => item.routing_status === "UNCERTAIN") ? 1 : 0), 0);
    const rawBudget = String(current.estimated_budget_breakdown.budget_status || "").toUpperCase();
    const budgetStatus = rawBudget === "WITHIN_BUDGET" ? "WITHIN_BUDGET" : rawBudget === "OVER_BUDGET" ? "OVER_BUDGET" : rawBudget === "TIGHT" || rawBudget === "LIKELY_WITHIN_BUDGET" ? "LIKELY_WITHIN_BUDGET" : "BUDGET_UNCERTAIN";
    const readiness = deriveTripReadiness({ tripId, startDate: bundle.data.trip.start_date, endDate: bundle.data.trip.end_date, generationStatus: bundle.data.trip.itinerary_status, hasItinerary: true, conflictCount, uncertainItemCount, budgetStatus });
    return NextResponse.json({ ok: true, result: databaseStatus, validation: { ok: validation.ok }, readiness: { state: readiness.state, primaryAction: readiness.primaryAction } });
  } catch {
    return NextResponse.json({ ok: true, result: databaseStatus, message: "The replacement was applied. Reload the trip to check current itinerary truth." });
  }
}
