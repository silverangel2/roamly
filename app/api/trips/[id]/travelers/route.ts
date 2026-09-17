import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildTripTravelerRequirements,
  listTripTravelers,
  reconcileTripCompanionSlots
} from "@/lib/roamly/tripTravelers";
import { getTravelerMemory } from "@/lib/roamly/travelerMemory";
import { normalizeCountryCode } from "@/lib/roamly/placeResolver";

type RouteContext = { params: Promise<{ id: string }> };

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function ownedTrip(auth: Extract<Awaited<ReturnType<typeof requireUser>>, { ok: true }>, id: string) {
  const result = await auth.supabase
    .from("roamly_trips")
    .select("id,user_id,travelers_count,destination_country,start_date,end_date,metadata")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (result.error) return { trip: null, error: result.error.message };
  return { trip: result.data, error: result.data ? null : "TRIP_NOT_FOUND" };
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const owned = await ownedTrip(auth, id);
  if (!owned.trip) return NextResponse.json({ ok: false, error: owned.error }, { status: owned.error === "TRIP_NOT_FOUND" ? 404 : 400 });
  const travelers = await listTripTravelers(auth.supabase, id);
  if (travelers.error) return NextResponse.json({ ok: false, error: travelers.error }, { status: 500 });
  const memory = await getTravelerMemory(auth.supabase, auth.user.id);
  if (memory.error) return NextResponse.json({ ok: false, error: memory.error }, { status: 500 });
  return NextResponse.json({
    ok: true,
    ...buildTripTravelerRequirements({ trip: owned.trip, travelers: travelers.travelers, accountHolderPassportCountry: memory.profile?.passport_issuing_country })
  });
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const owned = await ownedTrip(auth, id);
  if (!owned.trip) return NextResponse.json({ ok: false, error: owned.error }, { status: owned.error === "TRIP_NOT_FOUND" ? 404 : 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "SERVER_WRITE_UNAVAILABLE" }, { status: 503 });

  if (action === "sync") {
    const result = await reconcileTripCompanionSlots({ admin, trip: owned.trip });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    const memory = await getTravelerMemory(auth.supabase, auth.user.id);
    if (memory.error) return NextResponse.json({ ok: false, error: memory.error }, { status: 500 });
    return NextResponse.json({ ok: true, ...buildTripTravelerRequirements({ trip: owned.trip, travelers: result.travelers, accountHolderPassportCountry: memory.profile?.passport_issuing_country }) });
  }

  if (action !== "update" && action !== "clear") return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
  const travelerId = body.travelerId;
  if (!isUuid(travelerId)) return NextResponse.json({ ok: false, error: "INVALID_TRAVELER_ID" }, { status: 400 });
  const existing = await admin
    .from("roamly_trip_travelers")
    .select("id,trip_id,role,traveler_order,traveler_type")
    .eq("id", travelerId)
    .eq("trip_id", id)
    .eq("role", "companion")
    .maybeSingle();
  if (existing.error) return NextResponse.json({ ok: false, error: existing.error.message }, { status: 500 });
  if (!existing.data) return NextResponse.json({ ok: false, error: "TRAVELER_NOT_FOUND" }, { status: 404 });
  const existingRow = existing.data;
  const expected = buildTripTravelerRequirements({ trip: owned.trip, travelers: [], accountHolderPassportCountry: null }).evaluations
    .find((traveler) => traveler.travelerOrder === existingRow.traveler_order && traveler.role === "companion");
  if (!expected || existingRow.traveler_type !== expected.travelerType) {
    return NextResponse.json({ ok: false, error: "TRAVELER_SLOT_STALE" }, { status: 409 });
  }

  let country: string | null = null;
  if (action === "update") {
    if (typeof body.passportIssuingCountry !== "string") return NextResponse.json({ ok: false, error: "INVALID_PASSPORT_COUNTRY" }, { status: 400 });
    country = normalizeCountryCode(body.passportIssuingCountry.trim());
    if (!country) return NextResponse.json({ ok: false, error: "INVALID_PASSPORT_COUNTRY" }, { status: 400 });
  }
  const updated = await admin
    .from("roamly_trip_travelers")
    .update({ passport_issuing_country: country })
    .eq("id", travelerId)
    .eq("trip_id", id)
    .eq("role", "companion");
  if (updated.error) return NextResponse.json({ ok: false, error: updated.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, cleared: country === null });
}
