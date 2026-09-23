"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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
  tripId: string;
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
  tripId: string;
  job: {
    trip_id: string;
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
    tripId?: string;
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
  tripId?: string;
  status?: string;
  itineraryStatus?: string;
  completedDayCount?: number;
  totalDayCount?: number;
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

function currentDayNumber(progress: GenerationProgress, queue: Queued | null) {
  const activeBatch = currentBatch(progress);
  const queuedLayer = queue?.layers.find((layer) => layer.status === "running") ||
    queue?.layers.find((layer) => layer.status === "pending");
  const queuedDay = queuedLayer?.layerType.match(/^staged_day_(\d+)/)?.[1];
  return activeBatch?.dayNumbers[0] ||
    (queuedDay ? Number(queuedDay) : Math.min(progress.completedDayCount + 1, progress.totalDayCount));
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
      title: "Your itinerary is ready",
      body: "Your trip is ready to explore. Open the day-by-day plan whenever you are.",
      tone: "ready" as const,
      spinning: false
    };
  }

  if (failed) {
    return {
      title: "We hit a pause — Retry",
      body: "Your saved trip is safe. Roamly can pick up from the step that needs another try.",
      tone: "failed" as const,
      spinning: false
    };
  }

  if (stale) {
    return {
      title: "Your trip is taking a little longer",
      body: "Your saved progress is safe. You can leave this page while Roamly keeps working.",
      tone: "stale" as const,
      spinning: false
    };
  }

  const stage = `${queue?.currentStage || progress.currentStage || progress.status}`.toLowerCase();
  if (queue?.job.status === "queued" || progress.status === "queued") {
    return {
      title: "Getting to know your trip",
      body: "Roamly is turning your destination, dates, and travel style into a thoughtful plan.",
      tone: "running" as const,
      spinning: true
    };
  }

  if (/validating_input|generating_outline/.test(stage)) {
    return {
      title: "Shaping your journey",
      body: "Roamly is bringing your route and travel priorities together.",
      tone: "running" as const,
      spinning: true
    };
  }

  if (/validating_day/.test(stage)) {
    const day = currentDayNumber(progress, queue);
    return {
      title: `Making Day ${day} feel right`,
      body: "Roamly is checking the pace, timing, and flow before moving on.",
      tone: "running" as const,
      spinning: true
    };
  }

  if (/generating_day/.test(stage)) {
    const day = currentDayNumber(progress, queue);
    return {
      title: `Your days are taking shape`,
      body: `Roamly is creating Day ${day} of ${progress.totalDayCount} around what matters to you.`,
      tone: "running" as const,
      spinning: true
    };
  }

  if (/enriching_transport/.test(stage)) {
    return {
      title: "Connecting the places you’ll go",
      body: "Roamly is adding the travel details that help each day flow into the next.",
      tone: "running" as const,
      spinning: true
    };
  }

  if (/enriching_affiliates/.test(stage)) {
    return {
      title: "Adding the useful details",
      body: "Roamly is bringing together the finishing touches for your itinerary.",
      tone: "running" as const,
      spinning: true
    };
  }

  if (/final|complete|saving|affiliates/.test(stage)) {
    return {
      title: "Putting your trip together",
      body: "Roamly is saving your day-by-day plan so it is ready when you are.",
      tone: "running" as const,
      spinning: true
    };
  }

  return {
    title: "Your journey is taking shape",
    body: "Roamly is creating your itinerary and saving progress as it goes.",
    tone: "running" as const,
    spinning: true
  };
}

function progressFromApi(data: ProgressApiData) {
  return progressFromApiForTrip(data, data?.tripId || "");
}

function customerProgressFailure(status: number, fallback: string) {
  if (status === 401) {
    return "Your session could not be confirmed for this update. Your saved progress is safe; refresh once if updates pause.";
  }
  return fallback;
}

// Retained for Roamly core polling checks.
void progressFromApi;

function blankProgressForTrip(tripId: string, source?: Partial<GenerationProgress> | null): GenerationProgress {
  const totalDayCount = Math.max(1, Number(source?.totalDayCount || 1));
  return {
    tripId,
    status: "queued",
    currentStage: "queued",
    completedDayCount: 0,
    totalDayCount,
    days: [],
    batches: [],
    aiCallCount: 0,
    estimatedAiCostUsd: 0,
    aiInputTokens: 0,
    aiOutputTokens: 0,
    lastErrorCode: null,
    finalValidationErrors: [],
    retryLimit: source?.retryLimit || 4,
    emailNotification: source?.emailNotification,
    startedAt: source?.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };
}

