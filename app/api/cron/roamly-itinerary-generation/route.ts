import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scheduleStagedGenerationAdvance, getGenerationWorkerSecret } from "@/lib/roamly/stagedGenerationBackground";
import { sendPendingStagedGenerationEmail } from "@/lib/roamly/itineraryGenerationEmail";
import {
  advanceStagedItineraryGeneration,
  getStagedGenerationState,
  publicStagedGenerationProgress
} from "@/lib/roamly/stagedItineraryGeneration";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = getGenerationWorkerSecret();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  return Boolean(secret && token && token === secret);
}

function terminalStatus(status?: string | null) {
  return status === "complete" || status === "failed" || status === "partially_failed";
}

async function processTrip(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, tripId: string, requestId: string) {
  const { data: trip, error } = await admin
    .from("roamly_trips")
    .select("id,user_id,metadata,itinerary_status,status,updated_at")
    .eq("id", tripId)
    .maybeSingle();

  if (error) return { tripId, ok: false, error: error.message, terminal: false };
  if (!trip) return { tripId, ok: false, error: "Trip not found.", terminal: true };

  const state = getStagedGenerationState(trip.metadata);
  if (!state) return { tripId, ok: true, skipped: true, terminal: true, email: null };

  if (terminalStatus(state.status)) {
    const email = await sendPendingStagedGenerationEmail(tripId);
    return {
      tripId,
      ok: true,
      advanced: false,
      terminal: true,
      progress: publicStagedGenerationProgress({ generation: state }),
      email
    };
  }

  const result = await advanceStagedItineraryGeneration({
    supabase: admin,
    tripId,
    requestId
  });
  const terminal = terminalStatus(result.state.status);
  return {
    tripId,
    ok: result.ok,
    advanced: result.advanced,
    terminal,
    progress: publicStagedGenerationProgress({ generation: result.state }),
    error: "error" in result ? result.error : null
  };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Supabase service role is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId.trim() : "";
  if (!tripId) return NextResponse.json({ ok: false, error: "Trip id is required." }, { status: 400 });
  const requestId = typeof body.requestId === "string" && body.requestId ? body.requestId : randomUUID();
  const result = await processTrip(admin, tripId, requestId);
  if (result.ok && !result.terminal) {
    scheduleStagedGenerationAdvance({
      tripId,
      origin: request.nextUrl.origin,
      reason: "background_stage_completed",
      requestId
    });
  }
  return NextResponse.json({ ok: result.ok, processed: result.ok ? 1 : 0, result });
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Supabase service role is not configured." }, { status: 503 });
  }

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") || 3), 1), 5);
  const { data, error } = await admin
    .from("roamly_trips")
    .select("id,user_id,metadata,itinerary_status,status,updated_at")
    .in("itinerary_status", ["generating", "generated", "locked"])
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const results = [];
  for (const trip of data || []) {
    const result = await processTrip(admin, trip.id, randomUUID()).catch((workerError) => ({
      tripId: trip.id,
      ok: false,
      error: workerError instanceof Error ? workerError.message : "GENERATION_WORKER_FAILED",
      terminal: false
    }));
    results.push(result);
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
