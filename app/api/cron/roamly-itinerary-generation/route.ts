import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  advanceStagedItineraryGeneration,
  getStagedGenerationState,
  publicStagedGenerationProgress
} from "@/lib/roamly/stagedItineraryGeneration";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = (process.env.ROAMLY_GENERATION_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  return Boolean(secret && token && token === secret);
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
    .eq("itinerary_status", "generating")
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const results = [];
  for (const trip of data || []) {
    const state = getStagedGenerationState(trip.metadata);
    if (!state || state.status === "complete" || state.status === "failed" || state.status === "partially_failed") continue;
    const result = await advanceStagedItineraryGeneration({
      supabase: admin,
      tripId: trip.id,
      requestId: randomUUID()
    }).catch((workerError) => ({
      ok: false,
      error: workerError instanceof Error ? workerError.message : "GENERATION_WORKER_FAILED",
      state
    }));
    results.push({
      tripId: trip.id,
      ok: result.ok,
      progress: "state" in result ? publicStagedGenerationProgress({ generation: result.state }) : null,
      error: "error" in result ? result.error : null
    });
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
