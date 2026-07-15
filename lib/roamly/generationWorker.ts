import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendStagedGenerationEmail } from "@/lib/roamly/itineraryGenerationEmail";
import {
  advanceStagedItineraryGeneration,
  getStagedGenerationState,
  publicStagedGenerationProgress,
  StagedGenerationError
} from "@/lib/roamly/stagedItineraryGeneration";
import {
  claimGenerationJobByTrip,
  claimGenerationJobs,
  claimGenerationLayer,
  completeGenerationJob,
  completeGenerationLayer,
  createOrResumeGenerationJob,
  markQueueFromLegacyState,
  releaseGenerationJob,
  releaseGenerationLayer,
  scheduleGenerationJobRetry,
  scheduleGenerationLayerRetry,
  skipRemainingGenerationLayers,
  type GenerationClaimConfig,
  type RoamlyGenerationJob,
  type RoamlyGenerationLayer
} from "@/lib/roamly/generationQueue";
import { recordGenerationCostEvent } from "@/lib/roamly/generationScalability";
import { lockGeneratedItinerary, markFreeItineraryUsed } from "@/lib/roamly/billing";
import { isMissingTableError } from "@/lib/trips";

export type RoamlyGenerationWorkerConfig = {
  batchSize: number;
  concurrency: number;
  maxRetries: number;
  leaseSeconds: number;
  maxLayersPerRun: number;
  retryBaseSeconds: number;
  retryMaxSeconds: number;
};

export type RoamlyGenerationWorkerResult = {
  tripId: string;
  jobId?: string;
  ok: boolean;
  claimed: boolean;
  advanced: boolean;
  terminal: boolean;
  busy?: boolean;
  skipped?: boolean;
  layerType?: string | null;
  layerSequence?: number | null;
  progress?: ReturnType<typeof publicStagedGenerationProgress>;
  email?: unknown;
  error?: string | null;
};

export type RoamlyGenerationWorkerSummary = {
  ok: boolean;
  workerId: string;
  requestId: string;
  config: RoamlyGenerationWorkerConfig;
  claimed: number;
  processed: number;
  advanced: number;
  completed: number;
  failed: number;
  busy: number;
  results: RoamlyGenerationWorkerResult[];
  error?: string;
};

const DEFAULT_CONFIG: RoamlyGenerationWorkerConfig = {
  batchSize: 5,
  concurrency: 3,
  maxRetries: 3,
  leaseSeconds: 240,
  maxLayersPerRun: 1,
  retryBaseSeconds: 60,
  retryMaxSeconds: 1800
};

