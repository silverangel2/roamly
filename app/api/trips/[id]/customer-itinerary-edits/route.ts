import { NextResponse } from "next/server";
import { getTripBundle } from "@/lib/trips";
import { sanitizeStoredItinerary } from "@/lib/itinerary";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/roamly/auth";
import { findCustomerRemovalTarget } from "@/lib/roamly/itineraryRepair";

type RouteContext = { params: Promise<{ id: string }> };

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const dayId = body.dayId;
  const targetItemId = body.targetItemId;
  if (!isUuid(dayId) || !isUuid(targetItemId) || body.operation !== "REMOVE_OPTIONAL_ACTIVITY") {
    return NextResponse.json({ ok: false, error: "CUSTOMER_EDIT_TARGET_REQUIRED" }, { status: 400 });
  }

  const bundle = await getTripBundle(auth.supabase, auth.user.id, tripId);
  if (!bundle.data?.itinerary?.full_json) return NextResponse.json({ ok: false, error: "ITINERARY_NOT_EDITABLE" }, { status: 409 });
  const itinerary = sanitizeStoredItinerary(bundle.data.itinerary.full_json);
  if (!itinerary) return NextResponse.json({ ok: false, error: "ITINERARY_NOT_EDITABLE" }, { status: 409 });
  const target = findCustomerRemovalTarget(itinerary, dayId, targetItemId);
  if (!target.ok) return NextResponse.json({ ok: false, error: target.reason }, { status: 409 });

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
      operation: "REMOVE_OPTIONAL_ACTIVITY",
      expected_revision: revision,
      expected_content_hash: hash.data,
      before_snapshot: { dayId, itemId: targetItemId, item: target.item },
      preview_json: {
        operation: "REMOVE_OPTIONAL_ACTIVITY",
        title: target.item.title,
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
