import { NextResponse } from "next/server";
import { getTripBundle } from "@/lib/trips";
import { sanitizeStoredItinerary, getItineraryTotalEstimateAmount } from "@/lib/itinerary";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/roamly/auth";
import { getConfirmedBookingCostCents } from "@/lib/roamly/bookings";
import { buildBudgetChangePreview } from "@/lib/roamly/customerBudgetChange";
import { getTripBudgetCurrency, getTripBudgetSnapshot } from "@/lib/roamly/tripMetadata";

type RouteContext = { params: Promise<{ id: string }> };

function amount(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function currency(value: unknown, fallback: string) {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : fallback;
}

async function loadPreview(auth: Extract<Awaited<ReturnType<typeof requireUser>>, { ok: true }>, tripId: string, requestedAmount: number, requestedCurrency: string) {
  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  const itinerary = bundle.data?.itinerary?.full_json ? sanitizeStoredItinerary(bundle.data.itinerary.full_json) : null;
  if (!bundle.data?.trip || !itinerary) return { error: "ITINERARY_NOT_EDITABLE", status: 409 as const };
  const data = bundle.data;
  if (!data.itinerary) return { error: "ITINERARY_NOT_EDITABLE", status: 409 as const };
  if (!["generated", "locked", "activated", "planned", "active"].includes(data.trip.status)) return { error: "TRIP_NOT_ACTIVE", status: 409 as const };
  const currentCurrency = getTripBudgetCurrency(data.trip).toUpperCase();
  if (requestedCurrency !== currentCurrency) return { error: "BUDGET_CURRENCY_CHANGE_UNSUPPORTED", status: 400 as const };
  const revision = Number((data.itinerary as typeof data.itinerary & { repair_revision?: number }).repair_revision);
  if (!Number.isSafeInteger(revision) || revision < 0) return { error: "BUDGET_CHANGE_SCHEMA_NOT_READY", status: 503 as const };
  const hash = await auth.supabase.rpc("roamly_itinerary_content_hash", { value: data.itinerary.full_json });
  if (hash.error || typeof hash.data !== "string") return { error: "BUDGET_CHANGE_SCHEMA_NOT_READY", status: 503 as const };
  const discovery = data.trip.latest_price_discovery_id
    ? await auth.supabase.from("roamly_price_discoveries").select("id,metadata").eq("id", data.trip.latest_price_discovery_id).eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle()
    : { data: null, error: null };
  const priceDiscovery = discovery.data?.metadata && typeof discovery.data.metadata === "object" ? discovery.data.metadata as Record<string, unknown> : null;
  const committed = await getConfirmedBookingCostCents(auth.supabase, auth.user.id, tripId, requestedCurrency);
  const budgetSnapshot = getTripBudgetSnapshot(data.trip);
  const preview = buildBudgetChangePreview({ itinerary, currentBudgetAmount: budgetSnapshot.effectiveAmount, requestedBudgetAmount: requestedAmount, currency: requestedCurrency, committedAmount: committed.amountCents == null ? null : committed.amountCents / 100, committedStatus: committed.status, priceDiscovery });
  return { data, itinerary, revision, hash: hash.data, discoveryId: data.trip.latest_price_discovery_id || null, preview, budgetSnapshot };
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const requestedAmount = amount(body.amount ?? body.budgetAmount);
  if (requestedAmount == null) return NextResponse.json({ ok: false, error: "BUDGET_AMOUNT_REQUIRED" }, { status: 400 });
  const requestedCurrency = currency(body.currency ?? body.budgetCurrency, "CAD");
  const result = await loadPreview(auth, tripId, requestedAmount, requestedCurrency);
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  if (!result.data.itinerary) return NextResponse.json({ ok: false, error: "ITINERARY_NOT_EDITABLE" }, { status: 409 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "BUDGET_CHANGE_STORAGE_UNAVAILABLE" }, { status: 503 });
  const budgetSnapshot = result.budgetSnapshot;
  const insert = await admin.from("roamly_customer_budget_changes").insert({
    trip_id: tripId,
    user_id: auth.user.id,
    itinerary_id: result.data.itinerary.id,
    requested_budget_amount: requestedAmount,
    requested_budget_currency: requestedCurrency,
    expected_budget_amount: budgetSnapshot.effectiveAmount,
    expected_trip_budget_amount: budgetSnapshot.rawTripAmount,
    expected_planning_budget_amount: budgetSnapshot.planningAmount,
    expected_planning_budget_source: budgetSnapshot.planningSource,
    expected_budget_source: budgetSnapshot.effectiveSource,
    expected_budget_currency: getTripBudgetCurrency(result.data.trip),
    expected_revision: result.revision,
    expected_content_hash: result.hash,
    expected_price_discovery_id: result.discoveryId,
    before_snapshot: { budgetAmount: budgetSnapshot.effectiveAmount, budgetSource: budgetSnapshot.effectiveSource, tripBudgetAmount: budgetSnapshot.rawTripAmount, planningBudgetAmount: budgetSnapshot.planningAmount, planningBudgetSource: budgetSnapshot.planningSource, currency: getTripBudgetCurrency(result.data.trip), totalEstimateAmount: getItineraryTotalEstimateAmount(result.itinerary) },
    preview_snapshot: result.preview,
    evidence_snapshot: { priceDiscoveryId: result.discoveryId, committedStatus: result.preview.committedStatus, uncertainty: result.preview.uncertainty },
    status: "awaiting_approval"
  }).select("id,requested_budget_amount,requested_budget_currency,expected_revision,preview_snapshot,status").single();
  if (insert.error || !insert.data) return NextResponse.json({ ok: false, error: insert.error?.message || "BUDGET_CHANGE_CREATE_FAILED" }, { status: 500 });
  return NextResponse.json({ ok: true, proposal: insert.data });
}