function envInt(key: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[key]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function getGenerationWorkerConfig(overrides: Partial<RoamlyGenerationWorkerConfig> = {}) {
  return {
    batchSize: overrides.batchSize ?? envInt("ROAMLY_GENERATION_BATCH_SIZE", DEFAULT_CONFIG.batchSize, 1, 25),
    concurrency: overrides.concurrency ?? envInt("ROAMLY_GENERATION_CONCURRENCY", DEFAULT_CONFIG.concurrency, 1, 10),
    maxRetries: overrides.maxRetries ?? envInt("ROAMLY_GENERATION_MAX_RETRIES", DEFAULT_CONFIG.maxRetries, 0, 10),
    leaseSeconds: overrides.leaseSeconds ?? envInt("ROAMLY_GENERATION_LEASE_SECONDS", DEFAULT_CONFIG.leaseSeconds, 30, 1800),
    maxLayersPerRun:
      overrides.maxLayersPerRun ?? envInt("ROAMLY_GENERATION_MAX_LAYERS_PER_RUN", DEFAULT_CONFIG.maxLayersPerRun, 1, 5),
    retryBaseSeconds:
      overrides.retryBaseSeconds ?? envInt("ROAMLY_GENERATION_RETRY_BASE_SECONDS", DEFAULT_CONFIG.retryBaseSeconds, 1, 3600),
    retryMaxSeconds:
      overrides.retryMaxSeconds ?? envInt("ROAMLY_GENERATION_RETRY_MAX_SECONDS", DEFAULT_CONFIG.retryMaxSeconds, 1, 86_400)
  };
}

export function terminalStatus(status?: string | null) {
  return status === "complete" || status === "failed" || status === "partially_failed";
}

function claimConfig(workerId: string, config: RoamlyGenerationWorkerConfig): GenerationClaimConfig {
  return {
    workerId,
    batchSize: config.batchSize,
    leaseSeconds: config.leaseSeconds,
    maxRetries: config.maxRetries
  };
}

function retryConfig(config: RoamlyGenerationWorkerConfig) {
  return {
    maxRetries: config.maxRetries,
    retryBaseSeconds: config.retryBaseSeconds,
    retryMaxSeconds: config.retryMaxSeconds
  };
}

function errorCode(error: unknown) {
  if (error instanceof StagedGenerationError) return error.code;
  if (error instanceof Error) return error.name || "GENERATION_WORKER_FAILED";
  return "GENERATION_WORKER_FAILED";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Generation worker failed.";
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function loadStoredFullItinerary(params: {
  admin: SupabaseClient;
  tripId: string;
  userId: string;
}) {
  const { data, error } = await params.admin
    .from("roamly_itineraries")
    .select("id,full_json,updated_at")
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) {
      return { exists: false as const, dayCount: 0, itineraryId: null, updatedAt: null };
    }
    throw new Error(error.message);
  }

  const full = getRecord(data?.full_json);
  const dayCount = Array.isArray(full?.daily_itinerary) ? full.daily_itinerary.length : 0;
  const finalGenerationNote = /generated through roamly staged ai generation/i.test(
    getString(full?.generation_note)
  );
  return {
    exists: dayCount > 0 && finalGenerationNote,
    dayCount,
    itineraryId: typeof data?.id === "string" ? data.id : null,
    updatedAt: typeof data?.updated_at === "string" ? data.updated_at : null
  };
}

async function loadTrip(admin: SupabaseClient, tripId: string, userId?: string | null) {
  let query = admin
    .from("roamly_trips")
    .select("id,user_id,metadata,itinerary_status,status,updated_at")
    .eq("id", tripId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; user_id: string; metadata: unknown; itinerary_status?: string | null; status?: string | null } | null;
}

async function enqueueLegacyTripJobs(admin: SupabaseClient, config: RoamlyGenerationWorkerConfig) {
  const { data, error } = await admin
    .from("roamly_trips")
    .select("id,user_id,metadata,itinerary_status,status,updated_at")
    .in("itinerary_status", ["generating", "generated", "locked"])
    .order("updated_at", { ascending: true })
    .limit(config.batchSize);

  if (error) return { ok: false as const, error: error.message, enqueued: 0 };

  let enqueued = 0;
  for (const trip of data || []) {
    const state = getStagedGenerationState((trip as { metadata: unknown }).metadata);
    if (!state) continue;
    const result = await createOrResumeGenerationJob({
      supabase: admin,
      tripId: String((trip as { id: string }).id),
      userId: String((trip as { user_id: string }).user_id),
      payload: state.payload,
      priority: terminalStatus(state.status) ? 1 : 10,
      reason: "legacy_staged_generation_transition"
    });
    if (result.ok) enqueued += 1;
  }
  return { ok: true as const, enqueued };
}

async function ensureTripJob(params: {
  admin: SupabaseClient;
  tripId: string;
  userId?: string | null;
}) {
  const trip = await loadTrip(params.admin, params.tripId, params.userId);
  if (!trip) return { ok: false as const, error: "Trip not found.", jobReady: false };
  const state = getStagedGenerationState(trip.metadata);
  const result = await createOrResumeGenerationJob({
    supabase: params.admin,
    tripId: params.tripId,
    userId: trip.user_id,
    payload: state?.payload || null,
    priority: terminalStatus(state?.status) ? 1 : 10,
    reason: "worker_trip_target"
  });
  if (!result.ok) return { ok: false as const, error: result.error, jobReady: false };
  return { ok: true as const, trip, jobReady: true };
}

