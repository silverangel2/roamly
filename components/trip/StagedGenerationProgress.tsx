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

const SAVED_QUEUE_MESSAGE = "Your trip is safely saved. Roamly will continue building it even if you close this page.";

const QUEUE_STAGE_LABELS: Record<string, string> = {
  queued: "Queued",
  traveler_profile: "Learning your preferences",
  trip_requirements: "Understanding your trip",
  destination_research: "Researching your destination",
  transport_search: "Comparing transportation",
  transport_decision: "Choosing the best way to travel",
  destination_structure: "Structuring your destination",
  accommodation_area_selection: "Finding the best area to stay",
  accommodation_search: "Comparing accommodations",
  accommodation_decision: "Choosing where to stay",
  daily_itinerary_generation: "Building your itinerary",
  itinerary_logistics_validation: "Checking travel times",
  budget_validation: "Checking your budget",
  schedule_validation: "Checking your schedule",
  backup_plan_generation: "Creating backup plans",
  final_assembly: "Finalizing your trip",
  completion_notification: "Completed",
  completed: "Completed"
};

function isTerminalStatus(status: string) {
  return status === "complete" || status === "failed" || status === "partially_failed";
}

function dayRangeLabel(dayNumbers: number[]) {
  const sorted = [...dayNumbers].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first) return "days";
  return first === last ? `Day ${first}` : `Day ${first}–${last}`;
}

function currentBatch(progress: GenerationProgress) {
  return (
    progress.batches.find((batch) => batch.status === "generating" || batch.status === "validating") ||
    progress.batches.find((batch) => batch.status === "queued") ||
    progress.batches.find((batch) => batch.status === "failed") ||
    null
  );
}

function stageLabel(progress: GenerationProgress) {
  if (progress.status === "complete" || progress.currentStage === "complete") return "Ready";
  if (progress.status === "failed" || progress.currentStage === "failed") return "Final checks";
  if (progress.status === "partially_failed" || progress.currentStage === "partially_failed") return "Final checks";
  if (progress.status === "queued" || progress.currentStage === "queued" || progress.currentStage === "validating_input") {
    return "Preparing your trip";
  }
  if (progress.currentStage === "generating_outline") return "Creating the trip outline";
  if (progress.currentStage === "enriching_transport") return "Adding travel times";
  if (progress.currentStage === "enriching_affiliates") return "Adding booking options";
  if (progress.currentStage === "validating_day") return "Final checks";
  if (progress.currentStage === "generating_day") {
    if (progress.totalDayCount > 0 && progress.completedDayCount >= progress.totalDayCount) return "Final checks";
    const batch = currentBatch(progress);
    return batch ? `Building ${dayRangeLabel(batch.dayNumbers)}` : "Final checks";
  }
  return "Preparing your trip";
}

