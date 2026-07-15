import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function cleanRecord(record: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (
      key === "metadata" ||
      key === "full_json" ||
      key === "preview_json" ||
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

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return 0;
}

function generationSummary(metadata: unknown) {
  const generation = getRecord(getRecord(metadata).generation);
  return {
    status: getString(generation.status) || null,
    current_stage: getString(generation.currentStage) || null,
    completed_day_count: getNumber(generation.completedDayCount),
    total_day_count: getNumber(generation.totalDayCount),
    completed_at: getString(generation.completedAt) || null,
    updated_at: getString(generation.updatedAt) || null,
    last_error_message: getString(generation.lastError) || null,
    last_error_code: getString(generation.lastErrorCode) || null
  };
}

function completionEmailDiagnostics(trip: Record<string, unknown>) {
  const email = getRecord(getRecord(trip.metadata).generationEmail);
  const status =
    getString(trip.completion_email_status) ||
    getString(email.completion_email_status);
  const sentAt = getString(trip.completion_email_sent_at) || getString(email.completion_email_sent_at);
  const error =
    getString(trip.completion_email_last_error) ||
    getString(email.completion_email_last_error);
  const attempts = getNumber(trip.completion_email_attempt_count) || getNumber(email.completion_email_attempt_count);
  const sent = Boolean(sentAt || status === "sent" || status === "captured");

  return {
    completionEmailQueued: !sent && !error && (status === "pending" || status === "sending" || attempts > 0),
    completionEmailSent: sent,
    completionEmailError: error || null,
    completion_email_status: status || null,
    completion_email_sent_at: sentAt || null,
    completion_email_attempt_count: attempts,
    completion_email_next_retry_at:
      getString(trip.completion_email_next_retry_at) ||
      getString(email.completion_email_next_retry_at) ||
      null,
    delivery_status: getString(email.delivery_status) || null,
    last_email_error: getString(email.last_email_error) || null
  };
}

function finalStoredItinerary(value: unknown) {
  const record = getRecord(value);
  return (
    Array.isArray(record.daily_itinerary) &&
    record.daily_itinerary.length > 0 &&
    /generated through roamly staged ai generation/i.test(getString(record.generation_note))
  );
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
    .select("id,title,destination,status,itinerary_status,user_id,created_at,updated_at,metadata,completion_email_status,completion_email_sent_at,completion_email_last_error,completion_email_attempt_count,completion_email_next_retry_at")
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
      .order("layer_sequence", { ascending: true })
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
    trips: trips.map((trip) => ({
      ...cleanRecord(trip),
      generation: generationSummary((trip as Record<string, unknown>).metadata),
      completionEmail: completionEmailDiagnostics(trip as Record<string, unknown>)
    })),
    jobs: jobs.error
      ? { error: jobs.error.message }
      : jobs.data?.map((item) => cleanRecord(item as Record<string, unknown>)),
    layers: layers.error
      ? { error: layers.error.message }
      : layers.data?.map((item) => cleanRecord(item as Record<string, unknown>)),
    itineraries: itineraries.error
      ? { error: itineraries.error.message }
      : itineraries.data?.map((item) => ({
          ...cleanRecord(item as Record<string, unknown>),
          hasFullJson: Boolean((item as Record<string, unknown>).full_json),
          finalStoredItinerary: finalStoredItinerary((item as Record<string, unknown>).full_json)
        })),
    completionEmail: completionEmailDiagnostics(trips[0] as Record<string, unknown>)
  });
}
