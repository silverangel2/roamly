"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type QueueProgress = {
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
  queue?: QueueProgress | null;
  message?: string;
  error?: string;
} | null;

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

function approximateProgress(progress: GenerationProgress) {
  if (progress.status === "complete") return 100;
  const totalDays = Math.max(1, progress.totalDayCount || progress.days.length || 1);
  const completedDays = Math.min(totalDays, Math.max(0, progress.completedDayCount || 0));
  const activeBatch = progress.batches.find((batch) => batch.status === "generating" || batch.status === "validating");
  const activeDayCredit = activeBatch ? Math.min(activeBatch.dayNumbers.length, totalDays - completedDays) * 0.35 : 0;
  const dayRatio = Math.min(1, (completedDays + activeDayCredit) / totalDays);

  let estimate = 5;
  if (progress.currentStage === "generating_outline" || progress.status === "queued") estimate = 12;
  if (progress.currentStage === "generating_day") estimate = 18 + dayRatio * 60;
  if (progress.currentStage === "validating_day") estimate = 82;
  if (progress.currentStage === "enriching_transport") estimate = 86;
  if (progress.currentStage === "enriching_affiliates") estimate = 92;
  if (progress.status === "partially_failed" || progress.status === "failed") estimate = Math.max(estimate, 18 + dayRatio * 60);
  if (completedDays >= totalDays && progress.currentStage === "generating_day") estimate = 84;

  return Math.max(1, Math.min(99, Math.round(estimate)));
}

function queueProgressPercent(queue: QueueProgress | null) {
  if (!queue) return null;
  if (queue.job.status === "completed") return 100;
  const total = Math.max(1, queue.totalLayerCount || queue.layers.length || 1);
  const completed = Math.min(total, Math.max(0, queue.completedLayerCount || 0));
  const runningCredit = queue.layers.some((layer) => layer.status === "running") ? 0.35 : 0;
  return Math.max(1, Math.min(99, Math.round(((completed + runningCredit) / total) * 100)));
}

function statusClass(status: DayProgress["status"]) {
  if (status === "complete") return "border-ocean/20 bg-ocean/10 text-ocean";
  if (status === "generating" || status === "validating") return "border-sun/30 bg-sun/20 text-amber-800";
  if (status === "failed") return "border-coral/25 bg-coral/10 text-coral";
  return "border-slate-200 bg-white text-slate-500";
}

function dayStatusLabel(day: DayProgress) {
  if (day.status === "complete") return "ready";
  if (day.status === "generating") return "building";
  if (day.status === "validating") return "checking";
  if (day.status === "failed") return "failed";
  return "waiting";
}

function visibleStatus(progress: GenerationProgress) {
  if (progress.status === "complete") return "Your itinerary is ready";
  if (progress.status === "failed" || progress.status === "partially_failed") return "Generation needs attention";
  return "Your itinerary is being built.";
}

