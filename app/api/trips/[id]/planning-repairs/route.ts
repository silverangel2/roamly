import { NextResponse } from "next/server";
import { getTripBundle } from "@/lib/trips";
import { sanitizeStoredItinerary } from "@/lib/itinerary";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/roamly/auth";
import { buildRepairProposalDraft, removeOptionalActivity, type RepairPreview } from "@/lib/roamly/itineraryRepair";

type RouteContext = { params: Promise<{ id: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }
  const conflictId = typeof body.conflictId === "string" ? body.conflictId : "";
  const targetItemId = typeof body.targetItemId === "string" ? body.targetItemId : "";
  if (!isUuid(conflictId) || !isUuid(targetItemId) || Object.keys(body).some((key) => !["conflictId", "targetItemId"].includes(key))) {
    return NextResponse.json({ ok: false, error: "REPAIR_TARGET_REQUIRED" }, { status: 400 });
  }

  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data) return NextResponse.json({ ok: false, error: bundle.error || "TRIP_NOT_FOUND" }, { status: 404 });
  if (!bundle.data.itinerary || !bundle.data.itinerary.full_json || !bundle.data.trip.itinerary_generated_at) {
    return NextResponse.json({ ok: false, error: "ITINERARY_NOT_REPAIRABLE" }, { status: 409 });
  }

  const itinerary = sanitizeStoredItinerary(bundle.data.itinerary.full_json);
  if (!itinerary) return NextResponse.json({ ok: false, error: "ITINERARY_NOT_REPAIRABLE" }, { status: 409 });
  const draft = buildRepairProposalDraft(itinerary, conflictId, targetItemId, "UNCERTAIN");
  if (draft.repairability !== "REPAIRABLE") {
    return NextResponse.json({ ok: false, error: `REPAIR_${draft.repairability}`, proposal: draft }, { status: 409 });
  }

  let repaired;
  try {
    repaired = removeOptionalActivity(itinerary, {
      dayId: draft.dayId,
      conflictId: draft.conflictId,
      itemId: draft.targetItemId
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "REPAIR_TARGET_NOT_ALLOWED" }, { status: 409 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "REPAIR_STORAGE_UNAVAILABLE" }, { status: 503 });
  const hashResult = await auth.supabase.rpc("roamly_itinerary_content_hash", { value: bundle.data.itinerary.full_json });
  if (hashResult.error || typeof hashResult.data !== "string") {
    return NextResponse.json({ ok: false, error: "REPAIR_SCHEMA_NOT_READY" }, { status: 503 });
  }
  const revision = Number((bundle.data.itinerary as typeof bundle.data.itinerary & { repair_revision?: number }).repair_revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return NextResponse.json({ ok: false, error: "REPAIR_SCHEMA_NOT_READY" }, { status: 503 });
  }

  const preview: RepairPreview = {
    operation: draft.operation,
    conflictId: draft.conflictId,
    dayId: draft.dayId,
    targetItemId: draft.targetItemId,
    protected: draft.protected,
    change: draft.change,
    result: repaired ? "UNCERTAIN" : "UNCERTAIN"
  };
  const insert = await admin
    .from("roamly_planning_repair_proposals")
    .insert({
      trip_id: tripId,
      user_id: auth.user.id,
      itinerary_id: bundle.data.itinerary.id,
      operation: draft.operation,
      conflict_id: draft.conflictId,
      day_id: draft.dayId,
      target_item_id: draft.targetItemId,
      expected_revision: revision,
      expected_content_hash: hashResult.data,
      before_snapshot: draft.beforeSnapshot,
      preview_json: preview,
      status: "awaiting_approval"
    })
    .select("id,operation,conflict_id,day_id,target_item_id,expected_revision,preview_json,status")
    .single();

  if (insert.error || !isRecord(insert.data)) {
    if (insert.error?.code === "23505") {
      const existing = await admin
        .from("roamly_planning_repair_proposals")
        .select("id,operation,conflict_id,day_id,target_item_id,expected_revision,preview_json,status")
        .eq("itinerary_id", bundle.data.itinerary.id)
        .eq("expected_revision", revision)
        .eq("target_item_id", draft.targetItemId)
        .eq("status", "awaiting_approval")
        .maybeSingle();
      if (existing.data) return NextResponse.json({ ok: true, proposal: existing.data, idempotent: true });
    }
    return NextResponse.json({ ok: false, error: insert.error?.message || "REPAIR_PROPOSAL_CREATE_FAILED" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, proposal: insert.data });
}