function normalizeProgressForTrip(progress: GenerationProgress | null | undefined, tripId: string) {
  if (!progress) return null;
  if (progress.tripId && progress.tripId !== tripId) return null;
  const totalDayCount = Math.max(1, Number(progress.totalDayCount || 1));
  const completedDayCount = Math.max(0, Math.min(Number(progress.completedDayCount || 0), totalDayCount));
  return {
    ...progress,
    tripId,
    completedDayCount,
    totalDayCount,
    days: progress.days.filter((day) => day.dayNumber >= 1 && day.dayNumber <= totalDayCount),
    batches: progress.batches.filter((batch) =>
      batch.dayNumbers.every((dayNumber) => dayNumber >= 1 && dayNumber <= totalDayCount)
    )
  };
}

function initialProgressForTrip(initialProgress: GenerationProgress, tripId: string) {
  return normalizeProgressForTrip(initialProgress, tripId) || blankProgressForTrip(tripId, initialProgress);
}

function normalizeQueueForTrip(queue: Queued | null | undefined, tripId: string) {
  if (!queue) return null;
  const queueTripId = queue.tripId || queue.job.trip_id;
  if (queueTripId && queueTripId !== tripId) return null;
  return {
    ...queue,
    tripId,
    job: {
      ...queue.job,
      trip_id: tripId
    },
    layers: queue.layers.filter((layer) => !layer.tripId || layer.tripId === tripId)
  };
}

function progressFromApiForTrip(data: ProgressApiData, tripId: string) {
  if (data?.tripId && tripId && data.tripId !== tripId) return null;
  const next = data?.progress;
  const scoped = normalizeProgressForTrip(next, tripId || next?.tripId || "");
  if (!scoped) return null;
  if (data?.status !== "complete") return scoped;

  const totalDayCount = Math.max(
    scoped.totalDayCount || 0,
    data.totalDayCount || 0,
    scoped.completedDayCount || 0,
    data.completedDayCount || 0,
    1
  );

  return {
    ...scoped,
    status: "complete",
    completedDayCount: totalDayCount,
    totalDayCount,
    completedAt: scoped.completedAt || new Date().toISOString()
  };
}

