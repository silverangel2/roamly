import type { SupabaseClient } from "@supabase/supabase-js";
import { lockGeneratedItinerary, markFreeItineraryUsed, type RoamlyItineraryUnlockSource } from "@/lib/roamly/billing";
import {
  completeGenerationJob,
  finalizeGenerationCompletion,
  queueTableMissing,
  reconcileCompletedGenerationJobs
} from "@/lib/roamly/generationQueue";
import { sendStagedGenerationEmail } from "@/lib/roamly/itineraryGenerationEmail";
import {
  getStagedGenerationState,
  publicStagedGenerationProgress,
  type StagedGenerationState
} from "@/lib/roamly/stagedItineraryGeneration";
import {
  getPublicSupabaseHost,
  logGenerationDiagnostic
} from "@/lib/roamly/generationDiagnostics";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError } from "@/lib/trips";

type FinalizationTrip = {
  id: string;
  user_id: string;
  metadata: unknown;
  status?: string | null;
  itinerary_status?: string | null;
  itinerary_locked?: boolean | null;
  itinerary_locked_at?: string | null;
  itinerary_generated_at?: string | null;
  itinerary_unlock_source?: string | null;
  itinerary_payment_status?: string | null;
};

type StoredFinalItinerary = {
  exists: boolean;
  dayCount: number;
  itineraryId: string | null;
  updatedAt: string | null;
  fullJson: Record<string, unknown> | null;
};

type GenerationJobLookup = {
  jobId: string | null;
  error?: string | null;
};

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getOptionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function adminOrClient(client?: SupabaseClient | null) {
  return createSupabaseAdminClient() || client || null;
}

function nowIso() {
  return new Date().toISOString();
}

export function isFinalStoredItinerary(value: unknown) {
  const record = getRecord(value);
  return (
    Array.isArray(record.daily_itinerary) &&
    record.daily_itinerary.length > 0 &&
    /generated through roamly staged ai generation/i.test(getString(record.generation_note))
  );
}

function finalStoredItineraryFromMetadata(metadata: unknown) {
  const root = getRecord(metadata);
  const generatedItinerary = getRecord(root.generatedItinerary);
  const legacyItinerary = getRecord(root.itinerary);
  return (
    getOptionalRecord(generatedItinerary.full_json) ||
    getOptionalRecord(generatedItinerary.fullJson) ||
    getOptionalRecord(legacyItinerary.full_json) ||
    getOptionalRecord(legacyItinerary.fullJson)
  );
}

export function hasFinalStoredItineraryInMetadata(metadata: unknown) {
  return isFinalStoredItinerary(finalStoredItineraryFromMetadata(metadata));
}

function storedItinerarySummary(value: unknown, updatedAt: string | null, itineraryId: string | null): StoredFinalItinerary {
  const full = getRecord(value);
  const dayCount = Array.isArray(full.daily_itinerary) ? full.daily_itinerary.length : 0;
  return {
    exists: dayCount > 0 && isFinalStoredItinerary(full),
    dayCount,
    itineraryId,
    updatedAt,
    fullJson: dayCount > 0 ? full : null
  };
}

async function loadTrip(params: {
  supabase: SupabaseClient;
  tripId: string;
  userId?: string | null;
}) {
  let query = params.supabase
    .from("roamly_trips")
    .select("id,user_id,metadata,status,itinerary_status,itinerary_locked,itinerary_locked_at,itinerary_generated_at,itinerary_unlock_source,itinerary_payment_status")
    .eq("id", params.tripId);
  if (params.userId) query = query.eq("user_id", params.userId);
  const { data, error } = await query.maybeSingle();
  if (error) return { trip: null, error: error.message };
  return { trip: (data as FinalizationTrip | null) || null, error: null };
}

async function loadStoredFinalItinerary(params: {
  supabase: SupabaseClient;
  trip: FinalizationTrip;
}): Promise<StoredFinalItinerary> {
  const { data, error } = await params.supabase
    .from("roamly_itineraries")
    .select("id,full_json,updated_at")
    .eq("trip_id", params.trip.id)
    .eq("user_id", params.trip.user_id)
    .not("full_json", "is", null)
    .order("updated_at", { ascending: false })
    .limit(5);

  if (!error) {
    const match = (data || []).find((row) => isFinalStoredItinerary((row as { full_json?: unknown }).full_json));
    if (match) {
      const row = match as { id?: unknown; full_json?: unknown; updated_at?: unknown };
      return storedItinerarySummary(row.full_json, getString(row.updated_at) || null, getString(row.id) || null);
    }
  } else if (!isMissingTableError(error.message)) {
    throw new Error(error.message);
  }

  return storedItinerarySummary(
    finalStoredItineraryFromMetadata(params.trip.metadata),
    getString(getRecord(getRecord(params.trip.metadata).generatedItinerary).updated_at) || params.trip.itinerary_generated_at || null,
    null
  );
}

