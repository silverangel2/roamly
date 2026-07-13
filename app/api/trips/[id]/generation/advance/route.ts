import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import {
  advanceStagedItineraryGeneration,
  publicStagedGenerationProgress,
  resetFailedStagedBatch,
  StagedGenerationError
} from "@/lib/roamly/stagedItineraryGeneration";

export const runtime = "nodejs";
export const maxDuration = 60;

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
      return NextResponse.json({
        ok: true,
        tripId: id,
        action,
        progress: publicStagedGenerationProgress({ generation: state })
      });
    }

    const result = await advanceStagedItineraryGeneration({
      supabase: auth.supabase,
      tripId: id,
      userId: auth.user.id,
      requestId
    });
    return NextResponse.json({
      ok: result.ok,
      tripId: id,
      busy: "busy" in result ? result.busy === true : false,
      advanced: result.advanced,
      stage: "stage" in result ? result.stage : null,
      progress: publicStagedGenerationProgress({ generation: result.state }),
      error: "error" in result ? result.error : null
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
