import { NextResponse } from "next/server";
import { getTripBundle } from "@/lib/trips";
import { sanitizeStoredItinerary } from "@/lib/itinerary";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/roamly/auth";
import { findCustomerRemovalTarget } from "@/lib/roamly/itineraryRepair";
import { buildGroundedReplacementCandidate } from "@/lib/roamly/customerActivityReplacement";

type RouteContext = { params: Promise<{ id: string }> };

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId } = await context.params;
  const query = new URL(request.url).searchParams;
  const dayId = query.get("dayId");
  const targetItemId = query.get("targetItemId");
  if (!isUuid(dayId) || !isUuid(targetItemId)) return NextResponse.json({ ok: false, error: "CUSTOMER_EDIT_TARGET_REQUIRED" }, { status: 400 });
  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data?.itinerary?.full_json) return NextResponse.json({ ok: false, error: "ITINERARY_NOT_EDITABLE" }, { status: 409 });
  const data = bundle.data;
  const itinerary = sanitizeStoredItinerary(bundle.data.itinerary.full_json);
  if (!itinerary) return NextResponse.json({ ok: false, error: "ITINERARY_NOT_EDITABLE" }, { status: 409 });
  const target = findCustomerRemovalTarget(itinerary, dayId, targetItemId);
  if (!target.ok) return NextResponse.json({ ok: false, error: target.reason }, { status: 409 });
  const discoveryId = data.trip.latest_price_discovery_id;
  if (!discoveryId) return NextResponse.json({ ok: true, candidates: [] });
  const discovery = await auth.supabase.from("roamly_price_discoveries").select("metadata").eq("id", discoveryId).eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  const metadata = discovery.data?.metadata && typeof discovery.data.metadata === "object" ? discovery.data.metadata as Record<string, unknown> : {};
  const marketResults = Array.isArray(metadata.marketResults) ? metadata.marketResults : [];
  const day = itinerary.daily_itinerary.find((candidate) => candidate.day_id === dayId);
  if (!day) return NextResponse.json({ ok: true, candidates: [] });
  const candidates = marketResults
    .filter((result): result is Record<string, unknown> => Boolean(result && typeof result === "object"))
    .map((result) => buildGroundedReplacementCandidate({
      result: result as never,
      itinerary,
      target: target.item,
      day,
      destination: data.trip.destination || data.trip.destination_name || "",
      startDate: data.trip.start_date || "",
      endDate: data.trip.end_date || "",
      interests: data.trip.interests || [],
      budgetAmount: data.trip.budget_amount,
      budgetCurrency: data.trip.budget_currency
    }))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .filter((candidate, index, all) => all.findIndex((other) => other.candidateId === candidate.candidateId) === index)
    .slice(0, 3)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      title: candidate.item.title,
      description: candidate.item.description,
      date: day.date,
      startTime: candidate.item.startTime,
      endTime: candidate.item.endTime,
      price: candidate.item.estimated_cost,
      currency: candidate.evidence.currency,
      priceStatus: candidate.item.cost_status === "UNKNOWN" ? "unknown" : "observed",
      fitReason: candidate.fitReason,
      source: candidate.evidence.source,
      provider: candidate.evidence.provider
    }));
  return NextResponse.json({ ok: true, candidates });
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const dayId = body.dayId;
  const targetItemId = body.targetItemId;
  if (!isUuid(dayId) || !isUuid(targetItemId) || !["REMOVE_OPTIONAL_ACTIVITY", "REPLACE_OPTIONAL_ACTIVITY"].includes(String(body.operation))) {
    return NextResponse.json({ ok: false, error: "CUSTOMER_EDIT_TARGET_REQUIRED" }, { status: 400 });
  }

  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data?.itinerary?.full_json) return NextResponse.json({ ok: false, error: "ITINERARY_NOT_EDITABLE" }, { status: 409 });
  const data = bundle.data;
  const itinerary = sanitizeStoredItinerary(bundle.data.itinerary.full_json);
  if (!itinerary) return NextResponse.json({ ok: false, error: "ITINERARY_NOT_EDITABLE" }, { status: 409 });
  const target = findCustomerRemovalTarget(itinerary, dayId, targetItemId);
  if (!target.ok) return NextResponse.json({ ok: false, error: target.reason }, { status: 409 });

  let replacement: ReturnType<typeof buildGroundedReplacementCandidate> = null;
  if (body.operation === "REPLACE_OPTIONAL_ACTIVITY") {
    if (typeof body.candidateId !== "string" || !body.candidateId.trim()) return NextResponse.json({ ok: false, error: "REPLACEMENT_CANDIDATE_REQUIRED" }, { status: 400 });
    const discoveryId = bundle.data.trip.latest_price_discovery_id;
    if (!discoveryId) return NextResponse.json({ ok: false, error: "REPLACEMENT_DISCOVERY_UNAVAILABLE" }, { status: 409 });
    const discovery = await auth.supabase
      .from("roamly_price_discoveries")
      .select("metadata")
      .eq("id", discoveryId)
      .eq("trip_id", tripId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    const metadata = discovery.data?.metadata && typeof discovery.data.metadata === "object" ? discovery.data.metadata as Record<string, unknown> : {};
    const marketResults = Array.isArray(metadata.marketResults) ? metadata.marketResults : [];
    const result = marketResults.find((candidate) => candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).id === body.candidateId);
    const day = itinerary.daily_itinerary.find((candidate) => candidate.day_id === dayId);
    if (!day || !result || typeof result !== "object") return NextResponse.json({ ok: false, error: "REPLACEMENT_CANDIDATE_UNAVAILABLE" }, { status: 409 });
    replacement = buildGroundedReplacementCandidate({
      result: result as never,
      itinerary,
      target: target.item,
      day,
      destination: data.trip.destination || data.trip.destination_name || "",
      startDate: data.trip.start_date || "",
      endDate: data.trip.end_date || "",
      interests: data.trip.interests || [],
      budgetAmount: data.trip.budget_amount,
      budgetCurrency: data.trip.budget_currency
    });
    if (!replacement) return NextResponse.json({ ok: false, error: "REPLACEMENT_CANDIDATE_NOT_ELIGIBLE" }, { status: 409 });
  }

  const revision = Number((bundle.data.itinerary as typeof bundle.data.itinerary & { repair_revision?: number }).repair_revision);
  if (!Number.isSafeInteger(revision) || revision < 0) return NextResponse.json({ ok: false, error: "CUSTOMER_EDIT_SCHEMA_NOT_READY" }, { status: 503 });
  const hash = await auth.supabase.rpc("roamly_itinerary_content_hash", { value: bundle.data.itinerary.full_json });
  if (hash.error || typeof hash.data !== "string") return NextResponse.json({ ok: false, error: "CUSTOMER_EDIT_SCHEMA_NOT_READY" }, { status: 503 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "CUSTOMER_EDIT_STORAGE_UNAVAILABLE" }, { status: 503 });

  const insert = await admin
    .from("roamly_customer_itinerary_edits")
    .insert({
      trip_id: tripId,
      user_id: auth.user.id,
      itinerary_id: bundle.data.itinerary.id,
      day_id: dayId,
      target_item_id: targetItemId,
      operation: body.operation,
      expected_revision: revision,
      expected_content_hash: hash.data,
      before_snapshot: { dayId, itemId: targetItemId, item: target.item },
      replacement_candidate_id: replacement?.candidateId || null,
      replacement_snapshot: replacement?.item || null,
      replacement_evidence: replacement ? { ...replacement.evidence, bookingSuggestion: replacement.bookingSuggestion } : null,
      replacement_validation: replacement ? { feasibility: "FEASIBLE", fitReason: replacement.fitReason } : null,
      preview_json: {
        operation: body.operation,
        title: target.item.title,
        replacementTitle: replacement?.item.title,
        fitReason: replacement?.fitReason,
        dayId,
        targetItemId,
        change: `Remove ${target.item.title} from this day and leave the time free.`
      },
      status: "awaiting_approval"
    })
    .select("id,operation,day_id,target_item_id,expected_revision,preview_json,status")
    .single();

  if (insert.error || !insert.data) {
    if (insert.error?.code === "23505") {
      const existing = await admin
        .from("roamly_customer_itinerary_edits")
        .select("id,operation,day_id,target_item_id,expected_revision,preview_json,status")
        .eq("itinerary_id", bundle.data.itinerary.id)
        .eq("expected_revision", revision)
        .eq("day_id", dayId)
        .eq("target_item_id", targetItemId)
        .eq("status", "awaiting_approval")
        .maybeSingle();
      if (existing.data) return NextResponse.json({ ok: true, edit: existing.data, idempotent: true });
    }
    return NextResponse.json({ ok: false, error: insert.error?.message || "CUSTOMER_EDIT_CREATE_FAILED" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, edit: insert.data });
}