function queueStageLabel(queue: QueueProgress | null) {
  if (!queue) return "";
  if (queue.job.status === "queued") return QUEUE_STAGE_LABELS.queued;
  if (queue.job.status === "completed") return QUEUE_STAGE_LABELS.completed;
  return QUEUE_STAGE_LABELS[queue.currentStage] || queue.currentStageLabel || "Preparing your trip";
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

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
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
  const currentStage = useMemo(() => queueStageLabel(queueProgress) || stageLabel(progress), [progress, queueProgress]);
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
      className="roamly-no-print mt-4 w-full overflow-visible rounded-[1.1rem] border border-ocean/20 bg-[#fffdf8] p-4 shadow-[0_16px_44px_rgba(16,32,51,0.08)] sm:mt-6 sm:p-6"
    >
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{currentStage}</p>
          <h2 className="mt-2 text-2xl font-black leading-tight text-ink sm:text-3xl">{queueVisibleStatus(queueProgress, progress)}</h2>
          {progress.status === "complete" ? (
            <p className="mt-3 max-w-2xl text-base font-black leading-7 text-slate-700">
              The full itinerary is ready to view.
            </p>
          ) : progress.status === "failed" || progress.status === "partially_failed" ? (
            <p className="mt-3 max-w-2xl text-base font-black leading-7 text-slate-700">
              Completed days are still saved. Retry only the failed stage when a retry is available.
            </p>
          ) : canEmail ? (
            <p className="mt-3 max-w-2xl text-base font-black leading-7 text-slate-700">
              You can stay on this page or leave. We’ll email you when it’s ready.
            </p>
          ) : (
            <p className="mt-3 max-w-2xl text-base font-black leading-7 text-slate-700">
              {SAVED_QUEUE_MESSAGE}
            </p>
          )}

          {progress.status !== "complete" && progress.status !== "failed" && progress.status !== "partially_failed" ? (
            <div className="mt-4 rounded-2xl border border-ocean/20 bg-ocean/10 px-4 py-3 text-sm font-black leading-6 text-ocean">
              {canEmail ? (
                <>
                  <p>We’ll email you when the full itinerary is ready.</p>
                  <p className="mt-1 text-ocean/80">We’ll send it to {maskedEmail}</p>
                </>
              ) : (
                <p>{SAVED_QUEUE_MESSAGE}</p>
              )}
              {backgroundWorkerConfigured ? (
                <p className="mt-2 text-ocean/80">You do not need to keep this tab open.</p>
              ) : (
                <p className="mt-2 text-ocean/80">Keep this tab open for automatic progress updates.</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 rounded-2xl border border-[#eee5d7] bg-white/75 p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Approx. progress</p>
              <p className="mt-1 text-3xl font-black text-ink">{percent}%</p>
            </div>
            <p className="text-right text-sm font-black text-ocean">{completedLayerLabel}</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-ocean transition-all" style={{ width: `${percent}%` }} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Current stage</dt>
              <dd className="mt-1 font-black text-ink">{currentStage}</dd>
            </div>
            <div>
              <dt className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Last updated</dt>
              <dd className="mt-1 font-black text-ink">{formatUpdatedAt(progress.updatedAt)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Email me when ready</dt>
              <dd className="mt-1 font-black text-ink">
                {canEmail ? progress.emailNotification?.delivery_status || progress.emailNotification?.completion_email_status || "On" : "Unavailable"}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {progress.completedDayCount > 0 ? (
        <p className="mt-4 rounded-2xl border border-ocean/20 bg-white px-4 py-3 text-sm font-black text-ocean">
          {completedDaysLabel}. You can view ready days now while the rest continues.
        </p>
      ) : null}

      {queueProgress ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Saved stages</p>
            <p className="text-sm font-black text-ocean">{completedLayerLabel}</p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {queueProgress.layers.map((layer) => (
              <div
                key={layer.id}
                className={`rounded-xl border px-3 py-2 text-sm font-black ${
                  layer.status === "completed" || layer.status === "skipped"
                    ? "border-ocean/20 bg-ocean/10 text-ocean"
                    : layer.status === "running"
                      ? "border-sun/30 bg-sun/20 text-amber-800"
                      : layer.status === "failed" || layer.status === "invalidated"
                        ? "border-coral/25 bg-coral/10 text-coral"
                        : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                <span>{QUEUE_STAGE_LABELS[layer.layerType] || layer.label}</span>
                <span className="ml-2 text-xs uppercase opacity-70">{layer.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {progress.days.map((day) => (
          <span key={day.dayNumber} className={`rounded-full border px-3 py-1.5 text-xs font-black ${statusClass(day.status)}`}>
            Day {day.dayNumber} {dayStatusLabel(day)}
          </span>
        ))}
      </div>

      {message ? <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{message}</p> : null}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {progress.status === "complete" ? (
          <Link href={`/trip/${tripId}`} className="inline-flex justify-center rounded-full bg-ink px-5 py-3 text-sm font-black text-white">
            View itinerary
          </Link>
        ) : progress.completedDayCount > 0 ? (
          <a href="#day-by-day" className="inline-flex justify-center rounded-full bg-ink px-5 py-3 text-sm font-black text-white">
            View ready days
          </a>
        ) : null}
        <Link href="/dashboard" className="inline-flex justify-center rounded-full border border-cloud bg-white px-5 py-3 text-sm font-black text-ink">
          Back to trips
        </Link>
        {(progress.status === "failed" || progress.status === "partially_failed") &&
          failedBatches.map((batch) =>
            batch.attemptCount < progress.retryLimit ? (
              <button
                key={batch.id}
                type="button"
                onClick={() => void retryFailedBatch(batch.id)}
                disabled={busyRetryId === batch.id}
                className="inline-flex justify-center rounded-full border border-coral/25 bg-coral/10 px-5 py-3 text-sm font-black text-coral disabled:opacity-60"
              >
                {busyRetryId === batch.id ? "Retrying failed stage..." : `Retry failed stage: ${dayRangeLabel(batch.dayNumbers)}`}
              </button>
            ) : null
          )}
      </div>

      {progress.status === "failed" && progress.finalValidationErrors?.length ? (
        <p className="mt-4 text-sm font-bold leading-6 text-slate-600">
          Final checks found issues in the generated itinerary. Ready days remain saved.
        </p>
      ) : null}
    </section>
  );
}