function normalizeUnlockSource(value: unknown): RoamlyItineraryUnlockSource {
  return value === "free" || value === "paid" || value === "bundle" || value === "admin" ? value : "paid";
}

function paymentStatusForUnlockSource(value: RoamlyItineraryUnlockSource) {
  if (value === "free") return "free";
  if (value === "bundle") return "bundled";
  return "paid";
}

function storedDayRecords(stored: StoredFinalItinerary) {
  const days = Array.isArray(stored.fullJson?.daily_itinerary) ? stored.fullJson.daily_itinerary : [];
  return days
    .map((day, index) => {
      const record = getRecord(day);
      const dayNumber = typeof record.day_number === "number" && Number.isFinite(record.day_number)
        ? Math.max(1, Math.round(record.day_number))
        : index + 1;
      return {
        dayNumber,
        date: getString(record.date) || undefined,
        day: record
      };
    })
    .filter((day) => day.dayNumber > 0);
}

function completeDayStates(params: {
  state: StagedGenerationState | null;
  stored: StoredFinalItinerary;
  completedAt: string;
  totalDayCount: number;
}) {
  const existing = params.state?.days || {};
  const days = { ...existing };
  const storedDays = storedDayRecords(params.stored);
  const fallbackDayNumbers = storedDays.length
    ? storedDays.map((day) => day.dayNumber)
    : Array.from({ length: params.totalDayCount }, (_, index) => index + 1);

  for (const dayNumber of fallbackDayNumbers) {
    const key = String(dayNumber);
    const storedDay = storedDays.find((day) => day.dayNumber === dayNumber);
    days[key] = {
      ...(days[key] || {}),
      dayNumber,
      date: days[key]?.date || storedDay?.date,
      status: "complete",
      attemptCount: Math.max(days[key]?.attemptCount || 0, 1),
      lastError: null,
      completedAt: days[key]?.completedAt || params.completedAt,
      updatedAt: params.completedAt
    };
  }

  for (const [key, day] of Object.entries(days)) {
    days[key] = {
      ...day,
      status: "complete",
      lastError: null,
      completedAt: day.completedAt || params.completedAt,
      updatedAt: params.completedAt
    };
  }

  return days;
}

function completeBatchStates(state: StagedGenerationState | null, completedAt: string) {
  return Object.fromEntries(
    Object.entries(state?.batches || {}).map(([id, batch]) => [
      id,
      {
        ...batch,
        status: "complete",
        lastError: null,
        completedAt: batch.completedAt || completedAt,
        updatedAt: completedAt
      }
    ])
  );
}

function generatedDaysFromStored(stored: StoredFinalItinerary) {
  return Object.fromEntries(
    storedDayRecords(stored).map((day) => [String(day.dayNumber), day.day])
  );
}

function completedGenerationState(params: {
  tripId: string;
  state: StagedGenerationState | null;
  stored: StoredFinalItinerary;
  completedAt: string;
}) {
  if (!params.state && !params.stored.exists) return null;
  const totalDayCount = Math.max(params.state?.totalDayCount || 0, params.stored.dayCount || 0);
  const completedDayCount = Math.max(params.state?.completedDayCount || 0, totalDayCount);
  const days = completeDayStates({
    state: params.state,
    stored: params.stored,
    completedAt: params.completedAt,
    totalDayCount
  });
  const storedGeneratedDays = generatedDaysFromStored(params.stored);
  return {
    version: 2,
    ...(params.state || {}),
    tripId: params.tripId,
    status: "complete" as const,
    currentStage: "complete" as const,
    totalDayCount,
    completedDayCount,
    days,
    batches: completeBatchStates(params.state, params.completedAt),
    generatedDays: {
      ...(params.state?.generatedDays || {}),
      ...storedGeneratedDays
    },
    payload: params.state?.payload || ({} as StagedGenerationState["payload"]),
    completedAt: params.state?.completedAt || params.completedAt,
    startedAt: params.state?.startedAt || params.completedAt,
    updatedAt: params.completedAt,
    worker: null,
    lastError: null,
    lastErrorCode: null
  };
}