async function finalizeStoredFullItinerary(params: {
  admin: SupabaseClient;
  job: RoamlyGenerationJob;
  state?: ReturnType<typeof getStagedGenerationState> | null;
  source: "stored_itinerary_recovery" | "terminal_state_cleanup";
}) {
  const stored = await loadStoredFullItinerary({
    admin: params.admin,
    tripId: params.job.trip_id,
    userId: params.job.user_id
  });
  if (!stored.exists) return null;

  const completedAt = new Date().toISOString();
  const completedState = params.state
    ? {
        ...params.state,
        status: "complete" as const,
        currentStage: "complete" as const,
        completedDayCount: Math.max(params.state.completedDayCount, stored.dayCount),
        totalDayCount: Math.max(params.state.totalDayCount, stored.dayCount),
        completedAt,
        updatedAt: completedAt,
        worker: null,
        lastError: null,
        lastErrorCode: null
      }
    : null;
  const currentTrip = await params.admin
    .from("roamly_trips")
    .select("metadata")
    .eq("id", params.job.trip_id)
    .eq("user_id", params.job.user_id)
    .maybeSingle();
  const currentMetadata = getRecord(currentTrip.data?.metadata) || {};

  if (params.state?.unlockSource === "free") {
    await markFreeItineraryUsed(params.admin, params.job.user_id, params.job.trip_id).catch(() => null);
  }

  await lockGeneratedItinerary(
    params.admin,
    params.job.user_id,
    params.job.trip_id,
    params.state?.unlockSource || "paid"
  ).catch(() => null);

  await Promise.all([
    params.admin
      .from("roamly_trip_generation_layers")
      .update({
        status: "skipped",
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        completed_at: completedAt,
        error_code: null,
        error_message: "STORED_ITINERARY_COMPLETED",
        updated_at: completedAt
      })
      .eq("job_id", params.job.id)
      .in("status", ["pending", "running", "failed", "invalidated"]),
    params.admin
      .from("roamly_trip_generation_jobs")
      .update({
        status: "completed",
        current_stage: "completion_notification",
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        completed_at: completedAt,
        updated_at: completedAt,
        last_error_code: null,
        last_error_message: null
      })
      .eq("id", params.job.id),
    params.admin
      .from("roamly_trips")
      .update({
        status: "generated",
        itinerary_status: "generated",
        ...(completedState ? { metadata: { ...currentMetadata, generation: completedState } } : {}),
        updated_at: completedAt
      })
      .eq("id", params.job.trip_id)
      .eq("user_id", params.job.user_id)
  ]);

  const email = await sendStagedGenerationEmail({
    tripId: params.job.trip_id,
    kind: "completion"
  });

  return {
    tripId: params.job.trip_id,
    jobId: params.job.id,
    ok: true,
    claimed: true,
    advanced: false,
    terminal: true,
    progress: completedState ? publicStagedGenerationProgress({ generation: completedState }) : null,
    email,
    error: params.source
  } satisfies RoamlyGenerationWorkerResult;
}

async function finishTerminalJob(params: {
  admin: SupabaseClient;
  job: RoamlyGenerationJob;
  workerId: string;
  state: NonNullable<ReturnType<typeof getStagedGenerationState>>;
}) {
  await markQueueFromLegacyState({
    supabase: params.admin,
    tripId: params.job.trip_id,
    userId: params.job.user_id,
    metadata: { generation: params.state }
  });

  let email: unknown = null;
  if (params.state.status === "complete") {
    await skipRemainingGenerationLayers({
      supabase: params.admin,
      jobId: params.job.id,
      workerId: params.workerId,
      reason: "STAGED_GENERATION_COMPLETED"
    });
    await completeGenerationJob({ supabase: params.admin, jobId: params.job.id, workerId: params.workerId });

    const completedAt = new Date().toISOString();

    await params.admin
      .from("roamly_trip_generation_jobs")
      .update({
        status: "completed",
        completed_at: completedAt,
        updated_at: completedAt
      })
      .eq("id", params.job.id);

    await params.admin
      .from("roamly_trips")
      .update({
        status: "generated",
        itinerary_status: "generated",
        updated_at: completedAt
      })
      .eq("id", params.job.trip_id)
      .eq("user_id", params.job.user_id);

    email = await sendStagedGenerationEmail({
      tripId: params.job.trip_id,
      kind: "completion"
    });
  } else {
    await scheduleGenerationJobRetry({
      supabase: params.admin,
      jobId: params.job.id,
      workerId: params.workerId,
      errorCode: params.state.lastErrorCode || "STAGED_GENERATION_TERMINAL_FAILURE",
      errorMessage: params.state.lastError || "Staged generation reached a terminal failure state.",
      retry: { maxRetries: 0, retryBaseSeconds: 1, retryMaxSeconds: 1 }
    });
    email = await sendStagedGenerationEmail({
      tripId: params.job.trip_id,
      kind: "failure"
    });
  }
  return email;
}