function queueVisibleStatus(queue: QueueProgress | null, progress: GenerationProgress) {
  if (!queue) return visibleStatus(progress);
  if (queue.job.status === "completed" || progress.status === "complete") return "Your itinerary is ready";
  if (queue.job.status === "failed" || progress.status === "failed" || progress.status === "partially_failed") return "Generation needs attention";
  if (queue.job.status === "queued") return "Your trip is queued.";
  return "Your itinerary is being built.";
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
  const [queueProgress, setQueueProgress] = useState<QueueProgress | null>(null);
  const [busyRetryId, setBusyRetryId] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const refreshedDayCount = useRef(initialProgress.completedDayCount);
  const unchangedPollCount = useRef(0);
  const lastProgressSignature = useRef("");
  const stopped = isTerminalStatus(progress.status);
  const failedBatches = progress.batches.filter((batch) => batch.status === "failed");
  const canEmail =
    emailConfigured &&
    progress.emailNotification?.email_me_when_ready !== false &&
    Boolean(maskedEmail);
  const percent = useMemo(() => queueProgressPercent(queueProgress) ?? approximateProgress(progress), [progress, queueProgress]);
  const completedDaysLabel = `${progress.completedDayCount} of ${progress.totalDayCount || progress.days.length || 0} days ready`;
  const completedLayerLabel = queueProgress
    ? `${queueProgress.completedLayerCount} of ${queueProgress.totalLayerCount} saved stages complete`
    : completedDaysLabel;

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

  const applyQueue = useCallback((next: QueueProgress | null | undefined) => {
    if (!next) return;
    setQueueProgress(next);
  }, []);

  const authHeaders = useCallback((contentType = false) => {
    const headers: Record<string, string> = {};
    if (contentType) headers["content-type"] = "application/json";
    if (apiAuthToken) headers["x-roamly-session-token"] = apiAuthToken;
    return headers;
  }, [apiAuthToken]);

  const trackPollMovement = useCallback((next: GenerationProgress | null | undefined, queue: QueueProgress | null | undefined) => {
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
    }

    return unchangedPollCount.current >= 2 && !isTerminalStatus(next?.status || "") && queue?.job.status !== "completed";
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

  return (
    <section
      role="status"
      aria-live="polite"
      className="roamly-no-print relative left-1/2 mt-4 w-[min(1180px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-[1.75rem] border border-cloud bg-white p-5 shadow-soft sm:p-7"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
              Building your itinerary
            </p>

            <h2 className="mt-2 text-2xl font-black leading-tight text-ink sm:text-3xl">
              {progress.status === "complete"
                ? "Your trip is ready"
                : progress.status === "failed" ||
                    progress.status === "partially_failed"
                  ? "Generation needs attention"
                  : queueVisibleStatus(queueProgress, progress)}
            </h2>

            <p className="mt-2 text-sm font-bold text-slate-500">
              {progress.status === "complete"
                ? "Open your finished itinerary."
                : progress.status === "failed" ||
                    progress.status === "partially_failed"
                  ? "Your completed work is saved. Retry the failed part."
                  : canEmail
                    ? `You can leave this page. We’ll email ${maskedEmail} when it’s ready.`
                    : backgroundWorkerConfigured
                      ? "You can leave this page while Roamly continues."
                      : "Keep this page open while Roamly finishes."}
            </p>
          </div>

          <div className="flex shrink-0 items-end gap-3 md:flex-col md:items-end">
            <span className="text-4xl font-black text-ink">
              {percent}%
            </span>

            <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
              {completedLayerLabel}
            </span>
          </div>
        </div>

        <div className="relative py-4">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-ocean transition-[width] duration-[1800ms] ease-out"
              style={{ width: `${Math.max(percent, 3)}%` }}
            />
          </div>

          <div
            aria-hidden="true"
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-[1800ms] ease-out"
            style={{
              left: `clamp(14px, ${Math.max(percent, 3)}%, calc(100% - 14px))`
            }}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ocean shadow-[0_6px_18px_rgba(15,118,150,0.24)] ring-1 ring-ocean/15">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 rotate-90"
                fill="currentColor"
              >
                <path d="M21.8 15.6 14 12.7V7.2c0-1.7-.8-4.7-2-4.7s-2 3-2 4.7v5.5l-7.8 2.9v2l7.8-1.2v3.4l-2.2 1.5V23l4.2-.8 4.2.8v-1.7L14 19.8v-3.4l7.8 1.2v-2Z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          {[
            {
              label: "Trip understood",
              active: percent < 25,
              complete: percent >= 25
            },
            {
              label: "Creating your days",
              active: percent >= 25 && percent < 70,
              complete: percent >= 70
            },
            {
              label: "Checking your plan",
              active: percent >= 70 && percent < 90,
              complete: percent >= 90
            },
            {
              label: "Finalizing",
              active:
                percent >= 90 &&
                progress.status !== "complete",
              complete:
                progress.status === "complete"
            }
          ].map((phase) => (
            <div
              key={phase.label}
              className={`rounded-2xl border px-4 py-3 text-sm font-black ${
                phase.complete
                  ? "border-ocean/20 bg-ocean/10 text-ocean"
                  : phase.active
                    ? "border-sun/30 bg-sun/20 text-amber-800"
                    : "border-slate-200 bg-slate-50 text-slate-400"
              }`}
            >
              <span className="mr-2">
                {phase.complete
                  ? "✓"
                  : phase.active
                    ? "●"
                    : "○"}
              </span>
              {phase.label}
            </div>
          ))}
        </div>

        {progress.completedDayCount > 0 ? (
          <div className="flex flex-wrap gap-2">
            {progress.days
              .filter(
                (day) =>
                  day.status === "complete" ||
                  day.status === "failed"
              )
              .map((day) => (
                <span
                  key={day.dayNumber}
                  className={`rounded-full border px-3 py-1.5 text-xs font-black ${statusClass(
                    day.status
                  )}`}
                >
                  Day {day.dayNumber} {dayStatusLabel(day)}
                </span>
              ))}
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
              className="inline-flex justify-center rounded-full bg-ink px-5 py-3 text-sm font-black text-white"
            >
              View itinerary
            </Link>
          ) : progress.completedDayCount > 0 ? (
            <a
              href="#day-by-day"
              className="inline-flex justify-center rounded-full bg-ink px-5 py-3 text-sm font-black text-white"
            >
              View ready days
            </a>
          ) : null}

          {(progress.status === "failed" ||
            progress.status === "partially_failed") &&
            failedBatches.map((batch) =>
              batch.attemptCount < progress.retryLimit ? (
                <button
                  key={batch.id}
                  type="button"
                  onClick={() =>
                    void retryFailedBatch(batch.id)
                  }
                  disabled={busyRetryId === batch.id}
                  className="inline-flex justify-center rounded-full bg-coral px-5 py-3 text-sm font-black text-white disabled:opacity-60"
                >
                  {busyRetryId === batch.id
                    ? "Retrying…"
                    : "Retry generation"}
                </button>
              ) : null
            )}

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