async function findLatestGenerationJob(params: {
  supabase: SupabaseClient;
  tripId: string;
  userId: string;
}): Promise<GenerationJobLookup> {
  const { data, error } = await params.supabase
    .from("roamly_trip_generation_jobs")
    .select("id")
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { jobId: null, error: [error.code, error.message].filter(Boolean).join(": ") };
  return { jobId: getString(data?.id) || null, error: null };
}

async function finalizeQueueIfAvailable(params: {
  supabase: SupabaseClient;
  jobId?: string | null;
  workerId?: string | null;
  tripId: string;
  userId: string;
  generationState: Record<string, unknown> | null;
  completedAt: string;
  requireQueueFinalization?: boolean;
}) {
  let jobId = params.jobId || null;
  let lookupError: string | null = null;

  if (!jobId) {
    const lookup = await findLatestGenerationJob({
      supabase: params.supabase,
      tripId: params.tripId,
      userId: params.userId
    });
    jobId = lookup.jobId;
    lookupError = lookup.error || null;
  }

  if (lookupError && queueTableMissing(lookupError)) {
    logGenerationDiagnostic("generation_queue_finalization_best_effort_failed", {
      route: "generationFinalization",
      source: "job_lookup",
      tripId: params.tripId,
      supabaseHost: getPublicSupabaseHost(),
      errorCode: lookupError
    });
    return { ok: true as const, jobId: null, skipped: true as const, error: lookupError };
  }
  if (lookupError) {
    logGenerationDiagnostic("generation_queue_finalization_best_effort_failed", {
      route: "generationFinalization",
      source: "job_lookup",
      tripId: params.tripId,
      supabaseHost: getPublicSupabaseHost(),
      errorCode: lookupError
    });
    return { ok: false as const, jobId: null, skipped: true as const, error: lookupError };
  }
  if (!jobId) {
    if (params.requireQueueFinalization) {
      return { ok: false as const, jobId: null, skipped: true as const, error: "GENERATION_JOB_NOT_FOUND" };
    }
    return { ok: true as const, jobId: null, skipped: true as const, error: "GENERATION_JOB_NOT_FOUND" };
  }

  let claimedJobCompleted = false;
  let claimedJobCompletionError: string | null = null;
  if (params.workerId) {
    const completedJob = await completeGenerationJob({
      supabase: params.supabase,
      jobId,
      workerId: params.workerId
    });
    claimedJobCompleted = completedJob.ok && Boolean(completedJob.job);
    if (!completedJob.ok) {
      claimedJobCompletionError = completedJob.error;
      logGenerationDiagnostic("generation_queue_finalization_best_effort_failed", {
        route: "generationFinalization",
        source: "complete_job_rpc",
        tripId: params.tripId,
        jobId,
        supabaseHost: getPublicSupabaseHost(),
        errorCode: completedJob.error
      });
    }
  }

  const finalized = await finalizeGenerationCompletion({
    supabase: params.supabase,
    jobId,
    userId: params.userId,
    generationState: params.generationState,
    completedAt: params.completedAt
  });

  if (finalized.ok) {
    return {
      ok: true as const,
      jobId,
      skipped: false as const,
      completedLayerCount: finalized.completedLayerCount,
      claimedJobCompleted,
      claimedJobCompletionError,
      error: null
    };
  }

  if (queueTableMissing(finalized.error)) {
    logGenerationDiagnostic("generation_queue_finalization_best_effort_failed", {
      route: "generationFinalization",
      source: "queue_rpc",
      tripId: params.tripId,
      jobId,
      supabaseHost: getPublicSupabaseHost(),
      errorCode: finalized.error
    });
    return { ok: true as const, jobId, skipped: true as const, error: finalized.error };
  }

  logGenerationDiagnostic("generation_queue_finalization_best_effort_failed", {
    route: "generationFinalization",
    source: "queue_rpc",
    tripId: params.tripId,
    jobId,
    supabaseHost: getPublicSupabaseHost(),
    errorCode: finalized.error
  });
  return { ok: false as const, jobId, skipped: true as const, error: finalized.error };
}

