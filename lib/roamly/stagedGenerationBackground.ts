import { after } from "next/server";
import { logGenerationDiagnostic, getPublicSupabaseHost } from "@/lib/roamly/generationDiagnostics";

type ScheduleStagedGenerationAdvanceParams = {
  tripId: string;
  origin?: string | null;
  reason: string;
  requestId?: string;
  directFallbackOnly?: boolean;
};

const BACKGROUND_EXECUTION_BUDGET_MS = 55_000;

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

function summaryErrorMessages(summary: unknown) {
  const root = record(summary);
  const messages = typeof root.error === "string" ? [root.error] : [];
  const results = Array.isArray(root.results) ? root.results : [];
  for (const result of results) {
    const error = record(result).error;
    if (typeof error === "string" && error) messages.push(error);
  }
  return messages;
}

async function queueUnavailableFromSummary(summary: unknown) {
  const { queueTableMissing } = await import("@/lib/roamly/generationQueue");
  return summaryErrorMessages(summary).some((message) => queueTableMissing(message));
}

async function runLocalWorkerFallback(params: ScheduleStagedGenerationAdvanceParams) {
  const requestId = params.requestId || `background:${params.tripId}`;
  const executionDeadlineMs = Date.now() + BACKGROUND_EXECUTION_BUDGET_MS;
  if (params.directFallbackOnly) {
    await runDirectStagedFallback(params, requestId, executionDeadlineMs);
    return;
  }

  const { processGenerationQueue } = await import("@/lib/roamly/generationWorker");
  const summary = await processGenerationQueue({
    tripId: params.tripId,
    requestId,
    reason: `${params.reason}:local_after_fallback`,
    executionDeadlineMs,
    config: {
      batchSize: 1,
      concurrency: 1,
      maxLayersPerRun: 1
    }
  });

  logGenerationDiagnostic("staged_generation_background_local_worker_result", {
    requestId,
    tripId: params.tripId,
    route: "stagedGenerationBackground",
    supabaseHost: getPublicSupabaseHost(),
    reason: params.reason,
    ok: summary.ok,
    claimed: summary.claimed,
    processed: summary.processed,
    advanced: summary.advanced,
    completed: summary.completed,
    failed: summary.failed,
    errorCode: summary.error || summary.results.find((result) => result.error)?.error || null
  });

  if (summary.ok || !(await queueUnavailableFromSummary(summary))) return;

  await runDirectStagedFallback(params, requestId, executionDeadlineMs);
}

async function runDirectStagedFallback(
  params: ScheduleStagedGenerationAdvanceParams,
  requestId: string,
  executionDeadlineMs: number
) {
  const [{ createSupabaseAdminClient }, { advanceStagedItineraryGeneration, publicStagedGenerationProgress }] =
    await Promise.all([
      import("@/lib/supabase/admin"),
      import("@/lib/roamly/stagedItineraryGeneration")
    ]);
  const admin = createSupabaseAdminClient();
  if (!admin) {
    logGenerationDiagnostic("staged_generation_background_direct_fallback_skipped", {
      requestId,
      tripId: params.tripId,
      route: "stagedGenerationBackground",
      supabaseHost: getPublicSupabaseHost(),
      reason: params.reason,
      errorCode: "SUPABASE_SERVICE_ROLE_MISSING"
    });
    return;
  }

  const direct = await advanceStagedItineraryGeneration({
    supabase: admin,
    tripId: params.tripId,
    requestId,
    executionDeadlineMs
  });

  logGenerationDiagnostic("staged_generation_background_direct_fallback_result", {
    requestId,
    tripId: params.tripId,
    route: "stagedGenerationBackground",
    supabaseHost: getPublicSupabaseHost(),
    reason: params.reason,
    ok: direct.ok,
    advanced: direct.advanced,
    busy: "busy" in direct ? direct.busy === true : false,
    status: direct.status,
    stage: "stage" in direct ? direct.stage : null,
    progress: publicStagedGenerationProgress({ generation: direct.state }),
    errorCode: "error" in direct ? direct.error || null : null
  });

  if (direct.ok && direct.status === "complete") {
    const { finalizeCompletedStagedGeneration } = await import("@/lib/roamly/generationFinalization");
    const finalized = await finalizeCompletedStagedGeneration({
      supabase: admin,
      tripId: params.tripId,
      state: direct.state,
      source: "background_direct_fallback_completion"
    });

    logGenerationDiagnostic("staged_generation_background_direct_fallback_finalized", {
      requestId,
      tripId: params.tripId,
      route: "stagedGenerationBackground",
      supabaseHost: getPublicSupabaseHost(),
      reason: params.reason,
      ok: finalized.ok,
      queueFinalized: finalized.ok ? finalized.queueFinalized : false,
      email: finalized.ok ? finalized.email : null,
      errorCode: finalized.ok ? finalized.queueFinalizationError : finalized.error
    });
  }

  if (
    direct.ok &&
    direct.advanced &&
    direct.status === "generating_day"
  ) {
    await runLocalWorkerFallback({
      ...params,
      reason: params.reason + ":continue"
    });
  }
}

