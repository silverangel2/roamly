import { after } from "next/server";
import { logGenerationDiagnostic, getPublicSupabaseHost } from "@/lib/roamly/generationDiagnostics";
import { recordAppEvent } from "@/lib/roamly/events";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ScheduleStagedGenerationAdvanceParams = {
  tripId: string;
  origin?: string | null;
  reason: string;
  requestId?: string;
};

// One slice drives the trip's remaining layers in ONE worker run
// (SPEED FIX F6, 2026-11-07): the pre-fix chain ran a single layer
// per slice, so a warm trip's ~7 layers paid a full worker
// claim/reconcile round trip each (~3.6 s apart in production for
// ~1 s stages). The worker now runs layers back to back inside the
// run (maxLayersPerRun below) and yields cleanly when the slice
// budget runs out mid-trip; the slice loop then continues the
// same drive. A day stage needs its 45s timeout + the slice's 1s
// cleanup buffer = 46s; the old 55s slice left only ~9s for claim
// and reconcile overhead. 90s doubles the slack so a slice reliably
// fits a full day stage.
const BACKGROUND_WORKER_SLICE_BUDGET_MS = 90_000;
const BACKGROUND_WORKER_MAX_SLICES = 25;
/** Layers per worker run inside one slice — the whole trip for
 *  any realistic length (outline + one layer per day + finalize;
 *  the worker's own cap clamps at 25). Longer trips simply
 *  continue into the chain's next slice: still one continuous
 *  drive, never a wait for an outside wake. */
const BACKGROUND_WORKER_MAX_LAYERS_PER_RUN = 25;

/** The exact worker config every background slice runs with —
 *  exported so the speed-fix checks pin the production values
 *  (a regression to one layer per run fails the suite, not the
 *  traveller). */
export function getStagedGenerationBackgroundWorkerConfig() {
  return {
    batchSize: 25,
    concurrency: 1,
    maxLayersPerRun: BACKGROUND_WORKER_MAX_LAYERS_PER_RUN,
    executionBudgetMs: BACKGROUND_WORKER_SLICE_BUDGET_MS,
    stageCleanupBufferMs: 1_000
  };
}

/**
 * KF-2 M5 hardening (2026-11-02): when neither generation cron secret
 * is configured, the after() wake used to be dropped with only a
 * console diagnostic — while the cron route (correctly) 401s every
 * secret-less call, so BOTH drivers died together invisibly. The drop
 * is now also recorded as an app event in the EXISTING
 * roamly_app_events store (the same store lib/roamly/cronHeartbeat.ts
 * writes its cron_heartbeat rows to, which owner surfaces already
 * read), under this named event type, so the failure is visible on an
 * owner surface instead of only in function logs. A dedicated
 * cron-heartbeat registry entry was NOT used: that registry models
 * periodic crons with a staleness law (stale after 2x interval), and a
 * wake drop is an event, not a periodic lane — registering it would
 * make the heartbeat board report a permanently "stale" fake cron.
 */
export const GENERATION_WAKE_SECRET_MISSING_EVENT_TYPE = "generation_wake_secret_missing";
export const GENERATION_CRON_SECRET_MISSING_ERROR_CODE = "GENERATION_CRON_SECRET_MISSING";

/**
 * Best-effort owner-surface record of a secret-missing wake drop.
 * Never throws and never blocks the (already dropped) wake path
 * beyond this one insert; returns whether the row was recorded.
 */
async function recordGenerationWakeSecretMissing(params: ScheduleStagedGenerationAdvanceParams): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) return false;
    const result = await recordAppEvent(admin, {
      eventType: GENERATION_WAKE_SECRET_MISSING_EVENT_TYPE,
      path: "/api/cron/roamly-itinerary-generation",
      metadata: {
        tripId: params.tripId,
        reason: params.reason,
        requestId: params.requestId || null,
        errorCode: GENERATION_CRON_SECRET_MISSING_ERROR_CODE,
        severity: "critical",
        impact: "background wake dropped and secret-less cron calls return 401 — no automatic generation driver is running"
      }
    });
    return !result.error;
  } catch {
    return false;
  }
}

export function getGenerationWorkerSecret() {
  return getGenerationWorkerSecrets()[0] || "";
}

export function getGenerationWorkerSecrets() {
  return [
    process.env.ROAMLY_GENERATION_CRON_SECRET,
    process.env.CRON_SECRET
  ]
    .map((value) => value?.trim() || "")
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function siteUrl(origin?: string | null) {
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://roamlyhq.com";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function serializeError(error: unknown, seen = new WeakSet<object>()): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return {
      value: String(error)
    };
  }

  if (seen.has(error)) {
    return {
      circular: true
    };
  }
  seen.add(error);

  const source = error as Error & { cause?: unknown };
  const serialized: Record<string, unknown> = {
    name: source.name,
    message: source.message,
    stack: source.stack,
    cause: source.cause == null ? source.cause : serializeError(source.cause, seen)
  };

  for (const key of Object.getOwnPropertyNames(error)) {
    if (key in serialized) continue;
    const value = (error as Record<string, unknown>)[key];
    serialized[key] = value && typeof value === "object" ? serializeError(value, seen) : value;
  }

  return serialized;
}