async function handleLayerFailure(params: {
  admin: SupabaseClient;
  job: RoamlyGenerationJob;
  layer: RoamlyGenerationLayer | null;
  workerId: string;
  config: RoamlyGenerationWorkerConfig;
  error: unknown;
}) {
  const code = errorCode(params.error);
  const message = errorMessage(params.error);
  if (params.layer) {
    await scheduleGenerationLayerRetry({
      supabase: params.admin,
      layerId: params.layer.id,
      workerId: params.workerId,
      errorCode: code,
      errorMessage: message,
      retry: retryConfig(params.config)
    });
  }
  await scheduleGenerationJobRetry({
    supabase: params.admin,
    jobId: params.job.id,
    workerId: params.workerId,
    errorCode: code,
    errorMessage: message,
    retry: retryConfig(params.config)
  });
  return { code, message };
}

async function processClaimedJob(params: {
  admin: SupabaseClient;
  job: RoamlyGenerationJob;
  workerId: string;
  requestId: string;
  config: RoamlyGenerationWorkerConfig;
}) {
  let advanced = false;
  let currentLayer: RoamlyGenerationLayer | null = null;

  try {
    for (let index = 0; index < params.config.maxLayersPerRun; index += 1) {
      const trip = await loadTrip(params.admin, params.job.trip_id, params.job.user_id);
      if (!trip) {
        throw new StagedGenerationError("Trip not found.", "TRIP_NOT_FOUND", 404, true);
      }

      const state = getStagedGenerationState(trip.metadata);
      if (state && terminalStatus(state.status)) {
        if (state.status === "complete") {
          const recovered = await finalizeStoredFullItinerary({
            admin: params.admin,
            job: params.job,
            state,
            source: "terminal_state_cleanup"
          });
          if (recovered) return recovered;
        }
        const email = await finishTerminalJob({
          admin: params.admin,
          job: params.job,
          workerId: params.workerId,
          state
        });
        return {
          tripId: params.job.trip_id,
          jobId: params.job.id,
          ok: true,
          claimed: true,
          advanced,
          terminal: true,
          progress: publicStagedGenerationProgress({ generation: state }),
          email
        } satisfies RoamlyGenerationWorkerResult;
      }

      const recovered = await finalizeStoredFullItinerary({
        admin: params.admin,
        job: params.job,
        state,
        source: "stored_itinerary_recovery"
      });
      if (recovered) return recovered;

      const claimedLayer = await claimGenerationLayer({
        supabase: params.admin,
        jobId: params.job.id,
        config: claimConfig(params.workerId, params.config)
      });
      if (!claimedLayer.ok) throw new Error(claimedLayer.error);
      currentLayer = claimedLayer.layer;
      if (!currentLayer) {
        await releaseGenerationJob({
          supabase: params.admin,
          jobId: params.job.id,
          workerId: params.workerId,
          nextStatus: "waiting"
        });
        return {
          tripId: params.job.trip_id,
          jobId: params.job.id,
          ok: true,
          claimed: true,
          advanced,
          terminal: false,
          skipped: true,
          error: "No claimable layer is ready."
        } satisfies RoamlyGenerationWorkerResult;
      }

      const result = await advanceStagedItineraryGeneration({
        supabase: params.admin,
        tripId: params.job.trip_id,
        requestId: params.requestId
      });

      if ("busy" in result && result.busy) {
        await releaseGenerationLayer({
          supabase: params.admin,
          layerId: currentLayer.id,
          workerId: params.workerId,
          nextStatus: "pending"
        });
        await releaseGenerationJob({
          supabase: params.admin,
          jobId: params.job.id,
          workerId: params.workerId,
          nextStatus: "waiting"
        });
        return {
          tripId: params.job.trip_id,
          jobId: params.job.id,
          ok: true,
          claimed: true,
          advanced: false,
          terminal: false,
          busy: true,
          progress: publicStagedGenerationProgress({ generation: result.state })
        } satisfies RoamlyGenerationWorkerResult;
      }

      advanced = advanced || result.advanced === true;
      await completeGenerationLayer({
        supabase: params.admin,
        layerId: currentLayer.id,
        workerId: params.workerId,
        outputJson: {
          legacyStage: "stage" in result ? result.stage : null,
          advanced: result.advanced === true,
          progress: publicStagedGenerationProgress({ generation: result.state })
        },
        evidenceJson: {
          source: "legacy_staged_generation",
          processedAt: new Date().toISOString(),
          requestId: params.requestId
        },
        dependencyVersionsJson: {
          stagedGenerationVersion: result.state.version,
          stagedStatus: result.state.status
        }
      });
      await Promise.all([
        recordGenerationCostEvent({
          supabase: params.admin,
          tripId: params.job.trip_id,
          jobId: params.job.id,
          layerId: currentLayer.id,
          userId: params.job.user_id,
          costCategory: "worker_execution",
          unitCount: 1,
          estimatedCostUsd: 0,
          metadata: {
            layerType: currentLayer.layer_type,
            workerId: params.workerId,
            requestId: params.requestId
          }
        }),
        recordGenerationCostEvent({
          supabase: params.admin,
          tripId: params.job.trip_id,
          jobId: params.job.id,
          layerId: currentLayer.id,
          userId: params.job.user_id,
          costCategory: "model_tokens",
          provider: result.state.provider || "openai",
          model: result.state.model || null,
          unitCount: (result.state.aiInputTokens || 0) + (result.state.aiOutputTokens || 0),
          estimatedCostUsd: result.state.estimatedAiCostUsd || 0,
          metadata: {
            cumulative: true,
            aiCallCount: result.state.aiCallCount || 0,
            inputTokens: result.state.aiInputTokens || 0,
            outputTokens: result.state.aiOutputTokens || 0
          }
        })
      ]).catch(() => null);
      await markQueueFromLegacyState({
        supabase: params.admin,
        tripId: params.job.trip_id,
        userId: params.job.user_id,
        metadata: { generation: result.state }
      });

      if (terminalStatus(result.state.status)) {
        const email = await finishTerminalJob({
          admin: params.admin,
          job: params.job,
          workerId: params.workerId,
          state: result.state
        });
        return {
          tripId: params.job.trip_id,
          jobId: params.job.id,
          ok: result.ok,
          claimed: true,
          advanced,
          terminal: true,
          layerType: currentLayer.layer_type,
          layerSequence: currentLayer.layer_sequence,
          progress: publicStagedGenerationProgress({ generation: result.state }),
          error: "error" in result ? result.error : null,
          email
        } satisfies RoamlyGenerationWorkerResult;
      }
    }

    const trip = await loadTrip(params.admin, params.job.trip_id, params.job.user_id);
    const state = trip ? getStagedGenerationState(trip.metadata) : null;
    await releaseGenerationJob({
      supabase: params.admin,
      jobId: params.job.id,
      workerId: params.workerId,
      nextStatus: "waiting"
    });
    return {
      tripId: params.job.trip_id,
      jobId: params.job.id,
      ok: true,
      claimed: true,
      advanced,
      terminal: false,
      layerType: currentLayer?.layer_type || null,
      layerSequence: currentLayer?.layer_sequence || null,
      progress: state ? publicStagedGenerationProgress({ generation: state }) : null
    } satisfies RoamlyGenerationWorkerResult;
  } catch (error) {
    const failure = await handleLayerFailure({
      admin: params.admin,
      job: params.job,
      layer: currentLayer,
      workerId: params.workerId,
      config: params.config,
      error
    });
    return {
      tripId: params.job.trip_id,
      jobId: params.job.id,
      ok: false,
      claimed: true,
      advanced,
      terminal: false,
      layerType: currentLayer?.layer_type || null,
      layerSequence: currentLayer?.layer_sequence || null,
      error: failure.code || failure.message
    } satisfies RoamlyGenerationWorkerResult;
  }
}

