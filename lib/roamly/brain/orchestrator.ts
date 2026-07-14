import type { SupabaseClient } from "@supabase/supabase-js";
import {
  invalidateGenerationLayers,
  requeueInvalidatedGenerationLayers,
  type RoamlyGenerationLayer
} from "@/lib/roamly/generationQueue";
import {
  BRAIN_STAGE_BY_TYPE,
  ROAMLY_BRAIN_VERSION,
  firstInvalidatedSequence,
  getBrainStage,
  validateSchemaShape,
  type BrainChangeType,
  type RoamlyBrainStageType
} from "@/lib/roamly/brain/stages";

export type BrainCompletedLayerMap = Partial<Record<RoamlyBrainStageType, RoamlyGenerationLayer>>;

export type BrainStageRuntimeInput = {
  tripId: string;
  userId: string;
  stageType: RoamlyBrainStageType;
  generationVersion: string;
  stageVersion: string;
  completedLayers: Record<string, unknown>;
  dependencyVersions: Record<string, string>;
  tripPayload?: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function completedLayerMap(layers: RoamlyGenerationLayer[]): BrainCompletedLayerMap {
  const entries = layers
    .filter((layer) => layer.status === "completed")
    .map((layer) => [layer.layer_type as RoamlyBrainStageType, layer] as const);
  return Object.fromEntries(entries) as BrainCompletedLayerMap;
}

export function completedLayerOutputs(layers: RoamlyGenerationLayer[]) {
  return Object.fromEntries(
    layers
      .filter((layer) => layer.status === "completed")
      .map((layer) => [layer.layer_type, record(layer.output_json)])
  );
}

export function dependencyVersionSnapshot(stageType: RoamlyBrainStageType, layers: RoamlyGenerationLayer[]) {
  const stage = getBrainStage(stageType);
  if (!stage) return {};
  const byType = completedLayerMap(layers);
  return Object.fromEntries(
    stage.dependencies.map((dependency) => {
      const layer = byType[dependency as RoamlyBrainStageType];
      const definition = BRAIN_STAGE_BY_TYPE[dependency as RoamlyBrainStageType];
      return [
        dependency,
        [
          definition?.version || "unknown",
          layer?.generation_version || ROAMLY_BRAIN_VERSION,
          layer?.completed_at || "not-completed"
        ].join(":")
      ];
    })
  );
}

export function buildBrainStageInput(params: {
  tripId: string;
  userId: string;
  stageType: RoamlyBrainStageType;
  layers: RoamlyGenerationLayer[];
  tripPayload?: Record<string, unknown>;
}): BrainStageRuntimeInput {
  const stage = getBrainStage(params.stageType);
  if (!stage) throw new Error(`Unknown Roamly Brain stage: ${params.stageType}`);
  return {
    tripId: params.tripId,
    userId: params.userId,
    stageType: params.stageType,
    generationVersion: ROAMLY_BRAIN_VERSION,
    stageVersion: stage.version,
    completedLayers: completedLayerOutputs(params.layers),
    dependencyVersions: dependencyVersionSnapshot(params.stageType, params.layers),
    tripPayload: params.tripPayload
  };
}

export function validateBrainStageInput(input: BrainStageRuntimeInput) {
  const stage = getBrainStage(input.stageType);
  if (!stage) return { ok: false as const, error: "UNKNOWN_STAGE" };
  return validateSchemaShape(stage.inputSchema, {
    ...input.completedLayers,
    payload: input.tripPayload || {},
    completedLayers: input.completedLayers,
    tripId: input.tripId,
    userId: input.userId
  });
}

export function validateBrainStageOutput(stageType: RoamlyBrainStageType, output: unknown) {
  const stage = getBrainStage(stageType);
  if (!stage) return { ok: false as const, error: "UNKNOWN_STAGE" };
  return validateSchemaShape(stage.outputSchema, output);
}

export async function invalidateBrainLayersForChange(params: {
  supabase: SupabaseClient;
  jobId: string;
  changeType: BrainChangeType;
  reason?: string;
  requeue?: boolean;
}) {
  const fromSequence = firstInvalidatedSequence(params.changeType);
  if (!fromSequence) return { ok: true as const, invalidated: 0, requeued: 0 };
  const invalidated = await invalidateGenerationLayers({
    supabase: params.supabase,
    jobId: params.jobId,
    fromSequence,
    reason: params.reason || `Brain change invalidated ${params.changeType}`
  });
  if (!invalidated.ok) return { ...invalidated, requeued: 0 };
  if (!params.requeue) return { ...invalidated, requeued: 0 };
  const requeued = await requeueInvalidatedGenerationLayers({
    supabase: params.supabase,
    jobId: params.jobId,
    generationVersion: ROAMLY_BRAIN_VERSION
  });
  if (!requeued.ok) return { ok: false as const, error: requeued.error, invalidated: invalidated.invalidated, requeued: 0 };
  return { ok: true as const, invalidated: invalidated.invalidated, requeued: requeued.requeued };
}
