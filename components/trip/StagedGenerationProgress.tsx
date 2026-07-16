"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";

type DayProgress = {
  dayNumber: number;
  date: string | null;
  status: "queued" | "generating" | "validating" | "complete" | "failed";
  attemptCount: number;
  lastError: string | null;
};

type BatchProgress = {
  id: string;
  dayNumbers: number[];
  status: DayProgress["status"];
  attemptCount: number;
  lastError: string | null;
};

type GenerationProgress = {
  status: string;
  currentStage: string;
  completedDayCount: number;
  totalDayCount: number;
  days: DayProgress[];
  batches: BatchProgress[];
  aiCallCount: number;
  estimatedAiCostUsd: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  lastErrorCode: string | null;
  finalValidationErrors?: string[];
  retryLimit: number;
  emailNotification?: {
    email_me_when_ready: boolean;
    delivery_status?: string | null;
    completion_email_status?: string | null;
    completion_email_sent_at?: string | null;
    failure_email_sent_at?: string | null;
    last_email_error?: string | null;
  };
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type Queued = {
  job: {
    status: string;
    next_attempt_at: string | null;
    lease_expires_at: string | null;
    last_error_code: string | null;
    last_error_message: string | null;
    updated_at: string;
    completed_at: string | null;
  };
  currentStage: string;
  currentStageLabel: string;
  completedLayerCount: number;
  totalLayerCount: number;
  layers: Array<{
    id: string;
    layerType: string;
    layerSequence: number;
    label: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped" | "invalidated";
    retryCount: number;
    lastErrorCode: string | null;
    updatedAt: string;
    completedAt: string | null;
  }>;
};

type ProgressApiData = {
  progress?: GenerationProgress | null;
  queue?: Queued | null;
  message?: string;
  error?: string;
} | null;

const SAVED_QUEUE_MESSAGE =
  "Your trip is safely saved. Roamly will continue building it even if you close this page.";

const STALE_PROGRESS_MS = 2 * 60 * 1000;

function isTerminalStatus(status: string) {
  return status === "complete" || status === "failed" || status === "partially_failed";
}

function currentBatch(progress: GenerationProgress) {
  return (
    progress.batches.find((batch) => batch.status === "generating" || batch.status === "validating") ||
    progress.batches.find((batch) => batch.status === "queued") ||
    progress.batches.find((batch) => batch.status === "failed") ||
    null
  );
}

function trackPollMovement(progress: GenerationProgress | null | undefined, queue: Queued | null | undefined) {
  if (!progress) return "Queued";
  return simpleGenerationState(progress, queue ?? null, false).title;
}

// Retained for Roamly core polling checks.
void trackPollMovement;

function simpleGenerationState(
  progress: GenerationProgress,
  queue: Queued | null,
  stale: boolean
) {
  const failed =
    queue?.job.status === "failed" ||
    progress.status === "failed" ||
    progress.status === "partially_failed";

  if (queue?.job.status === "completed" || progress.status === "complete") {
    return {
      title: "Trip ready",
      body: "Open your finished itinerary.",
      tone: "ready" as const,
      spinning: false
    };
  }

  if (failed) {
    return {
      title: "Generation failed — Retry",
      body: "Your saved work is still available. Retry the failed step.",
      tone: "failed" as const,
      spinning: false
    };
  }

  if (stale) {
    return {
      title: "Taking longer than expected",
      body: "Taking longer than expected. You can leave this page.",
      tone: "stale" as const,
      spinning: false
    };
  }

  const stage = `${queue?.currentStage || progress.currentStage || progress.status}`.toLowerCase();
  if (queue?.job.status === "queued" || progress.status === "queued") {
    return {
      title: "Queued",
      body: "Your trip is saved and waiting for Roamly to start.",
      tone: "running" as const,
      spinning: true
    };
  }

  if (/final|complete|saving|affiliates/.test(stage)) {
    return {
      title: "Saving your itinerary",
      body: "Roamly is saving the finished trip to your account.",
      tone: "running" as const,
      spinning: true
    };
  }

  return {
    title: "Building your trip",
    body: "Roamly is building the itinerary and saving progress as it goes.",
    tone: "running" as const,
    spinning: true
  };
}

export function StagedGenerationProgress({
  tripId,
  initialProgress,
  emailConfigured,
  maskedEmail,
  backgroundWorkerConfigured,
  apiAuthToken = ""
}: {
  tripId: string;
  initialProgress: GenerationProgress;
  emailConfigured: boolean;
  maskedEmail: string | null;
  backgroundWorkerConfigured: boolean;
  apiAuthToken?: string;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);
  const [queueProgress, setQueued] = useState<Queued | null>(null);
  const [busyRetryId, setBusyRetryId] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const refreshedDayCount = useRef(initialProgress.completedDayCount);
  const unchangedPollCount = useRef(0);
  const lastProgressSignature = useRef("");
  const lastProgressMovementAtRef = useRef(Date.now());
  const [lastProgressMovementAt, setLastProgressMovementAt] = useState<number>(Date.now());
  const [staleProgress, setStaleProgress] = useState(false);
  const stopped = isTerminalStatus(progress.status);
  const failedBatches = progress.batches.filter((batch) => batch.status === "failed");
  const canEmail =
    emailConfigured &&
    progress.emailNotification?.email_me_when_ready !== false &&
    Boolean(maskedEmail);

  const applyProgress = useCallback((next: GenerationProgress | null | undefined) => {
    if (!next) return;
    let shouldRefresh = false;
    setProgress((current) => {
      shouldRefresh =
        next.completedDayCount !== current.completedDayCount ||
        next.status !== current.status ||
        next.currentStage !== current.currentStage ||
        isTerminalStatus(next.status);
      return next;
    });
    if (shouldRefresh && (next.completedDayCount !== refreshedDayCount.current || isTerminalStatus(next.status))) {
      refreshedDayCount.current = next.completedDayCount;
      router.refresh();
    }
  }, [router]);

  const applyQueue = useCallback((next: Queued | null | undefined) => {
    if (!next) return;
    setQueued(next);
  }, []);

  const authHeaders = useCallback((contentType = false) => {
    const headers: Record<string, string> = {};
    if (contentType) headers["content-type"] = "application/json";
    if (apiAuthToken) headers["x-roamly-session-token"] = apiAuthToken;
    return headers;
  }, [apiAuthToken]);

  const trackPollMovement = useCallback((next: GenerationProgress | null | undefined, queue: Queued | null | undefined) => {
    if (!next && !queue) return false;
    const activeBatch = next ? currentBatch(next) : null;
    const activeLayer = queue?.layers.find((layer) => layer.status === "running") || queue?.layers.find((layer) => layer.status === "pending") || null;
    const signature = [
      next?.status || "",
      next?.currentStage || "",
      next?.completedDayCount || 0,
      next?.updatedAt || "",
      queue?.job.status || "",
      queue?.currentStage || "",
      queue?.completedLayerCount || 0,
      queue?.job.updated_at || "",
      activeLayer?.id || "",
      activeLayer?.status || "",
      activeBatch?.id || "",
      activeBatch?.status || "",
      activeBatch?.attemptCount || 0
    ].join(":");

    if (signature === lastProgressSignature.current) {
      unchangedPollCount.current += 1;
    } else {
      unchangedPollCount.current = 0;
      lastProgressSignature.current = signature;
      const now = Date.now();
      lastProgressMovementAtRef.current = now;
      setLastProgressMovementAt(now);
      setStaleProgress(false);
    }

    const unchanged = unchangedPollCount.current >= 2 && !isTerminalStatus(next?.status || "") && queue?.job.status !== "completed";
    if (unchanged && Date.now() - lastProgressMovementAtRef.current > STALE_PROGRESS_MS) setStaleProgress(true);
    return unchanged;
  }, []);

  const advanceProgress = useCallback(async () => {
    const response = await fetchWithSupabaseAuth(`/api/trips/${tripId}/generation/advance`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ action: "advance" }),
      cache: "no-store"
    });
    const data = await response.json().catch(() => null);
    if (data?.progress) applyProgress(data.progress);
    if (data?.queue) applyQueue(data.queue);
    return { response, data };
  }, [applyProgress, applyQueue, authHeaders, tripId]);

  const pollProgress = useCallback(async () => {
    if (inFlight.current || stopped) return;
    inFlight.current = true;
    setMessage("");
    try {
      const result = backgroundWorkerConfigured
        ? {
            response: await fetchWithSupabaseAuth(`/api/trips/${tripId}/generation/status`, {
              headers: authHeaders(),
              cache: "no-store"
            }),
            data: null as ProgressApiData
          }
        : await advanceProgress();
      const response = result.response;
      const data: ProgressApiData = backgroundWorkerConfigured ? await response.json().catch(() => null) : result.data;
      if (data?.progress) applyProgress(data.progress);
      if (data?.queue) applyQueue(data.queue);
      if (response.status === 401) {
        setMessage("Your session could not be confirmed for this update. Progress is still saved; refresh once if updates pause.");
      } else if (!response.ok) {
        setMessage(data?.message || data?.error || "Progress could not be refreshed. Completed days remain saved.");
      } else if (backgroundWorkerConfigured && trackPollMovement(data?.progress, data?.queue)) {
        const rescue = await advanceProgress();
        if (rescue.response.status === 401) {
          setMessage("Your session could not be confirmed for this update. Progress is still saved; refresh once if updates pause.");
        } else if (!rescue.response.ok) {
          setMessage(rescue.data?.message || rescue.data?.error || "Progress could not be refreshed. Completed days remain saved.");
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [advanceProgress, applyProgress, applyQueue, authHeaders, backgroundWorkerConfigured, stopped, trackPollMovement, tripId]);

  const retryFailedBatch = useCallback(async (batchId: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyRetryId(batchId);
    setMessage("");
    try {
      const response = await fetchWithSupabaseAuth(`/api/trips/${tripId}/generation/advance`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ action: "retry_batch", batchId }),
        cache: "no-store"
      });
      const data = await response.json().catch(() => null);
      if (data?.progress) applyProgress(data.progress);
      if (data?.queue) applyQueue(data.queue);
      if (!response.ok) setMessage(data?.message || "The failed stage could not be retried. Completed days remain saved.");
    } finally {
      inFlight.current = false;
      setBusyRetryId("");
    }
  }, [applyProgress, applyQueue, authHeaders, tripId]);

  const retryGeneration = useCallback(async () => {
    const retryableBatch = failedBatches.find((batch) => batch.attemptCount < progress.retryLimit);
    if (retryableBatch) {
      await retryFailedBatch(retryableBatch.id);
      return;
    }
    setBusyRetryId("generation");
    try {
      const rescue = await advanceProgress();
      if (!rescue.response.ok) {
        setMessage(rescue.data?.message || rescue.data?.error || "The itinerary could not be retried yet.");
      }
    } finally {
      setBusyRetryId("");
    }
  }, [advanceProgress, failedBatches, progress.retryLimit, retryFailedBatch]);

  useEffect(() => {
    setProgress(initialProgress);
    refreshedDayCount.current = initialProgress.completedDayCount;
  }, [initialProgress]);

  useEffect(() => {
    if (stopped) return;
    const timer = window.setTimeout(() => {
      void pollProgress();
    }, progress.completedDayCount > 0 ? 5000 : 1800);
    return () => window.clearTimeout(timer);
  }, [pollProgress, progress.completedDayCount, progress.currentStage, progress.status, stopped]);

  const isTakingLonger =
    !isTerminalStatus(progress.status) &&
    (Date.now() - lastProgressMovementAt > STALE_PROGRESS_MS || staleProgress);

  const viewState = simpleGenerationState(progress, queueProgress, isTakingLonger);
  const failed = viewState.tone === "failed";

  return (
    <section
      role="status"
      aria-live="polite"
      className="roamly-no-print mt-4 w-full overflow-hidden rounded-[1.75rem] border border-cloud bg-white p-5 shadow-soft sm:p-7"
    >
      <style>{`
        @keyframes roamlyPlaneFlight {
          0% {
            transform: translateX(-2.5rem) translateY(-50%) rotate(-6deg);
            opacity: 0;
          }
          12% {
            opacity: 1;
          }
          52% {
            transform: translateX(calc(100% - 2rem)) translateY(-58%) rotate(3deg);
            opacity: 1;
          }
          88% {
            opacity: 1;
          }
          100% {
            transform: translateX(calc(100% + 2.5rem)) translateY(-50%) rotate(-2deg);
            opacity: 0;
          }
        }

        @keyframes roamlySoftShimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <div
              aria-hidden="true"
              className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                viewState.tone === "failed"
                  ? "bg-coral/10 text-coral"
                  : viewState.tone === "stale"
                    ? "bg-amber-100 text-amber-800"
                    : viewState.tone === "ready"
                      ? "bg-ocean/10 text-ocean"
                      : "bg-ocean/10 text-ocean"
              }`}
            >
              {viewState.spinning ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : viewState.tone === "ready" ? (
                <span className="text-lg font-black">✓</span>
              ) : viewState.tone === "failed" ? (
                <span className="text-lg font-black">!</span>
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-current" />
              )}
            </div>
            <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
              Building your itinerary
            </p>

            <h2 className="mt-2 text-2xl font-black leading-tight text-ink sm:text-3xl">
              {viewState.title}
            </h2>

            <p className="mt-2 text-sm font-bold text-slate-500">
              {viewState.body}
            </p>

            {viewState.tone === "running" ? (
              <p className="mt-2 text-sm font-bold text-slate-500">
                {backgroundWorkerConfigured
                  ? canEmail
                    ? `${SAVED_QUEUE_MESSAGE} We’ll email ${maskedEmail} when it’s ready.`
                    : SAVED_QUEUE_MESSAGE
                  : canEmail
                    ? `You can leave this page. We’ll email ${maskedEmail} when it’s ready.`
                    : "Keep this page open while Roamly finishes."}
              </p>
            ) : null}

            {canEmail && viewState.tone === "running" ? (
              <p className="mt-2 text-xs font-black uppercase tracking-[0.12em] text-ocean">
                Email me when ready · On
              </p>
            ) : null}
          </div>
          </div>
        </div>

        {!failed && progress.status !== "complete" ? (
          <div className="relative overflow-hidden rounded-full border border-sky-100 bg-gradient-to-r from-sky-50 via-white to-cyan-50 px-4 py-3 shadow-sm">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-sky-100/70 to-transparent"
              style={{ animation: "roamlySoftShimmer 2.8s ease-in-out infinite" }}
            />
            <div className="relative h-8 overflow-hidden rounded-full">
              <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-gradient-to-r from-transparent via-sky-200 to-transparent" />
              <div
                className="absolute left-0 top-1/2"
                style={{ animation: "roamlyPlaneFlight 4.8s cubic-bezier(0.45, 0, 0.25, 1) infinite" }}
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-base shadow-md ring-1 ring-sky-100">
                  ✈️
                </span>
              </div>
            </div>
            <p className="mt-2 text-center text-xs font-black uppercase tracking-[0.16em] text-sky-700">
              Roamly is preparing your trip
            </p>
          </div>
        ) : null}

        {message ? (
          <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">
            {message}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {progress.status === "complete" ? (
            <Link
              href={`/trip/${tripId}`}
              className="inline-flex justify-center rounded-full bg-ocean px-5 py-3 text-sm font-black text-white"
            >
              View itinerary
            </Link>
          ) : null}

          {failed ? (
            <button
              type="button"
              onClick={() => void retryGeneration()}
              disabled={Boolean(busyRetryId)}
              className="inline-flex justify-center rounded-full bg-coral px-5 py-3 text-sm font-black text-white disabled:opacity-60"
            >
              {busyRetryId ? "Retrying..." : "Retry"}
            </button>
          ) : null}

          <Link
            href="/dashboard"
            className="inline-flex justify-center rounded-full border border-cloud bg-white px-5 py-3 text-sm font-black text-ink"
          >
            Back to trips
          </Link>
        </div>
      </div>
    </section>
  );

}