async function processJobsInPool(params: {
  admin: SupabaseClient;
  jobs: RoamlyGenerationJob[];
  workerId: string;
  requestId: string;
  config: RoamlyGenerationWorkerConfig;
}) {
  const results: RoamlyGenerationWorkerResult[] = [];
  let cursor = 0;
  const workerCount = Math.min(params.config.concurrency, params.jobs.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < params.jobs.length) {
        const job = params.jobs[cursor];
        cursor += 1;
        results.push(
          await processClaimedJob({
            admin: params.admin,
            job,
            workerId: params.workerId,
            requestId: params.requestId,
            config: params.config
          })
        );
      }
    })
  );

  return results;
}

function summarize(params: {
  workerId: string;
  requestId: string;
  config: RoamlyGenerationWorkerConfig;
  claimed: number;
  results: RoamlyGenerationWorkerResult[];
  error?: string;
}): RoamlyGenerationWorkerSummary {
  return {
    ok: !params.error && params.results.every((result) => result.ok),
    workerId: params.workerId,
    requestId: params.requestId,
    config: params.config,
    claimed: params.claimed,
    processed: params.results.length,
    advanced: params.results.filter((result) => result.advanced).length,
    completed: params.results.filter((result) => result.terminal && result.ok).length,
    failed: params.results.filter((result) => !result.ok).length,
    busy: params.results.filter((result) => result.busy).length,
    results: params.results,
    ...(params.error ? { error: params.error } : {})
  };
}

