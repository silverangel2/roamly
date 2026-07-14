import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function cleanRecord(record: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (
      key.toLowerCase().includes("token") ||
      key.toLowerCase().includes("secret") ||
      key.toLowerCase().includes("key")
    ) {
      continue;
    }

    safe[key] = value;
  }

  return safe;
}

export async function GET() {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        error: "SUPABASE_SERVICE_ROLE_MISSING"
      },
      { status: 500 }
    );
  }

  const { data: trips, error: tripsError } = await supabase
    .from("roamly_trips")
    .select("id,title,destination,status,user_id,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(5);

  if (tripsError) {
    return NextResponse.json(
      { ok: false, step: "trips", error: tripsError.message },
      { status: 500 }
    );
  }

  const tripId = trips?.[0]?.id;

  if (!tripId) {
    return NextResponse.json({ ok: true, trips: [], message: "No trips found." });
  }

  const [jobs, layers, itineraries] = await Promise.all([
    supabase
      .from("roamly_trip_generation_jobs")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("roamly_trip_generation_layers")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true })
      .limit(40),
    supabase
      .from("roamly_itineraries")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(5)
  ]);

  return NextResponse.json({
    ok: true,
    tripId,
    trips: trips.map(cleanRecord),
    jobs: jobs.error
      ? { error: jobs.error.message }
      : jobs.data?.map((item) => cleanRecord(item as Record<string, unknown>)),
    layers: layers.error
      ? { error: layers.error.message }
      : layers.data?.map((item) => cleanRecord(item as Record<string, unknown>)),
    itineraries: itineraries.error
      ? { error: itineraries.error.message }
      : itineraries.data?.map((item) => cleanRecord(item as Record<string, unknown>))
  });
}
