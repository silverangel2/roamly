import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStagedGenerationState, publicStagedGenerationProgress } from "@/lib/roamly/stagedItineraryGeneration";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export const ROAMLY_BRAIN_VERSION = "roamly-brain-v1";

export const ROAMLY_BRAIN_STAGES = [
  { type: "traveler_profile", sequence: 1, label: "Learning your preferences" },
  { type: "trip_requirements", sequence: 2, label: "Understanding your trip" },
  { type: "destination_research", sequence: 3, label: "Researching your destination" },
  { type: "transport_search", sequence: 4, label: "Comparing transportation" },
  { type: "transport_decision", sequence: 5, label: "Choosing the best way to travel" },
  { type: "destination_structure", sequence: 6, label: "Structuring your destination" },
  { type: "accommodation_area_selection", sequence: 7, label: "Finding the best area to stay" },
  { type: "accommodation_search", sequence: 8, label: "Comparing accommodations" },
  { type: "accommodation_decision", sequence: 9, label: "Choosing where to stay" },
  { type: "daily_itinerary_generation", sequence: 10, label: "Building your itinerary" },
  { type: "itinerary_logistics_validation", sequence: 11, label: "Checking travel times" },
  { type: "budget_validation", sequence: 12, label: "Checking your budget" },
  { type: "schedule_validation", sequence: 13, label: "Checking your schedule" },
  { type: "backup_plan_generation", sequence: 14, label: "Creating backup plans" },
  { type: "final_assembly", sequence: 15, label: "Finalizing your trip" },
  { type: "completion_notification", sequence: 16, label: "Completed" }
] as const;

export type RoamlyBrainStageType = (typeof ROAMLY_BRAIN_STAGES)[number]["type"];
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
};

export type QueueProgress = {
  job: Pick<
    RoamlyGenerationJob,
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

function adminOrClient(client?: SupabaseClient | null) {
  return createSupabaseAdminClient() || client || null;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function generationIdempotencyKey(tripId: string, version = ROAMLY_BRAIN_VERSION) {
  return `${tripId}:${version}`;
}

export function stageLabel(stageType?: string | null) {
  return ROAMLY_BRAIN_STAGES.find((stage) => stage.type === stageType)?.label || "Preparing your trip";
}

function modelVersion() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

async function ensureGenerationLayers(params: {
  supabase: SupabaseClient;
  job: RoamlyGenerationJob;
  payload?: TripPlannerPayload | null;
}) {
  const input = params.payload
    ? {
        tripId: params.job.trip_id,
        userId: params.job.user_id,
        payload: params.payload,
        generationVersion: params.job.generation_version
      }
    : {
        tripId: params.job.trip_id,
        userId: params.job.user_id,
        generationVersion: params.job.generation_version
      };

  const rows = ROAMLY_BRAIN_STAGES.map((stage) => ({
    trip_id: params.job.trip_id,
    job_id: params.job.id,
    user_id: params.job.user_id,
    layer_type: stage.type,
    layer_sequence: stage.sequence,
    status: "pending",
    input_json: input,
    output_json: {},
    evidence_json: {},
    dependency_versions_json: {},
    generation_version: params.job.generation_version
  }));

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
      current_stage: ROAMLY_BRAIN_STAGES[0].type,
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

export function publicQueueProgress(
  queue: { job: RoamlyGenerationJob | null; layers: RoamlyGenerationLayer[] },
  metadata?: unknown
): QueueProgress | null {
  if (!queue.job) return null;
  const layers = queue.layers.length
    ? queue.layers
    : ROAMLY_BRAIN_STAGES.map((stage) => ({
        id: `${queue.job?.id || "job"}-${stage.type}`,
        trip_id: queue.job?.trip_id || "",
        job_id: queue.job?.id || "",
        user_id: queue.job?.user_id || "",
        layer_type: stage.type,
        layer_sequence: stage.sequence,
        status: "pending" as GenerationLayerStatus,
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
  const staged = publicStagedGenerationProgress(metadata || {});
  const currentStage = active?.layer_type || queue.job.current_stage || "queued";

  return {
    job: {
      id: queue.job.id,
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
    totalLayerCount: layers.length || ROAMLY_BRAIN_STAGES.length,
    layers: layers.map((layer) => ({
      id: layer.id,
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
}) {
  const state = getStagedGenerationState(params.metadata);
  if (!state) return { ok: true as const, skipped: true };
  const stageByLegacy: Record<string, RoamlyBrainStageType> = {
    queued: "trip_requirements",
    validating_input: "trip_requirements",
    generating_outline: "destination_structure",
    generating_day: "daily_itinerary_generation",
    validating_day: "itinerary_logistics_validation",
    enriching_transport: "transport_decision",
    enriching_affiliates: "final_assembly",
    complete: "completion_notification",
    partially_failed: "schedule_validation",
    failed: "schedule_validation"
  };
  const status: GenerationJobStatus =
    state.status === "complete"
      ? "completed"
      : state.status === "failed" || state.status === "partially_failed"
        ? "failed"
        : "waiting";
  return markQueueCurrentStage({
    supabase: params.supabase,
    tripId: params.tripId,
    userId: params.userId,
    currentStage: stageByLegacy[state.currentStage] || "daily_itinerary_generation",
    status
  });
}

export function queueTableMissing(message?: string | null) {
  return Boolean(message && /roamly_trip_generation_(jobs|layers)|schema cache|does not exist/i.test(message));
}

export function safeJsonRecord(value: unknown) {
  return getRecord(value);
}