export function scheduleStagedGenerationAdvance(params: ScheduleStagedGenerationAdvanceParams) {
  const secret = getGenerationWorkerSecret();
  const url = `${siteUrl(params.origin)}/api/cron/roamly-itinerary-generation`;

  after(async () => {
    let shouldRunLocalFallback = params.directFallbackOnly || !secret;

    if (params.directFallbackOnly) {
      logGenerationDiagnostic("staged_generation_background_direct_fallback_selected", {
        requestId: params.requestId,
        tripId: params.tripId,
        route: "stagedGenerationBackground",
        supabaseHost: getPublicSupabaseHost(),
        reason: params.reason,
        errorCode: "DURABLE_QUEUE_UNAVAILABLE"
      });
    } else if (!secret) {
      logGenerationDiagnostic("staged_generation_background_secret_missing_local_fallback", {
        requestId: params.requestId,
        tripId: params.tripId,
        route: "stagedGenerationBackground",
        supabaseHost: getPublicSupabaseHost(),
        reason: params.reason,
        errorCode: "GENERATION_CRON_SECRET_MISSING"
      });
    } else {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            tripId: params.tripId,
            reason: params.reason,
            requestId: params.requestId || null
          }),
          cache: "no-store"
        });
        const body = await response.json().catch(() => null);
        shouldRunLocalFallback = response.status === 401 || (await queueUnavailableFromSummary(body));

        if (!response.ok) {
          logGenerationDiagnostic("staged_generation_background_trigger_non_ok", {
            requestId: params.requestId,
            tripId: params.tripId,
            route: "stagedGenerationBackground",
            supabaseHost: getPublicSupabaseHost(),
            reason: params.reason,
            status: response.status,
            localFallback: shouldRunLocalFallback,
            errorCode: record(body).error || record(body).errorCode || "BACKGROUND_TRIGGER_NON_OK"
          });
        }
      } catch (error) {
        shouldRunLocalFallback = true;
        logGenerationDiagnostic("staged_generation_background_trigger_failed", {
          requestId: params.requestId,
          tripId: params.tripId,
          route: "stagedGenerationBackground",
          supabaseHost: getPublicSupabaseHost(),
          reason: params.reason,
          errorCode: error instanceof Error ? error.name : "BACKGROUND_TRIGGER_FAILED"
        });
      }
    }

    if (!shouldRunLocalFallback) return;

    await runLocalWorkerFallback(params).catch((error) => {
      logGenerationDiagnostic("staged_generation_background_trigger_failed", {
        requestId: params.requestId,
        tripId: params.tripId,
        route: "stagedGenerationBackground",
        supabaseHost: getPublicSupabaseHost(),
        reason: params.reason,
        errorCode: error instanceof Error ? error.name : "LOCAL_BACKGROUND_FALLBACK_FAILED"
      });
    });
  });
}