export function StagedGenerationProgress({
  tripId,
  initialProgress,
  emailConfigured,
  maskedEmail,
  backgroundWorkerConfigured,
  destinationLabel = "Your destination",
  dateLabel = "Dates being shaped",
  travelerLabel = "Your travelers",
  apiAuthToken = ""
}: {
  tripId: string;
  initialProgress: GenerationProgress;
  emailConfigured: boolean;
  maskedEmail: string | null;
  backgroundWorkerConfigured: boolean;
  destinationLabel?: string;
  dateLabel?: string;
  travelerLabel?: string;
  apiAuthToken?: string;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(() => initialProgressForTrip(initialProgress, tripId));
  const [queueProgress, setQueued] = useState<Queued | null>(null);
  const [busyRetryId, setBusyRetryId] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const refreshedDayCount = useRef(initialProgress.completedDayCount);
  const unchangedPollCount = useRef(0);
  const lastProgressSignature = useRef("");
  const lastProgressMovementAtRef = useRef(Date.now());
  const terminalRefreshQueued = useRef(false);
  const [lastProgressMovementAt, setLastProgressMovementAt] = useState<number>(Date.now());
  const [staleProgress, setStaleProgress] = useState(false);
  const stopped = isTerminalStatus(progress.status);

  useEffect(() => {
    if (!stopped) return;

    const completedPath = `/trip/${tripId}`;

    // Force a clean completed-trip render instead of leaving the user
    // trapped on the stale ?generating=1 screen.
    if (
      window.location.pathname !== completedPath ||
      window.location.search
    ) {
      window.location.replace(completedPath);
    }
  }, [stopped, tripId]);

  const failedBatches = progress.batches.filter((batch) => batch.status === "failed");
  const canEmail =
    emailConfigured &&
    progress.emailNotification?.email_me_when_ready !== false &&
    Boolean(maskedEmail);

  const applyProgress = useCallback((next: GenerationProgress | null | undefined) => {
    const scoped = normalizeProgressForTrip(next, tripId);
    if (!scoped) return;
    let shouldRefresh = false;
    setProgress((current) => {
      shouldRefresh =
        scoped.completedDayCount !== current.completedDayCount ||
        scoped.status !== current.status ||
        scoped.currentStage !== current.currentStage ||
        isTerminalStatus(scoped.status);
      return scoped;
    });
    if (shouldRefresh && (scoped.completedDayCount !== refreshedDayCount.current || isTerminalStatus(scoped.status))) {
      refreshedDayCount.current = scoped.completedDayCount;
      // Generation page polls the backend.
      // Refresh only after completion so the saved itinerary replaces
      // the progress panel without interrupting active generation.

    }
    if (scoped.status === "complete" && !terminalRefreshQueued.current) {
      terminalRefreshQueued.current = true;
      window.setTimeout(() => router.refresh(), 50);
    }
  }, [router, tripId]);

  const applyQueue = useCallback((next: Queued | null | undefined) => {
    const scoped = normalizeQueueForTrip(next, tripId);
    if (!scoped) return;
    setQueued(scoped);
  }, [tripId]);

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

  const pollProgress = useCallback(async () => {
    if (inFlight.current || stopped) return;
    inFlight.current = true;
    setMessage("");
    try {
      const response = await fetchWithSupabaseAuth(`/api/trips/${tripId}/generation/status`, {
        headers: authHeaders(),
        cache: "no-store"
      });
      const data = (await response.json().catch(() => null)) as ProgressApiData;

      if (data?.tripId && data.tripId !== tripId) {
        setMessage("Progress could not be verified for this trip. Retrying shortly.");
        return;
      }

      const nextProgress = progressFromApiForTrip(data, tripId);
      if (nextProgress) applyProgress(nextProgress);
      const nextQueue = normalizeQueueForTrip(data?.queue, tripId);
      if (nextQueue) applyQueue(nextQueue);

      const completedDays =
        Number(nextProgress?.completedDayCount ?? data?.progress?.completedDayCount ?? 0);
      const totalDays =
        Number(nextProgress?.totalDayCount ?? data?.progress?.totalDayCount ?? 0);

      const terminalValues = [
        data?.status,
        data?.progress?.status,
        data?.queue?.job?.status
      ].map((value) => String(value ?? "").toLowerCase());
      const backendFailed =
        terminalValues.includes("failed") ||
        terminalValues.includes("partially_failed") ||
        terminalValues.includes("cancelled") ||
        terminalValues.includes("error");
      if (backendFailed) {
        applyProgress({
          ...(nextProgress ?? progress),
          tripId,
          status: nextProgress?.status === "partially_failed" ? "partially_failed" : "failed",
          currentStage: "failed",
          completedDayCount: Math.min(completedDays, totalDays || completedDays),
          totalDayCount: totalDays || progress.totalDayCount
        });
        return;
      }

      const backendComplete =
        ["complete", "completed", "generated", "locked"].includes(
          String(data?.status ?? "").toLowerCase()
        ) ||
        ["complete", "completed", "generated", "locked"].includes(
          String(data?.progress?.status ?? "").toLowerCase()
        ) ||
        ["complete", "completed"].includes(
          String(data?.queue?.job?.status ?? "").toLowerCase()
        );

      if (backendComplete) {
        applyProgress({
          ...(nextProgress ?? progress),
          tripId,
          completedDayCount: totalDays > 0 ? totalDays : completedDays,
          totalDayCount: totalDays,
          status: "complete"
        });

        if (!terminalRefreshQueued.current) {
          terminalRefreshQueued.current = true;

          window.setTimeout(() => {
            window.location.replace(`/trip/${tripId}`);
          }, 50);
        }

        return;
      }
      if (response.status === 401) {
        setMessage(customerProgressFailure(response.status, "Progress could not be refreshed. Completed days remain saved."));
      } else if (!response.ok) {
        setMessage(customerProgressFailure(response.status, "Progress could not be refreshed. Completed days remain saved."));
      } else {
        trackPollMovement(nextProgress || data?.progress, nextQueue);
      }
    } finally {
      inFlight.current = false;
    }
  }, [applyProgress, applyQueue, authHeaders, progress, stopped, trackPollMovement, tripId]);

  const wakeGenerationWorker = useCallback(async () => {
    const response = await fetchWithSupabaseAuth(`/api/trips/${tripId}/generation/advance`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ action: "advance" }),
      cache: "no-store"
    });
    const data = (await response.json().catch(() => null)) as ProgressApiData;
    const nextProgress = progressFromApiForTrip(data, tripId);
    if (nextProgress) applyProgress(nextProgress);
    if (data?.queue) applyQueue(data.queue);
    return { response, data };
  }, [applyProgress, applyQueue, authHeaders, tripId]);

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
      const data = (await response.json().catch(() => null)) as ProgressApiData;
      const nextProgress = progressFromApiForTrip(data, tripId);
      if (nextProgress) applyProgress(nextProgress);
      if (data?.queue) applyQueue(data.queue);
      if (!response.ok) setMessage("The failed stage could not be retried. Completed days remain saved.");
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
      const wake = await wakeGenerationWorker();
      if (!wake.response.ok) {
        setMessage("The itinerary could not be retried yet. Your saved progress is still available.");
      }
    } finally {
      setBusyRetryId("");
    }
  }, [failedBatches, progress.retryLimit, retryFailedBatch, wakeGenerationWorker]);

  useEffect(() => {
    const scoped = initialProgressForTrip(initialProgress, tripId);
    inFlight.current = false;
    setProgress(scoped);
    setQueued(null);
    setMessage("");
    refreshedDayCount.current = scoped.completedDayCount;
    unchangedPollCount.current = 0;
    lastProgressSignature.current = "";
    const now = Date.now();
    lastProgressMovementAtRef.current = now;
    setLastProgressMovementAt(now);
    setStaleProgress(false);
    terminalRefreshQueued.current = false;
  }, [initialProgress, tripId]);

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
  const activeSimpleStep =
    progress.status === "complete"
      ? 3
      : /final|complete|saving|affiliates/i.test(progress.currentStage || queueProgress?.currentStage || "")
        ? 2
        : progress.completedDayCount > 0
          ? 1
          : 0;
  const simpleSteps = [
    "Shape your trip",
    `Day ${Math.max(1, Math.min(progress.completedDayCount + 1, progress.totalDayCount || 1))} of ${progress.totalDayCount || 1}`,
    "Finishing touches",
    "Ready to go"
  ];

  return (
    <section
      aria-labelledby="generation-progress-title"
      aria-busy={viewState.tone === "running"}
      className="roamly-no-print mt-4 w-full overflow-hidden rounded-[1.75rem] border border-cloud bg-white p-5 shadow-soft sm:p-7"
    >
      <style>{`
        @keyframes roamlySoftShimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        .roamly-generation-shimmer {
          animation: roamlySoftShimmer 2.8s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .roamly-generation-shimmer {
            animation: none !important;
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
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
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
              {viewState.tone === "failed"
                ? "Itinerary generation failed"
                : viewState.tone === "ready"
                  ? "Itinerary ready"
                  : "Building your itinerary"}
            </p>

            <h2 id="generation-progress-title" className="mt-2 text-2xl font-black leading-tight text-ink sm:text-3xl">
              {viewState.title}
            </h2>

            <p role="status" aria-live="polite" className="mt-2 text-sm font-bold text-slate-500">
              <span className="sr-only">{viewState.title}. </span>{viewState.body}
            </p>

            <div className="mt-4 grid grid-cols-1 gap-2 border-y border-cloud/80 py-3 text-sm sm:grid-cols-3">
              <div className="min-w-0">
                <p className="text-[0.62rem] font-black uppercase tracking-[0.12em] text-slate-400">Destination</p>
                <p className="mt-1 truncate font-bold text-ink" title={destinationLabel}>{destinationLabel}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[0.62rem] font-black uppercase tracking-[0.12em] text-slate-400">When</p>
                <p className="mt-1 truncate font-bold text-ink" title={dateLabel}>{dateLabel}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[0.62rem] font-black uppercase tracking-[0.12em] text-slate-400">Travelers</p>
                <p className="mt-1 truncate font-bold text-ink" title={travelerLabel}>{travelerLabel}</p>
              </div>
            </div>

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

            {failed && progress.finalValidationErrors?.length ? (
              <div className="mt-3 rounded-2xl border border-coral/20 bg-coral/10 px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-coral">A final trip check needs another pass</p>
                <p className="mt-2 text-sm font-bold leading-6 text-coral">
                  Your saved progress is still available. Retry when you’re ready.
                </p>
              </div>
            ) : null}
          </div>
          </div>
        </div>

        {!failed && progress.status !== "complete" ? (
          <div className="relative overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50 via-white to-cyan-50 px-4 py-4 shadow-sm">
            <div
              aria-hidden="true"
              className="roamly-generation-shimmer pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-sky-100/70 to-transparent"
            />
            <div aria-hidden="true" className="relative flex items-center justify-between gap-2 px-1">
              <div className="h-px flex-1 bg-sky-200" />
              <span className="h-2 w-2 rounded-full bg-ocean/70" />
              <div className="h-px flex-1 bg-sky-200" />
              <span className="h-2 w-2 rounded-full bg-ocean/45" />
              <div className="h-px flex-1 bg-sky-200" />
              <span className="h-2 w-2 rounded-full bg-ocean/25" />
              <div className="h-px flex-1 bg-sky-200" />
            </div>
            <p className="mt-3 text-center text-xs font-black uppercase tracking-[0.16em] text-sky-700">
              Your trip is taking shape
            </p>
          </div>
        ) : null}

        {message ? (
          <p role="alert" className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">
            {message}
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-4">
          {simpleSteps.map((label, index) => (
            <div
              key={label}
              aria-current={index === activeSimpleStep ? "step" : undefined}
              className={`rounded-2xl border px-3 py-3 text-sm font-black transition-colors duration-500 motion-reduce:transition-none ${
                index <= activeSimpleStep
                  ? "border-ocean/20 bg-ocean/10 text-ocean"
                  : "border-slate-200 bg-slate-50 text-slate-500"
              }`}
            >
              {label}
            </div>
          ))}
        </div>

        {progress.days.length ? (
          <div className="rounded-2xl border border-cloud/80 bg-[#fbf8ef] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Your trip outline</p>
                <p className="mt-1 text-sm font-bold text-slate-600">Roamly is building the days in order and saving each completed day.</p>
              </div>
              <p className="text-xs font-black text-slate-500">{progress.completedDayCount} of {progress.totalDayCount} days ready</p>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {progress.days.slice(0, 8).map((day) => {
                const dayLabel = day.status === "complete" ? "Ready" : day.status === "failed" ? "Needs attention" : day.status === "generating" || day.status === "validating" ? "Building now" : "Queued";
                const dayTone = day.status === "complete" ? "border-ocean/20 bg-ocean/10 text-ocean" : day.status === "failed" ? "border-coral/20 bg-coral/10 text-coral" : day.status === "generating" || day.status === "validating" ? "border-sky-200 bg-white text-sky-800" : "border-cloud bg-white text-slate-500";
                return (
                  <div key={day.dayNumber} className={`flex min-w-0 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${dayTone}`}>
                    <span className="truncate font-bold">Day {day.dayNumber}{day.date ? ` · ${day.date}` : ""}</span>
                    <span className="shrink-0 text-xs font-black">{dayLabel}</span>
                  </div>
                );
              })}
            </div>
            {progress.days.length > 8 ? <p className="mt-3 text-xs font-bold text-slate-500">{progress.days.length - 8} more days will appear as Roamly reaches them.</p> : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {progress.status === "complete" ? (
            <Link
              href={`/trip/${tripId}`}
              className="inline-flex min-h-11 justify-center rounded-full bg-ocean px-5 py-3 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ocean/25"
            >
              View itinerary
            </Link>
          ) : null}

          {failed ? (
            <button
              type="button"
              onClick={() => void retryGeneration()}
              disabled={Boolean(busyRetryId)}
              className="inline-flex min-h-11 justify-center rounded-full bg-coral px-5 py-3 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-coral/25 disabled:opacity-60"
            >
              {busyRetryId ? "Retrying..." : "Retry"}
            </button>
          ) : null}

          <Link
            href="/dashboard"
            className="inline-flex min-h-11 justify-center rounded-full border border-cloud bg-white px-5 py-3 text-sm font-bold text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ocean/25"
          >
            Back to trips
          </Link>
        </div>
      </div>
    </section>
  );

}