async function reconcileQueueCompletionIfRequired(params: {
  supabase: SupabaseClient;
  queueFinalization: Awaited<ReturnType<typeof finalizeQueueIfAvailable>>;
}) {
  if (!params.queueFinalization.skipped || !params.queueFinalization.jobId) return null;
  const result = await reconcileCompletedGenerationJobs({
    supabase: params.supabase,
    limit: 10
  });
  if (!result.ok && !queueTableMissing(result.error)) {
    logGenerationDiagnostic("generation_queue_finalization_best_effort_failed", {
      route: "generationFinalization",
      source: "queue_reconcile_rpc",
      jobId: params.queueFinalization.jobId,
      supabaseHost: getPublicSupabaseHost(),
      errorCode: result.error || "GENERATION_RECONCILIATION_FAILED"
    });
  }
  return result;
}

function finalizedMetadata(params: {
  metadata: unknown;
  generationState: Record<string, unknown> | null;
  completedAt: string;
}) {
  const metadata = getRecord(params.metadata);
  const generatedItinerary = getOptionalRecord(metadata.generatedItinerary);
  const itinerary = getOptionalRecord(metadata.itinerary);
  return {
    ...metadata,
    ...(generatedItinerary
      ? {
          generatedItinerary: {
            ...generatedItinerary,
            status: "generated",
            updated_at: getString(generatedItinerary.updated_at) || params.completedAt,
            generated_at: getString(generatedItinerary.generated_at) || params.completedAt
          }
        }
      : {}),
    ...(itinerary
      ? {
          itinerary: {
            ...itinerary,
            status: "generated",
            updated_at: getString(itinerary.updated_at) || params.completedAt,
            generated_at: getString(itinerary.generated_at) || params.completedAt
          }
        }
      : {}),
    ...(params.generationState ? { generation: params.generationState } : {})
  };
}

