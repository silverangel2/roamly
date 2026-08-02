import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  canResumeStagedGeneration,
  getStagedGenerationState,
  nextStagedGenerationWork,
  publicStagedGenerationProgress,
  type StagedGenerationBatchState,
  type StagedGenerationState
} from "@/lib/roamly/stagedItineraryGeneration";
import {
  ROAMLY_BRAIN_STAGES,
  ROAMLY_BRAIN_VERSION,
  stageLabel as brainStageLabel,
  type RoamlyBrainStageType
} from "@/lib/roamly/brain/stages";
import { getTravelerMemory, preferenceInfluenceSummary } from "@/lib/roamly/travelerMemory";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export { ROAMLY_BRAIN_STAGES, ROAMLY_BRAIN_VERSION, type RoamlyBrainStageType };
export type GenerationJobStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type GenerationLayerStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "invalidated";

export type RoamlyGenerationJob = {
  id: string;
  trip_id: string;
  user_id: string;
  status: GenerationJobStatus;
  priority: number;
  current_stage: string | null;
  generation_version: string;
  model_version: string | null;
  retry_count: number;
  next_attempt_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  lease_expires_at: string | null;
  idempotency_key: string;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  user_plan?: string | null;
  paid_priority?: boolean | null;
  queue_priority_reason?: string | null;
  duplicate_request_key?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  dead_lettered_at?: string | null;
  dead_letter_reason?: string | null;
  estimated_cost_json?: Record<string, unknown> | null;
  provider_usage_json?: Record<string, unknown> | null;
  worker_metrics_json?: Record<string, unknown> | null;
  rate_limit_bucket?: string | null;
};

export type RoamlyGenerationLayer = {
  id: string;
  trip_id: string;
  job_id: string;
  user_id: string;
  layer_type: RoamlyBrainStageType | string;
  layer_sequence: number;
  status: GenerationLayerStatus;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  evidence_json: Record<string, unknown>;
  dependency_versions_json: Record<string, unknown>;
  retry_count: number;
  next_attempt_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  lease_expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  generation_version: string;
  created_at: string;
  updated_at: string;
  duration_ms?: number | null;
  worker_execution_ms?: number | null;
  estimated_cost_json?: Record<string, unknown> | null;
  provider_usage_json?: Record<string, unknown> | null;
};

export type QueueProgress = {
  tripId: string;
  job: Pick<
    RoamlyGenerationJob,
    | "trip_id"
    | "id"
    | "status"
    | "priority"
    | "current_stage"
    | "generation_version"
    | "model_version"
    | "retry_count"
    | "next_attempt_at"
    | "lease_expires_at"
    | "last_error_code"
    | "last_error_message"
    | "created_at"
    | "started_at"
    | "completed_at"
    | "updated_at"
  >;
  currentStage: string;
  currentStageLabel: string;
  completedLayerCount: number;
  totalLayerCount: number;
  layers: Array<{
    id: string;
    tripId: string;
    layerType: string;
    layerSequence: number;
    label: string;
    status: GenerationLayerStatus;
    retryCount: number;
    lastErrorCode: string | null;
    updatedAt: string;
    completedAt: string | null;
  }>;
};

export type GenerationClaimConfig = {
  workerId: string;
  batchSize?: number;
  leaseSeconds?: number;
  maxRetries?: number;
};

export type GenerationRetryConfig = {
  maxRetries?: number;
  retryBaseSeconds?: number;
  retryMaxSeconds?: number;
};

export type GenerationFinalizationResult = {
  ok: boolean;
  jobId?: string | null;
  tripId?: string | null;
  completedAt?: string | null;
  completedLayerCount?: number;
  error?: string;
};

type GenerationLayerPlanItem = {
  layerType: string;
  layerSequence: number;
  kind: "outline" | "day_batch" | "finalization";
  batchId?: string | null;
  dayNumbers?: number[] | null;
};

const STAGED_OUTLINE_LAYER = "staged_outline";
const STAGED_FINALIZATION_LAYER = "staged_finalization";

