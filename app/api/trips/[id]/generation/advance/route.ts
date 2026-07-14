import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import {
  publicStagedGenerationProgress,
  resetFailedStagedBatch,
  StagedGenerationError
} from "@/lib/roamly/stagedItineraryGeneration";
import { processGenerationQueue } from "@/lib/roamly/generationWorker";
import { getGenerationQueueForTrip, publicQueueProgress, queueTableMissing } from "@/lib/roamly/generationQueue";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

async function queueSnapshot(supabase: SupabaseClient, tripId: string, userId: string) {
  const [trip, queue] = await Promise.all([
    supabase.from("roamly_trips").select("metadata").eq("id", tripId).eq("user_id", userId).maybeSingle(),
    getGenerationQueueForTrip({ supabase, tripId, userId })
  ]);
  if (queue.error && !queueTableMissing(queue.error)) return null;
  return publicQueueProgress(queue, trip.data?.metadata);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "advance";
  const requestId = randomUUID();

  try {
    if (action === "retry_batch") {
      const batchId = typeof body.batchId === "string" ? body.batchId : "";
      if (!batchId) return NextResponse.json({ ok: false, error: "Batch id is required." }, { status: 400 });
      const state = await resetFailedStagedBatch({
        supabase: auth.supabase,
        tripId: id,
        userId: auth.user.id,
        batchId
      });
      const summary = await processGenerationQueue({
        tripId: id,
        userId: auth.user.id,
        requestId,
        reason: "browser_retry_batch",
        config: {
          batchSize: 1,
          concurrency: 1,
          maxLayersPerRun: 1
        }
      });
      return NextResponse.json({
        ok: summary.ok,
        tripId: id,
        action,
        worker: summary,
        progress: summary.results[0]?.progress || publicStagedGenerationProgress({ generation: state }),
        queue: await queueSnapshot(auth.supabase, id, auth.user.id)
      });
    }

    const summary = await processGenerationQueue({
      tripId: id,
      userId: auth.user.id,
      requestId,
      reason: "browser_generation_fallback",
      config: {
        batchSize: 1,
        concurrency: 1,
        maxLayersPerRun: 1
      }
    });
    const result = summary.results[0];
    return NextResponse.json({
      ok: summary.ok,
      tripId: id,
      busy: result?.busy === true || !result?.claimed,
      advanced: result?.advanced === true,
      stage: result?.layerType || null,
      progress: result?.progress || null,
      queue: await queueSnapshot(auth.supabase, id, auth.user.id),
      worker: summary,
      error: result?.error || summary.error || null
    });
  } catch (error) {
    const generationError = error instanceof StagedGenerationError
      ? error
      : new StagedGenerationError("Generation stage failed.", "GENERATION_STAGE_FAILED", 502);
    return NextResponse.json(
      {
        ok: false,
        error: generationError.code,
        message: "Roamly could not complete this generation step. Completed progress was preserved."
      },
      { status: generationError.status }
    );
  }
}
