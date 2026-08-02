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

const ROUTE_EXECUTION_BUDGET_MS = 55_000;

function workerQueueUnavailable(summary: Awaited<ReturnType<typeof processGenerationQueue>>) {
  const messages = [
    summary.error,
    ...summary.results.map((result) => result.error)
  ].filter((message): message is string => Boolean(message));
  return messages.some((message) => queueTableMissing(message));
}

async function queueSnapshot(supabase: SupabaseClient, tripId: string, userId: string) {
  const [trip, queue] = await Promise.all([
    supabase.from("roamly_trips").select("metadata").eq("id", tripId).eq("user_id", userId).maybeSingle(),
    getGenerationQueueForTrip({ supabase, tripId, userId })
  ]);
  if (queue.error && !queueTableMissing(queue.error)) return null;
  return publicQueueProgress(queue, trip.data?.metadata, tripId);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const executionDeadlineMs = Date.now() + ROUTE_EXECUTION_BUDGET_MS;
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
        reason: "manual_retry_batch",
        executionDeadlineMs,
        config: {
          batchSize: 1,
          concurrency: 1,
          maxLayersPerRun: 8
        }
      });
      if (!summary.ok && workerQueueUnavailable(summary)) {
        return NextResponse.json(
          {
            ok: false,
            tripId: id,
            action,
            worker: summary,
            progress: publicStagedGenerationProgress({ generation: state }, id),
            queue: await queueSnapshot(auth.supabase, id, auth.user.id),
            error: "ROAMLY_GENERATION_QUEUE_UNAVAILABLE"
          },
          { status: 503 }
        );
      }
      return NextResponse.json({
        ok: summary.ok,
        tripId: id,
        action,
        worker: summary,
        progress: summary.results[0]?.progress || publicStagedGenerationProgress({ generation: state }, id),
        queue: await queueSnapshot(auth.supabase, id, auth.user.id)
      });
    }

    const summary = await processGenerationQueue({
      tripId: id,
      userId: auth.user.id,
      requestId,
      reason: "manual_generation_worker_wake",
      executionDeadlineMs,
      config: {
        batchSize: 3,
        concurrency: 1,
        maxLayersPerRun: 8
      }
    });
    if (!summary.ok && workerQueueUnavailable(summary)) {
      return NextResponse.json(
        {
          ok: false,
          tripId: id,
          worker: summary,
          progress: null,
          queue: await queueSnapshot(auth.supabase, id, auth.user.id),
          error: "ROAMLY_GENERATION_QUEUE_UNAVAILABLE"
        },
        { status: 503 }
      );
    }
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
    let progress: ReturnType<typeof publicStagedGenerationProgress> = null;
    try {
      const savedTrip = await auth.supabase
        .from("roamly_trips")
        .select("metadata")
        .eq("id", id)
        .eq("user_id", auth.user.id)
        .maybeSingle();
      progress = publicStagedGenerationProgress(savedTrip.data?.metadata, id);
    } catch {
      progress = null;
    }
    return NextResponse.json(
      {
        ok: false,
        error: generationError.code,
        message: "Roamly could not complete this generation step. Completed progress was preserved.",
        progress,
        queue: await queueSnapshot(auth.supabase, id, auth.user.id)
      },
      { status: generationError.status }
    );
  }
}