async function finalizeTripDirectly(params: {
  supabase: SupabaseClient;
  trip: FinalizationTrip;
  generationState: Record<string, unknown> | null;
  completedAt: string;
  unlockSource: RoamlyItineraryUnlockSource;
}) {
  const { error } = await params.supabase
    .from("roamly_trips")
    .update({
      status: "generated",
      itinerary_status: "generated",
      itinerary_locked: true,
      itinerary_locked_at: params.trip.itinerary_locked_at || params.completedAt,
      itinerary_generated_at: params.trip.itinerary_generated_at || params.completedAt,
      itinerary_unlock_source: params.trip.itinerary_unlock_source || params.unlockSource,
      itinerary_payment_status:
        params.trip.itinerary_payment_status && params.trip.itinerary_payment_status !== "unpaid"
          ? params.trip.itinerary_payment_status
          : paymentStatusForUnlockSource(params.unlockSource),
      metadata: finalizedMetadata({
        metadata: params.trip.metadata,
        generationState: params.generationState,
        completedAt: params.completedAt
      }),
      updated_at: params.completedAt
    })
    .eq("id", params.trip.id)
    .eq("user_id", params.trip.user_id);

  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function finalizeCompletedStagedGeneration(params: {
  supabase?: SupabaseClient | null;
  tripId: string;
  userId?: string | null;
  jobId?: string | null;
  workerId?: string | null;
  state?: StagedGenerationState | null;
  completedAt?: string | null;
  source: string;
  sendEmail?: boolean;
  requireQueueFinalization?: boolean;
}) {
  const supabase = adminOrClient(params.supabase);
  if (!supabase) return { ok: false as const, error: "SUPABASE_SERVICE_ROLE_MISSING" };

  const loaded = await loadTrip({ supabase, tripId: params.tripId, userId: params.userId });
  if (loaded.error) return { ok: false as const, error: loaded.error };
  if (!loaded.trip) return { ok: false as const, error: "Trip not found." };

  const trip = loaded.trip;
  const state = params.state || getStagedGenerationState(trip.metadata, params.tripId);
  const stored = await loadStoredFinalItinerary({ supabase, trip });
  const eligible = state?.status === "complete" || stored.exists;
  if (!eligible) return { ok: false as const, error: "FINAL_ITINERARY_NOT_SAVED" };

  const completedAt = params.completedAt || state?.completedAt || stored.updatedAt || nowIso();
  const generationState = completedGenerationState({ tripId: trip.id, state, stored, completedAt });
  const unlockSource = normalizeUnlockSource(state?.unlockSource || trip.itinerary_unlock_source);

  if (unlockSource === "free" && trip.itinerary_unlock_source !== "free" && trip.itinerary_payment_status !== "free") {
    await markFreeItineraryUsed(supabase, trip.user_id, trip.id).catch(() => null);
  }

  if (!trip.itinerary_locked || !trip.itinerary_generated_at) {
    const lock = await lockGeneratedItinerary(supabase, trip.user_id, trip.id, unlockSource);
    if (lock.error) return { ok: false as const, error: lock.error.message };
  }

  const direct = await finalizeTripDirectly({
    supabase,
    trip,
    generationState,
    completedAt,
    unlockSource
  });
  if (!direct.ok) return direct;

  const queueFinalization = await finalizeQueueIfAvailable({
    supabase,
    jobId: params.jobId || null,
    workerId: params.workerId || null,
    tripId: trip.id,
    userId: trip.user_id,
    generationState,
    completedAt,
    requireQueueFinalization: params.requireQueueFinalization === true
  });

  if (!queueFinalization.ok) {
    return { ok: false as const, error: queueFinalization.error || "GENERATION_QUEUE_FINALIZATION_FAILED" };
  }

  const email =
    params.sendEmail === false
      ? null
      : await sendStagedGenerationEmail({
          tripId: trip.id,
          kind: "completion"
        });
  const reconciliation = await reconcileQueueCompletionIfRequired({
    supabase,
    queueFinalization
  });

  return {
    ok: true as const,
    tripId: trip.id,
    userId: trip.user_id,
    jobId: queueFinalization.jobId,
    source: params.source,
    completedAt,
    queueFinalized: !queueFinalization.skipped,
    queueFinalizationError: queueFinalization.error || null,
    claimedQueueJobCompleted: "claimedJobCompleted" in queueFinalization ? queueFinalization.claimedJobCompleted : false,
    claimedQueueJobCompletionError:
      "claimedJobCompletionError" in queueFinalization ? queueFinalization.claimedJobCompletionError : null,
    queueReconciliation: reconciliation,
    storedItineraryId: stored.itineraryId,
    recoveredFromStoredItinerary: stored.exists,
    generationState,
    progress: generationState ? publicStagedGenerationProgress({ generation: generationState }, trip.id) : null,
    email
  };
}

export async function recoverCompletedStoredGenerations(params: {
  supabase?: SupabaseClient | null;
  limit?: number;
  tripId?: string | null;
}) {
  const supabase = adminOrClient(params.supabase);
  if (!supabase) {
    return {
      ok: false as const,
      error: "SUPABASE_SERVICE_ROLE_MISSING",
      repaired: [] as Array<Awaited<ReturnType<typeof finalizeCompletedStagedGeneration>>>,
      errors: [] as Array<{ tripId: string; error: string }>
    };
  }

  const limit = Math.max(1, Math.min(200, Math.round(params.limit || 50)));
  let query = supabase
    .from("roamly_trips")
    .select("id,user_id,metadata,status,itinerary_status,updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (params.tripId) {
    query = query.eq("id", params.tripId);
  } else {
    query = query.or("status.eq.generating,itinerary_status.eq.generating");
  }
  const { data, error } = await query;

  if (error) {
    return {
      ok: false as const,
      error: error.message,
      repaired: [] as Array<Awaited<ReturnType<typeof finalizeCompletedStagedGeneration>>>,
      errors: [] as Array<{ tripId: string; error: string }>
    };
  }

  const repaired: Array<Awaited<ReturnType<typeof finalizeCompletedStagedGeneration>>> = [];
  const errors: Array<{ tripId: string; error: string }> = [];

  for (const row of data || []) {
    const trip = row as Pick<FinalizationTrip, "id" | "user_id" | "metadata">;
    const state = getStagedGenerationState(trip.metadata, trip.id);
    const result = await finalizeCompletedStagedGeneration({
      supabase,
      tripId: trip.id,
      userId: trip.user_id,
      state,
      source: "stored_itinerary_recovery_scan"
    }).catch((finalizationError) => ({
      ok: false as const,
      error: finalizationError instanceof Error ? finalizationError.message : "STORED_ITINERARY_RECOVERY_FAILED"
    }));

    if (result.ok) {
      repaired.push(result);
    } else if (result.error !== "FINAL_ITINERARY_NOT_SAVED") {
      errors.push({ tripId: trip.id, error: result.error });
    }
  }

  return {
    ok: errors.length === 0,
    repairedCount: repaired.length,
    repaired,
    errors,
    error: errors[0]?.error
  };
}