export async function processGenerationQueue(params: {
  tripId?: string | null;
  userId?: string | null;
  requestId?: string | null;
  reason?: string | null;
  config?: Partial<RoamlyGenerationWorkerConfig>;
} = {}) {
  const admin = createSupabaseAdminClient();
  const config = getGenerationWorkerConfig(params.config || {});
  const requestId = params.requestId || randomUUID();
  const workerId = `roamly-worker:${requestId}`;

  if (!admin) {
    return summarize({
      workerId,
      requestId,
      config,
      claimed: 0,
      results: [],
      error: "SUPABASE_SERVICE_ROLE_MISSING"
    });
  }

  let jobs: RoamlyGenerationJob[] = [];

  if (params.tripId) {
    const ready = await ensureTripJob({ admin, tripId: params.tripId, userId: params.userId });
    if (!ready.ok) {
      return summarize({
        workerId,
        requestId,
        config,
        claimed: 0,
        results: [
          {
            tripId: params.tripId,
            ok: false,
            claimed: false,
            advanced: false,
            terminal: false,
            error: ready.error
          }
        ]
      });
    }
    const claimed = await claimGenerationJobByTrip({
      supabase: admin,
      tripId: params.tripId,
      config: claimConfig(workerId, config)
    });
    if (!claimed.ok) {
      return summarize({ workerId, requestId, config, claimed: 0, results: [], error: claimed.error });
    }
    jobs = claimed.job ? [claimed.job] : [];
  } else {
    await enqueueLegacyTripJobs(admin, config);
    const claimed = await claimGenerationJobs({
      supabase: admin,
      config: claimConfig(workerId, config)
    });
    if (!claimed.ok) {
      return summarize({ workerId, requestId, config, claimed: 0, results: [], error: claimed.error });
    }
    jobs = claimed.jobs;
  }

  if (!jobs.length) {
    return summarize({
      workerId,
      requestId,
      config,
      claimed: 0,
      results: params.tripId
        ? [
            {
              tripId: params.tripId,
              ok: true,
              claimed: false,
              advanced: false,
              terminal: false,
              busy: true,
              error: "No eligible queue job was claimable."
            }
          ]
        : []
    });
  }

  const results = await processJobsInPool({
    admin,
    jobs,
    workerId,
    requestId,
    config
  });

  return summarize({ workerId, requestId, config, claimed: jobs.length, results });
}