function workerResults(summary: unknown) {
  const results = record(summary).results;
  return Array.isArray(results) ? results.map(record) : [];
}

function targetResult(summary: unknown, tripId: string) {
  const results = workerResults(summary);
  return [...results].reverse().find((result) => String(result.tripId || "") === tripId) || (results.length === 1 ? results[0] : null);
}

function terminalResult(result: Record<string, unknown> | null) {
  if (!result) return false;
  const progress = record(result.progress);
  return (
    result.terminal === true ||
    progress.status === "complete" ||
    progress.status === "failed" ||
    progress.status === "partially_failed"
  );
}

function shouldContinueAfterResult(result: Record<string, unknown> | null) {
  if (!result || terminalResult(result) || result.busy === true) return false;
  return result.advanced === true || result.yielded === true;
}

function sumNumber(summaries: unknown[], key: string) {
  return summaries.reduce<number>((sum, summary) => {
    const value = record(summary)[key];
    return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function combinedWorkerSummary(summaries: unknown[], tripId: string) {
  const results = summaries.flatMap(workerResults);
  const target = [...results].reverse().find((result) => result.tripId === tripId) || null;
  return {
    ok: summaries.length > 0 && summaries.every((summary) => record(summary).ok !== false),
    claimed: sumNumber(summaries, "claimed"),
    processed: sumNumber(summaries, "processed"),
    advanced: sumNumber(summaries, "advanced"),
    completed: sumNumber(summaries, "completed"),
    failed: sumNumber(summaries, "failed"),
    busy: sumNumber(summaries, "busy"),
    slices: summaries.length,
    targetTerminal: terminalResult(target),
    targetProgress: target ? target.progress || null : null,
    results
  };
}

async function wakeWorker(params: ScheduleStagedGenerationAdvanceParams, url: string) {
  const { processGenerationQueue } = await import("@/lib/roamly/generationWorker");
  const summaries: unknown[] = [];

  for (let index = 0; index < BACKGROUND_WORKER_MAX_SLICES; index += 1) {
    logGenerationDiagnostic("staged_generation_background_slice_start", {
      requestId: params.requestId,
      tripId: params.tripId,
      route: "stagedGenerationBackground",
      supabaseHost: getPublicSupabaseHost(),
      reason: params.reason,
      sliceIndex: index + 1,
      maxSlices: BACKGROUND_WORKER_MAX_SLICES,
      sliceBudgetMs: BACKGROUND_WORKER_SLICE_BUDGET_MS,
      workerMode: "local_worker_direct",
      protectedWorkerUrl: url
    });
    const summary = await processGenerationQueue({
      tripId: params.tripId,
      requestId: params.requestId || `background:${params.tripId}`,
      reason: index === 0 ? params.reason : `${params.reason}:background_slice_${index + 1}`,
      executionDeadlineMs: Date.now() + BACKGROUND_WORKER_SLICE_BUDGET_MS,
      config: getStagedGenerationBackgroundWorkerConfig()
    });
    summaries.push(summary);

    const result = targetResult(summary, params.tripId);
    const progress = result ? record(result.progress) : {};
    const shouldContinue = shouldContinueAfterResult(result);
    logGenerationDiagnostic("staged_generation_background_slice_result", {
      requestId: params.requestId,
      tripId: params.tripId,
      route: "stagedGenerationBackground",
      supabaseHost: getPublicSupabaseHost(),
      reason: params.reason,
      sliceIndex: index + 1,
      status: record(summary).ok === false ? 500 : 200,
      workerOk: record(summary).ok === true,
      claimed: record(summary).claimed || 0,
      processed: record(summary).processed || 0,
      advanced: record(summary).advanced || 0,
      completed: record(summary).completed || 0,
      failed: record(summary).failed || 0,
      busy: record(summary).busy || 0,
      targetAdvanced: result?.advanced === true,
      targetYielded: result?.yielded === true,
      targetBusy: result?.busy === true,
      targetTerminal: terminalResult(result),
      targetStatus: typeof progress.status === "string" ? progress.status : null,
      targetCompletedDayCount: typeof progress.completedDayCount === "number" ? progress.completedDayCount : null,
      targetTotalDayCount: typeof progress.totalDayCount === "number" ? progress.totalDayCount : null,
      targetError: typeof result?.error === "string" ? result.error : null,
      shouldContinue
    });
    if (!result || !shouldContinue) break;
  }

  const summary = combinedWorkerSummary(summaries, params.tripId);

  return {
    status: summary.ok ? 200 : 500,
    ok: summary.ok,
    url,
    body: summary
  };
}

export function scheduleStagedGenerationAdvance(params: ScheduleStagedGenerationAdvanceParams) {
  const secret = getGenerationWorkerSecret();
  const url = `${siteUrl(params.origin)}/api/cron/roamly-itinerary-generation`;

  logGenerationDiagnostic("staged_generation_background_schedule_requested", {
    requestId: params.requestId,
    tripId: params.tripId,
    route: "stagedGenerationBackground",
    supabaseHost: getPublicSupabaseHost(),
    reason: params.reason,
    protectedWorkerUrl: url,
    workerMode: "local_worker_direct",
    secretPresent: Boolean(secret),
    authorizationHeaderPresent: false,
    cookieHeaderPresent: false
  });

  after(async () => {
    logGenerationDiagnostic("staged_generation_background_after_started", {
      requestId: params.requestId,
      tripId: params.tripId,
      route: "stagedGenerationBackground",
      supabaseHost: getPublicSupabaseHost(),
      reason: params.reason,
      protectedWorkerUrl: url,
      workerMode: "local_worker_direct",
      secretPresent: Boolean(secret),
      authorizationHeaderPresent: false,
      cookieHeaderPresent: false
    });

    if (!secret) {
      logGenerationDiagnostic("staged_generation_background_wake_skipped", {
        requestId: params.requestId,
        tripId: params.tripId,
        route: "stagedGenerationBackground",
        supabaseHost: getPublicSupabaseHost(),
        reason: params.reason,
        errorCode: "GENERATION_CRON_SECRET_MISSING"
      });
      // KF-2 M5 hardening: LOUD + owner-visible. With no secret the
      // cron route also 401s, so this drop kills the last automatic
      // driver for the trip — it must not rest on a console line.
      // Emit a critical structured diagnostic (plus a console.error in
      // the file's wake-failure pattern) and record the app event
      // named by GENERATION_WAKE_SECRET_MISSING_EVENT_TYPE. The
      // stranded-generation recovery sweep remains the backstop for
      // the trip itself once any driver (e.g. a user advance) runs:
      // its state exists, and class C adopts state-with-no-active-job.
      const appEventRecorded = await recordGenerationWakeSecretMissing(params);
      console.error("[Roamly generation trace]", {
        event: "staged_generation_background_wake_dropped_secret_missing",
        severity: "critical",
        requestId: params.requestId,
        tripId: params.tripId,
        route: "stagedGenerationBackground",
        supabaseHost: getPublicSupabaseHost(),
        reason: params.reason,
        errorCode: GENERATION_CRON_SECRET_MISSING_ERROR_CODE,
        appEventType: GENERATION_WAKE_SECRET_MISSING_EVENT_TYPE,
        appEventRecorded
      });
      logGenerationDiagnostic("staged_generation_background_wake_dropped_secret_missing", {
        requestId: params.requestId,
        tripId: params.tripId,
        route: "stagedGenerationBackground",
        supabaseHost: getPublicSupabaseHost(),
        reason: params.reason,
        severity: "critical",
        errorCode: GENERATION_CRON_SECRET_MISSING_ERROR_CODE,
        appEventType: GENERATION_WAKE_SECRET_MISSING_EVENT_TYPE,
        appEventRecorded
      });
      return;
    }

    try {
      logGenerationDiagnostic("staged_generation_background_wake_call_start", {
        requestId: params.requestId,
        tripId: params.tripId,
        route: "stagedGenerationBackground",
        supabaseHost: getPublicSupabaseHost(),
        reason: params.reason,
        protectedWorkerUrl: url,
        workerMode: "local_worker_direct",
        authorizationHeaderPresent: false,
        cookieHeaderPresent: false
      });
      const response = await wakeWorker(params, url);
      const body = response.body;

      logGenerationDiagnostic("staged_generation_background_worker_wake", {
        requestId: params.requestId,
        tripId: params.tripId,
        route: "stagedGenerationBackground",
        supabaseHost: getPublicSupabaseHost(),
        reason: params.reason,
        status: response.status,
        ok: response.ok,
        protectedWorkerUrl: response.url,
        workerMode: "local_worker_direct",
        authorizationHeaderPresent: false,
        cookieHeaderPresent: false,
        workerOk: record(body).ok === true,
        claimed: record(body).claimed || 0,
        processed: record(body).processed || 0,
        completed: record(body).completed || 0,
        advanced: record(body).advanced || 0,
        failed: record(body).failed || 0,
        busy: record(body).busy || 0,
        slices: record(body).slices || null,
        errorCode: response.ok ? null : record(body).error || "BACKGROUND_WORKER_WAKE_FAILED"
      });
    } catch (error) {
      const serializedError = serializeError(error);
      console.error("[Roamly generation trace]", {
        event: "staged_generation_background_worker_wake_failed_error",
        requestId: params.requestId,
        tripId: params.tripId,
        route: "stagedGenerationBackground",
        supabaseHost: getPublicSupabaseHost(),
        reason: params.reason,
        error: serializedError
      });
      logGenerationDiagnostic("staged_generation_background_worker_wake_failed", {
        requestId: params.requestId,
        tripId: params.tripId,
        route: "stagedGenerationBackground",
        supabaseHost: getPublicSupabaseHost(),
        reason: params.reason,
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        cause: error instanceof Error ? String(error.cause) : undefined,
        serializedError: JSON.stringify(serializedError)
      });
    }
  });
}