function adminOrClient(client?: SupabaseClient | null) {
  return createSupabaseAdminClient() || client || null;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function generationIdempotencyKey(tripId: string, version = ROAMLY_BRAIN_VERSION) {
  return `${tripId}:${version}`;
}

export function stageLabel(stageType?: string | null) {
  const staged = stagedLayerLabel(stageType);
  if (staged) return staged;
  return brainStageLabel(stageType);
}

function stagedDayLayerType(dayNumbers: number[]) {
  return `staged_day_${dayNumbers.join("_")}`;
}

function stagedLayerLabel(stageType?: string | null) {
  if (!stageType) return "";
  if (stageType === STAGED_OUTLINE_LAYER) return "Structuring your trip";
  if (stageType === STAGED_FINALIZATION_LAYER) return "Finalizing your trip";
  const day = stageType.match(/^staged_day_(.+)$/);
  if (!day) return "";
  return `Building Day ${day[1].replace(/_/g, ", ")}`;
}

function totalDayCountForPlan(payload?: TripPlannerPayload | null, state?: StagedGenerationState | null) {
  return Math.max(1, Math.round(state?.totalDayCount || payload?.daysCount || 1));
}

function sortedBatchStates(state?: StagedGenerationState | null) {
  return Object.values(state?.batches || {})
    .filter((batch): batch is StagedGenerationBatchState => Array.isArray(batch.dayNumbers) && batch.dayNumbers.length > 0)
    .sort((a, b) => a.dayNumbers[0] - b.dayNumbers[0]);
}

function generationLayerPlan(payload?: TripPlannerPayload | null, state?: StagedGenerationState | null): GenerationLayerPlanItem[] {
  const batches = sortedBatchStates(state);
  const dayBatches = batches.length
    ? batches.map((batch) => ({ batchId: batch.id, dayNumbers: batch.dayNumbers }))
    : Array.from({ length: totalDayCountForPlan(payload, state) }, (_, index) => ({
        batchId: `batch-${index + 1}`,
        dayNumbers: [index + 1]
      }));
  return [
    {
      layerType: STAGED_OUTLINE_LAYER,
      layerSequence: 1,
      kind: "outline" as const,
      batchId: null,
      dayNumbers: null
    },
    ...dayBatches.map((batch, index) => ({
      layerType: stagedDayLayerType(batch.dayNumbers),
      layerSequence: index + 2,
      kind: "day_batch" as const,
      batchId: batch.batchId,
      dayNumbers: batch.dayNumbers
    })),
    {
      layerType: STAGED_FINALIZATION_LAYER,
      layerSequence: dayBatches.length + 2,
      kind: "finalization" as const,
      batchId: null,
      dayNumbers: null
    }
  ];
}

function currentStagedLayerType(state?: StagedGenerationState | null, payload?: TripPlannerPayload | null) {
  if (!state) return generationLayerPlan(payload, null)[0]?.layerType || STAGED_OUTLINE_LAYER;
  const work = nextStagedGenerationWork(state);
  if (work?.stage === "outline") return STAGED_OUTLINE_LAYER;
  if (work?.stage === "day_batch" && work.dayNumbers?.length) return stagedDayLayerType(work.dayNumbers);
  if (state.status === "failed" || state.status === "partially_failed") {
    const failedBatch = sortedBatchStates(state).find((batch) => batch.status === "failed");
    if (failedBatch) return stagedDayLayerType(failedBatch.dayNumbers);
  }
  return STAGED_FINALIZATION_LAYER;
}

function terminalFailedState(state: StagedGenerationState) {
  return (state.status === "failed" || state.status === "partially_failed") && !canResumeStagedGeneration(state);
}

function layerStatusFromState(plan: GenerationLayerPlanItem, state?: StagedGenerationState | null): GenerationLayerStatus {
  if (!state) return "pending";
  if (state.status === "complete") return "completed";
  if (plan.kind === "outline") {
    if (state.outline) return "completed";
    return terminalFailedState(state) ? "failed" : "pending";
  }
  if (plan.kind === "day_batch") {
    const batch = plan.batchId ? state.batches[plan.batchId] : null;
    const completedByDays = (plan.dayNumbers || []).every((dayNumber) => Boolean(state.generatedDays[String(dayNumber)]));
    if (batch?.status === "complete" || completedByDays) return "completed";
    if (batch?.status === "failed") return "failed";
    return "pending";
  }
  if (terminalFailedState(state)) return "failed";
  return "pending";
}

function terminalQueueStatus(state: StagedGenerationState): GenerationJobStatus {
  if (state.status === "complete") return "completed";
  if (terminalFailedState(state)) return "failed";
  return "waiting";
}

function modelVersion() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

async function ensureGenerationLayers(params: {
  supabase: SupabaseClient;
  job: RoamlyGenerationJob;
  payload?: TripPlannerPayload | null;
  state?: StagedGenerationState | null;
}) {
  const travelerMemory = await getTravelerMemory(params.supabase, params.job.user_id)
    .then((memory) =>
      memory.profile && memory.profile.personalization_enabled !== false
        ? {
            personalizationEnabled: true,
            confirmedPreferences: memory.profile.confirmed_preferences,
            inferredPreferences: memory.profile.inferred_preferences,
            preferenceInfluence: preferenceInfluenceSummary(memory.profile)
          }
        : {
            personalizationEnabled: false,
            confirmedPreferences: {},
            inferredPreferences: {},
            preferenceInfluence: []
          }
    )
    .catch(() => null);
  const input = params.payload
    ? {
        tripId: params.job.trip_id,
        userId: params.job.user_id,
        payload: params.payload,
        travelerMemory,
        generationVersion: params.job.generation_version
      }
    : {
        tripId: params.job.trip_id,
        userId: params.job.user_id,
        travelerMemory,
        generationVersion: params.job.generation_version
      };

  const plan = generationLayerPlan(params.payload, params.state);
  const rows = plan.map((stage) => ({
    trip_id: params.job.trip_id,
    job_id: params.job.id,
    user_id: params.job.user_id,
    layer_type: stage.layerType,
    layer_sequence: stage.layerSequence,
    status: "pending",
    input_json: {
      ...input,
      stagedLayer: stage
    },
    output_json: {},
    evidence_json: {},
    dependency_versions_json: {},
    generation_version: params.job.generation_version
  }));

  const existing = await params.supabase
    .from("roamly_trip_generation_layers")
    .select("id,layer_type,layer_sequence")
    .eq("job_id", params.job.id)
    .order("layer_sequence", { ascending: true });
  if (existing.error) return { ok: false as const, error: existing.error.message };

  const expectedKey = rows.map((row) => `${row.layer_sequence}:${row.layer_type}`).join("|");
  const existingKey = (existing.data || []).map((row) => `${row.layer_sequence}:${row.layer_type}`).join("|");
  if (existing.data?.length && existingKey !== expectedKey) {
    const deleted = await params.supabase
      .from("roamly_trip_generation_layers")
      .delete()
      .eq("job_id", params.job.id);
    if (deleted.error) return { ok: false as const, error: deleted.error.message };
  }

  const { error } = await params.supabase
    .from("roamly_trip_generation_layers")
    .upsert(rows, {
      onConflict: "job_id,layer_type,generation_version",
      ignoreDuplicates: true
    });

  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function createOrResumeGenerationJob(params: {
  supabase?: SupabaseClient | null;
  tripId: string;
  userId: string;
  payload?: TripPlannerPayload | null;
  priority?: number;
  userPlan?: string | null;
  paidPriority?: boolean;
  queuePriorityReason?: string | null;
  duplicateRequestKey?: string | null;
  reason?: string;
}) {
  const supabase = adminOrClient(params.supabase);
  if (!supabase) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING" };

  const idempotencyKey = generationIdempotencyKey(params.tripId);
  const existing = await supabase
    .from("roamly_trip_generation_jobs")
    .select("*")
    .eq("user_id", params.userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.error && !/does not exist|schema cache/i.test(existing.error.message)) {
    return { ok: false as const, error: existing.error.message };
  }

  if (existing.data) {
    const job = existing.data as RoamlyGenerationJob;
    if (!["completed", "cancelled"].includes(job.status)) {
      await supabase
        .from("roamly_trip_generation_jobs")
        .update({
          priority: Math.max(job.priority || 0, Math.max(0, Math.round(params.priority || 0))),
          current_stage: currentStagedLayerType(null, params.payload || null),
          user_plan: params.userPlan || job.user_plan || "free",
          paid_priority: params.paidPriority === true || job.paid_priority === true,
          queue_priority_reason: params.queuePriorityReason || job.queue_priority_reason || params.reason || null,
          duplicate_request_key: params.duplicateRequestKey || job.duplicate_request_key || null
        })
        .eq("id", job.id);
      await ensureGenerationLayers({ supabase, job, payload: params.payload });
      return { ok: true as const, job, resumed: true };
    }
  }

  const insert = await supabase
    .from("roamly_trip_generation_jobs")
    .insert({
      trip_id: params.tripId,
      user_id: params.userId,
      status: "queued",
      priority: Math.max(0, Math.round(params.priority || 0)),
      user_plan: params.userPlan || "free",
      paid_priority: params.paidPriority === true,
      queue_priority_reason: params.queuePriorityReason || params.reason || null,
      duplicate_request_key: params.duplicateRequestKey || null,
      current_stage: currentStagedLayerType(null, params.payload || null),
      generation_version: ROAMLY_BRAIN_VERSION,
      model_version: modelVersion(),
      idempotency_key: idempotencyKey,
      next_attempt_at: new Date().toISOString()
    })
    .select("*")
    .single();

  if (insert.error) {
    if (/duplicate key/i.test(insert.error.message)) {
      const retry = await supabase
        .from("roamly_trip_generation_jobs")
        .select("*")
        .eq("user_id", params.userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (retry.data) {
        const job = retry.data as RoamlyGenerationJob;
        await ensureGenerationLayers({ supabase, job, payload: params.payload });
        await markQueueCurrentStage({
          supabase,
          tripId: params.tripId,
          userId: params.userId,
          currentStage: currentStagedLayerType(null, params.payload || null),
          status: job.status === "failed" ? "waiting" : undefined
        });
        return { ok: true as const, job, resumed: true };
      }
    }
    return { ok: false as const, error: insert.error.message };
  }

  const job = insert.data as RoamlyGenerationJob;
  const layers = await ensureGenerationLayers({ supabase, job, payload: params.payload });
  if (!layers.ok) return { ok: false as const, error: layers.error };
  return { ok: true as const, job, resumed: false };
}

export async function getGenerationQueueForTrip(params: {
  supabase: SupabaseClient;
  tripId: string;
  userId: string;
}) {
  const jobResult = await params.supabase
    .from("roamly_trip_generation_jobs")
    .select("*")
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobResult.error || !jobResult.data) {
    return {
      job: null,
      layers: [] as RoamlyGenerationLayer[],
      error: jobResult.error?.message || null
    };
  }

  const layersResult = await params.supabase
    .from("roamly_trip_generation_layers")
    .select("*")
    .eq("job_id", jobResult.data.id)
    .eq("user_id", params.userId)
    .order("layer_sequence", { ascending: true });

  return {
    job: jobResult.data as RoamlyGenerationJob,
    layers: (layersResult.data || []) as RoamlyGenerationLayer[],
    error: layersResult.error?.message || null
  };
}

export async function getGenerationQueueForTripAdmin(params: {
  tripId: string;
  userId?: string;
}) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { job: null, layers: [] as RoamlyGenerationLayer[], error: "SUPABASE_SERVICE_ROLE_MISSING" };

  let query = supabase
    .from("roamly_trip_generation_jobs")
    .select("*")
    .eq("trip_id", params.tripId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (params.userId) query = query.eq("user_id", params.userId);
  const jobResult = await query.maybeSingle();
  if (jobResult.error || !jobResult.data) {
    return { job: null, layers: [] as RoamlyGenerationLayer[], error: jobResult.error?.message || null };
  }

  const layersResult = await supabase
    .from("roamly_trip_generation_layers")
    .select("*")
    .eq("job_id", jobResult.data.id)
    .order("layer_sequence", { ascending: true });

  return {
    job: jobResult.data as RoamlyGenerationJob,
    layers: (layersResult.data || []) as RoamlyGenerationLayer[],
    error: layersResult.error?.message || null
  };
}

async function latestJobForTrip(params: {
  supabase: SupabaseClient;
  tripId: string;
  userId: string;
}) {
  const { data, error } = await params.supabase
    .from("roamly_trip_generation_jobs")
    .select("*")
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message, job: null as RoamlyGenerationJob | null };
  return { ok: true as const, job: (data || null) as RoamlyGenerationJob | null };
}

export async function reconcileGenerationLayersFromStagedState(params: {
  supabase?: SupabaseClient | null;
  tripId: string;
  userId: string;
  state: StagedGenerationState;
  job?: RoamlyGenerationJob | null;
}) {
  const supabase = adminOrClient(params.supabase);
  if (!supabase) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING" };

  const jobResult = params.job
    ? { ok: true as const, job: params.job }
    : await latestJobForTrip({ supabase, tripId: params.tripId, userId: params.userId });
  if (!jobResult.ok) return jobResult;
  const job = jobResult.job;
  if (!job) return { ok: true as const, skipped: true, layers: [] as RoamlyGenerationLayer[] };

  const ensured = await ensureGenerationLayers({
    supabase,
    job,
    payload: params.state.payload,
    state: params.state
  });
  if (!ensured.ok) return ensured;

  const layersResult = await supabase
    .from("roamly_trip_generation_layers")
    .select("*")
    .eq("job_id", job.id)
    .eq("user_id", params.userId)
    .order("layer_sequence", { ascending: true });
  if (layersResult.error) return { ok: false as const, error: layersResult.error.message };

  const now = new Date().toISOString();
  const plan = generationLayerPlan(params.state.payload, params.state);
  const planByType = new Map(plan.map((item) => [item.layerType, item]));
  const updates = (layersResult.data || []).map(async (layer) => {
    const row = layer as RoamlyGenerationLayer;
    const layerPlan = planByType.get(row.layer_type);
    if (!layerPlan) return null;
    const status = layerStatusFromState(layerPlan, params.state);
    const errorCode =
      status === "failed"
        ? layerPlan.kind === "day_batch" && layerPlan.batchId
          ? params.state.batches[layerPlan.batchId]?.lastError || params.state.lastErrorCode || "GENERATION_LAYER_FAILED"
          : params.state.lastErrorCode || "GENERATION_LAYER_FAILED"
        : null;
    if (
      row.status === status &&
      (status !== "completed" || row.completed_at) &&
      row.error_code === errorCode
    ) {
      return row;
    }
    const { data, error } = await supabase
      .from("roamly_trip_generation_layers")
      .update({
        status,
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        completed_at: status === "completed" ? row.completed_at || now : null,
        error_code: errorCode,
        error_message: status === "failed" ? params.state.lastError || errorCode : null,
        next_attempt_at: row.next_attempt_at || now
      })
      .eq("id", row.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data || row) as RoamlyGenerationLayer;
  });

  const layers = await Promise.all(updates);
  return {
    ok: true as const,
    job,
    currentStage: currentStagedLayerType(params.state, params.state.payload),
    layers: layers.filter((layer): layer is RoamlyGenerationLayer => Boolean(layer))
  };
}

export function publicQueueProgress(
  queue: { job: RoamlyGenerationJob | null; layers: RoamlyGenerationLayer[] },
  metadata?: unknown,
  expectedTripId?: string | null
): QueueProgress | null {
  if (!queue.job) return null;
  const tripId = queue.job.trip_id;
  if (expectedTripId && tripId !== expectedTripId) return null;
  const staged = publicStagedGenerationProgress(metadata || {}, tripId);
  const stagedState = getStagedGenerationState(metadata || {}, tripId);
  const layers = queue.layers.length
    ? queue.layers
    : generationLayerPlan(stagedState?.payload || null, stagedState).map((stage) => ({
        id: `${queue.job?.id || "job"}-${stage.layerType}`,
        trip_id: queue.job?.trip_id || "",
        job_id: queue.job?.id || "",
        user_id: queue.job?.user_id || "",
        layer_type: stage.layerType,
        layer_sequence: stage.layerSequence,
        status: layerStatusFromState(stage, stagedState),
        input_json: {},
        output_json: {},
        evidence_json: {},
        dependency_versions_json: {},
        retry_count: 0,
        next_attempt_at: null,
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        started_at: null,
        completed_at: null,
        error_code: null,
        error_message: null,
        generation_version: queue.job?.generation_version || ROAMLY_BRAIN_VERSION,
        created_at: queue.job?.created_at || new Date().toISOString(),
        updated_at: queue.job?.updated_at || new Date().toISOString()
      }));
  const completedLayerCount = layers.filter((layer) => layer.status === "completed" || layer.status === "skipped").length;
  const active =
    layers.find((layer) => layer.status === "running") ||
    layers.find((layer) => layer.status === "pending" || layer.status === "failed" || layer.status === "invalidated") ||
    layers.at(-1);
  const currentStage = active?.layer_type || queue.job.current_stage || "queued";

  return {
    tripId,
    job: {
      id: queue.job.id,
      trip_id: queue.job.trip_id,
      status: queue.job.status,
      priority: queue.job.priority,
      current_stage: queue.job.current_stage,
      generation_version: queue.job.generation_version,
      model_version: queue.job.model_version,
      retry_count: queue.job.retry_count,
      next_attempt_at: queue.job.next_attempt_at,
      lease_expires_at: queue.job.lease_expires_at,
      last_error_code: queue.job.last_error_code,
      last_error_message: queue.job.last_error_message,
      created_at: queue.job.created_at,
      started_at: queue.job.started_at,
      completed_at: queue.job.completed_at,
      updated_at: queue.job.updated_at
    },
    currentStage,
    currentStageLabel: stageLabel(currentStage),
    completedLayerCount: Math.max(completedLayerCount, staged?.status === "complete" ? layers.length : 0),
    totalLayerCount: layers.length || generationLayerPlan(stagedState?.payload || null, stagedState).length,
    layers: layers.map((layer) => ({
      id: layer.id,
      tripId: layer.trip_id,
      layerType: layer.layer_type,
      layerSequence: layer.layer_sequence,
      label: stageLabel(layer.layer_type),
      status: layer.status,
      retryCount: layer.retry_count,
      lastErrorCode: layer.error_code,
      updatedAt: layer.updated_at,
      completedAt: layer.completed_at
    }))
  };
}

export async function markQueueCurrentStage(params: {
  supabase?: SupabaseClient | null;
  tripId: string;
  userId: string;
  currentStage: string;
  status?: GenerationJobStatus;
}) {
  const supabase = adminOrClient(params.supabase);
  if (!supabase) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING" };
  const { error } = await supabase
    .from("roamly_trip_generation_jobs")
    .update({
      current_stage: params.currentStage,
      ...(params.status ? { status: params.status } : {})
    })
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .in("status", ["queued", "running", "waiting", "failed"]);
  if (error && !/does not exist|schema cache/i.test(error.message)) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function markQueueFromLegacyState(params: {
  supabase?: SupabaseClient | null;
  tripId: string;
  userId: string;
  metadata: unknown;
  preserveRunningStatus?: boolean;
}) {
  const state = getStagedGenerationState(params.metadata, params.tripId);
  if (!state) return { ok: true as const, skipped: true };
  const status = terminalQueueStatus(state);
  const currentStage = currentStagedLayerType(state, state.payload);

  if (params.preserveRunningStatus) {
    const supabase = adminOrClient(params.supabase);
    if (!supabase) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING" };
    const reconciled = await reconcileGenerationLayersFromStagedState({
      supabase,
      tripId: params.tripId,
      userId: params.userId,
      state
    });
    if (!reconciled.ok) return reconciled;
    const runningUpdate = await supabase
      .from("roamly_trip_generation_jobs")
      .update({
        current_stage: currentStage
      })
      .eq("trip_id", params.tripId)
      .eq("user_id", params.userId)
      .eq("status", "running");
    if (runningUpdate.error && !/does not exist|schema cache/i.test(runningUpdate.error.message)) {
      return { ok: false as const, error: runningUpdate.error.message };
    }

    const inactiveUpdate = await supabase
      .from("roamly_trip_generation_jobs")
      .update({
        current_stage: currentStage,
        status
      })
      .eq("trip_id", params.tripId)
      .eq("user_id", params.userId)
      .in("status", ["queued", "waiting", "failed"]);
    if (inactiveUpdate.error && !/does not exist|schema cache/i.test(inactiveUpdate.error.message)) {
      return { ok: false as const, error: inactiveUpdate.error.message };
    }
    return { ok: true as const };
  }

  const supabase = adminOrClient(params.supabase);
  if (!supabase) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING" };
  const reconciled = await reconcileGenerationLayersFromStagedState({
    supabase,
    tripId: params.tripId,
    userId: params.userId,
    state
  });
  if (!reconciled.ok) return reconciled;

  return markQueueCurrentStage({
    supabase,
    tripId: params.tripId,
    userId: params.userId,
    currentStage,
    status
  });
}

export function queueTableMissing(message?: string | null) {
  return Boolean(
    message &&
      /PGRST20[25]|roamly_trip_generation_(jobs|layers)|roamly_(claim|release|complete|schedule|skip|renew|requeue|invalidate|finalize|reconcile)_generation|schema cache|does not exist|could not find (public\.)?roamly_trip_generation_jobs|could not find the (table|function)/i.test(
        message
      )
  );
}

export function safeJsonRecord(value: unknown) {
  return getRecord(value);
}

function rpcError(error: { code?: string; message?: string } | null | undefined) {
  return [error?.code, error?.message].filter(Boolean).join(": ") || "GENERATION_QUEUE_RPC_FAILED";
}

export async function claimGenerationJobs(params: {
  supabase: SupabaseClient;
  config: GenerationClaimConfig;
}) {
  const { data, error } = await params.supabase.rpc("roamly_claim_generation_jobs", {
    p_worker_id: params.config.workerId,
    p_batch_size: params.config.batchSize ?? 5,
    p_lease_seconds: params.config.leaseSeconds ?? 240,
    p_max_retries: params.config.maxRetries ?? 3
  });
  if (error) return { ok: false as const, error: rpcError(error), jobs: [] as RoamlyGenerationJob[] };
  return { ok: true as const, jobs: (data || []) as RoamlyGenerationJob[] };
}

export async function claimGenerationJobByTrip(params: {
  supabase: SupabaseClient;
  tripId: string;
  config: GenerationClaimConfig;
}) {
  const { data, error } = await params.supabase.rpc("roamly_claim_generation_job_by_trip", {
    p_trip_id: params.tripId,
    p_worker_id: params.config.workerId,
    p_lease_seconds: params.config.leaseSeconds ?? 240,
    p_max_retries: params.config.maxRetries ?? 3
  });
  if (error) return { ok: false as const, error: rpcError(error), job: null as RoamlyGenerationJob | null };
  return { ok: true as const, job: (data || null) as RoamlyGenerationJob | null };
}

export async function claimGenerationLayer(params: {
  supabase: SupabaseClient;
  jobId: string;
  config: GenerationClaimConfig;
}) {
  const { data, error } = await params.supabase.rpc("roamly_claim_generation_layer", {
    p_job_id: params.jobId,
    p_worker_id: params.config.workerId,
    p_lease_seconds: params.config.leaseSeconds ?? 240,
    p_max_retries: params.config.maxRetries ?? 3
  });
  if (error) return { ok: false as const, error: rpcError(error), layer: null as RoamlyGenerationLayer | null };
  return { ok: true as const, layer: (data || null) as RoamlyGenerationLayer | null };
}

export async function renewGenerationLease(params: {
  supabase: SupabaseClient;
  jobId: string;
  workerId: string;
  leaseSeconds?: number;
  layerId?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("roamly_renew_generation_lease", {
    p_job_id: params.jobId,
    p_worker_id: params.workerId,
    p_lease_seconds: params.leaseSeconds ?? 240,
    p_layer_id: params.layerId || null
  });
  if (error) return { ok: false as const, error: rpcError(error), renewed: false };
  return { ok: true as const, renewed: data === true };
}

export async function releaseGenerationJob(params: {
  supabase: SupabaseClient;
  jobId: string;
  workerId: string;
  nextStatus?: "queued" | "waiting" | "failed";
}) {
  const { data, error } = await params.supabase.rpc("roamly_release_generation_job", {
    p_job_id: params.jobId,
    p_worker_id: params.workerId,
    p_next_status: params.nextStatus || "waiting"
  });
  if (error) return { ok: false as const, error: rpcError(error), released: false };
  return { ok: true as const, released: data === true };
}

export async function releaseGenerationLayer(params: {
  supabase: SupabaseClient;
  layerId: string;
  workerId: string;
  nextStatus?: "pending" | "failed" | "skipped";
}) {
  const { data, error } = await params.supabase.rpc("roamly_release_generation_layer", {
    p_layer_id: params.layerId,
    p_worker_id: params.workerId,
    p_next_status: params.nextStatus || "pending"
  });
  if (error) return { ok: false as const, error: rpcError(error), released: false };
  return { ok: true as const, released: data === true };
}

export async function completeGenerationLayer(params: {
  supabase: SupabaseClient;
  layerId: string;
  workerId: string;
  outputJson?: Record<string, unknown>;
  evidenceJson?: Record<string, unknown>;
  dependencyVersionsJson?: Record<string, unknown>;
}) {
  const { data, error } = await params.supabase.rpc("roamly_complete_generation_layer", {
    p_layer_id: params.layerId,
    p_worker_id: params.workerId,
    p_output_json: params.outputJson || {},
    p_evidence_json: params.evidenceJson || {},
    p_dependency_versions_json: params.dependencyVersionsJson || {}
  });
  if (error) return { ok: false as const, error: rpcError(error), layer: null as RoamlyGenerationLayer | null };
  return { ok: true as const, layer: (data || null) as RoamlyGenerationLayer | null };
}

export async function scheduleGenerationLayerRetry(params: {
  supabase: SupabaseClient;
  layerId: string;
  workerId: string;
  errorCode: string;
  errorMessage: string;
  retry: GenerationRetryConfig;
}) {
  const { data, error } = await params.supabase.rpc("roamly_schedule_generation_layer_retry", {
    p_layer_id: params.layerId,
    p_worker_id: params.workerId,
    p_error_code: params.errorCode,
    p_error_message: params.errorMessage,
    p_max_retries: params.retry.maxRetries ?? 3,
    p_retry_base_seconds: params.retry.retryBaseSeconds ?? 60,
    p_retry_max_seconds: params.retry.retryMaxSeconds ?? 1800
  });
  if (error) return { ok: false as const, error: rpcError(error), layer: null as RoamlyGenerationLayer | null };
  return { ok: true as const, layer: (data || null) as RoamlyGenerationLayer | null };
}

export async function completeGenerationJob(params: {
  supabase: SupabaseClient;
  jobId: string;
  workerId: string;
}) {
  const { data, error } = await params.supabase.rpc("roamly_complete_generation_job", {
    p_job_id: params.jobId,
    p_worker_id: params.workerId
  });
  if (error) return { ok: false as const, error: rpcError(error), job: null as RoamlyGenerationJob | null };
  return { ok: true as const, job: (data || null) as RoamlyGenerationJob | null };
}

export async function finalizeGenerationCompletion(params: {
  supabase?: SupabaseClient | null;
  jobId: string;
  userId: string;
  generationState?: Record<string, unknown> | null;
  completedAt?: string | null;
}) {
  const supabase = adminOrClient(params.supabase);
  if (!supabase) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING" };

  const completedAt = params.completedAt || new Date().toISOString();
  const { data, error } = await supabase.rpc("roamly_finalize_generation_completion", {
    p_job_id: params.jobId,
    p_user_id: params.userId,
    p_generation_state: params.generationState || null,
    p_completed_at: completedAt
  });
  if (error) return { ok: false as const, error: rpcError(error) };

  const result = getRecord(data) as GenerationFinalizationResult;
  if (result.ok !== true) {
    return {
      ok: false as const,
      error: getString(result.error) || "GENERATION_FINALIZATION_FAILED"
    };
  }

  return {
    ok: true as const,
    jobId: getString(result.jobId) || params.jobId,
    tripId: getString(result.tripId) || null,
    completedAt: getString(result.completedAt) || completedAt,
    completedLayerCount: typeof result.completedLayerCount === "number" ? result.completedLayerCount : 0
  };
}

export async function reconcileCompletedGenerationJobs(params: {
  supabase?: SupabaseClient | null;
  limit?: number;
}) {
  const supabase = adminOrClient(params.supabase);
  if (!supabase) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING", repaired: [] as GenerationFinalizationResult[] };

  const { data, error } = await supabase.rpc("roamly_reconcile_completed_generation_jobs", {
    p_limit: Math.max(1, Math.min(200, Math.round(params.limit || 50)))
  });
  if (error) return { ok: false as const, error: rpcError(error), repaired: [] as GenerationFinalizationResult[] };

  const result = getRecord(data);
  const repaired = Array.isArray(result.repaired) ? (result.repaired as GenerationFinalizationResult[]) : [];
  return {
    ok: result.ok === true,
    repairedCount: typeof result.repairedCount === "number" ? result.repairedCount : repaired.length,
    repaired,
    error: result.ok === true ? undefined : getString(result.error) || "GENERATION_RECONCILIATION_FAILED"
  };
}

export async function scheduleGenerationJobRetry(params: {
  supabase: SupabaseClient;
  jobId: string;
  workerId: string;
  errorCode: string;
  errorMessage: string;
  retry: GenerationRetryConfig;
}) {
  const { data, error } = await params.supabase.rpc("roamly_schedule_generation_job_retry", {
    p_job_id: params.jobId,
    p_worker_id: params.workerId,
    p_error_code: params.errorCode,
    p_error_message: params.errorMessage,
    p_max_retries: params.retry.maxRetries ?? 3,
    p_retry_base_seconds: params.retry.retryBaseSeconds ?? 60,
    p_retry_max_seconds: params.retry.retryMaxSeconds ?? 1800
  });
  if (error) return { ok: false as const, error: rpcError(error), job: null as RoamlyGenerationJob | null };
  return { ok: true as const, job: (data || null) as RoamlyGenerationJob | null };
}

export async function skipRemainingGenerationLayers(params: {
  supabase: SupabaseClient;
  jobId: string;
  workerId: string;
  reason?: string;
}) {
  const { data, error } = await params.supabase.rpc("roamly_skip_remaining_generation_layers", {
    p_job_id: params.jobId,
    p_worker_id: params.workerId,
    p_reason: params.reason || "JOB_COMPLETED"
  });
  if (error) return { ok: false as const, error: rpcError(error), skipped: 0 };
  return { ok: true as const, skipped: typeof data === "number" ? data : 0 };
}

export async function invalidateGenerationLayers(params: {
  supabase: SupabaseClient;
  jobId: string;
  fromSequence: number;
  reason?: string;
}) {
  const { data, error } = await params.supabase.rpc("roamly_invalidate_generation_layers", {
    p_job_id: params.jobId,
    p_from_sequence: params.fromSequence,
    p_reason: params.reason || "DEPENDENCY_INVALIDATED"
  });
  if (error) return { ok: false as const, error: rpcError(error), invalidated: 0 };
  return { ok: true as const, invalidated: typeof data === "number" ? data : 0 };
}

export async function requeueInvalidatedGenerationLayers(params: {
  supabase: SupabaseClient;
  jobId: string;
  generationVersion?: string;
}) {
  const { data, error } = await params.supabase.rpc("roamly_requeue_invalidated_layers", {
    p_job_id: params.jobId,
    p_generation_version: params.generationVersion || ROAMLY_BRAIN_VERSION
  });
  if (error) return { ok: false as const, error: rpcError(error), requeued: 0 };
  return { ok: true as const, requeued: typeof data === "number" ? data : 0 };
}
