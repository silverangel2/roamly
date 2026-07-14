import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPendingStagedGenerationEmail } from "@/lib/roamly/itineraryGenerationEmail";
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

  const email = await sendPendingStagedGenerationEmail(params.job.trip_id);
  if (params.state.status === "complete") {
    await skipRemainingGenerationLayers({
      supabase: params.admin,
      jobId: params.job.id,
      workerId: params.workerId,
      reason: "STAGED_GENERATION_COMPLETED"
    });
    await completeGenerationJob({ supabase: params.admin, jobId: params.job.id, workerId: params.workerId });
  } else {
    await scheduleGenerationJobRetry({
      supabase: params.admin,
      jobId: params.job.id,
      workerId: params.workerId,
      errorCode: params.state.lastErrorCode || "STAGED_GENERATION_TERMINAL_FAILURE",
      errorMessage: params.state.lastError || "Staged generation reached a terminal failure state.",
      retry: { maxRetries: 0, retryBaseSeconds: 1, retryMaxSeconds: 1 }
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
