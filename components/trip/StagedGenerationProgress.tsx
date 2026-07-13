"use client";

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

type GenerationProgress = {
  status: string;
  currentStage: string;
  completedDayCount: number;
  totalDayCount: number;
  days: DayProgress[];
  batches: Array<{
    id: string;
    dayNumbers: number[];
    status: DayProgress["status"];
    attemptCount: number;
    lastError: string | null;
  }>;
  aiCallCount: number;
  estimatedAiCostUsd: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  lastErrorCode: string | null;
  retryLimit: number;
  emailNotification?: {
    email_me_when_ready: boolean;
    delivery_status?: string | null;
    completion_email_sent_at?: string | null;
    failure_email_sent_at?: string | null;
    last_email_error?: string | null;
  };
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

function stageLabel(stage: string) {
  if (stage === "generating_outline") return "Creating trip outline";
  if (stage === "generating_day") return "Building itinerary batches";
  if (stage === "validating_day") return "Checking day structure";
  if (stage === "enriching_transport") return "Adding travel times";
  if (stage === "enriching_affiliates") return "Adding booking options";
  if (stage === "complete") return "Complete";
  if (stage === "partially_failed") return "Needs attention";
  if (stage === "failed") return "Failed";
  return "Preparing itinerary";
}

function statusClass(status: DayProgress["status"]) {
  if (status === "complete") return "border-ocean/20 bg-ocean/10 text-ocean";
  if (status === "generating" || status === "validating") return "border-sun/30 bg-sun/20 text-amber-800";
  if (status === "failed") return "border-coral/25 bg-coral/10 text-coral";
  return "border-slate-200 bg-white text-slate-500";
}

export function StagedGenerationProgress({
  tripId,
  initialProgress
}: {
  tripId: string;
  initialProgress: GenerationProgress;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const stopped = progress.status === "complete" || progress.status === "failed" || progress.status === "partially_failed";
  const emailStatus = progress.emailNotification;
  const inFlight = useRef(false);
  const percent = useMemo(() => {
    if (!progress.totalDayCount) return 0;
    return Math.round((progress.completedDayCount / progress.totalDayCount) * 100);
  }, [progress.completedDayCount, progress.totalDayCount]);

  const advance = useCallback(async (action = "advance", batchId = "") => {
    if (inFlight.current || (stopped && action !== "retry_batch")) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetchWithSupabaseAuth(`/api/trips/${tripId}/generation/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batchId ? { action, batchId } : { action })
      });
      const data = await response.json().catch(() => null);
      if (data?.progress) setProgress(data.progress);
      if (!response.ok) setMessage(data?.message || "This generation step could not finish. Completed progress was preserved.");
      router.refresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [router, stopped, tripId]);

  useEffect(() => {
    setProgress(initialProgress);
  }, [initialProgress]);

  useEffect(() => {
    if (stopped) return;
    const timer = window.setTimeout(() => {
      void advance();
    }, progress.completedDayCount > 0 ? 3500 : 1200);
    return () => window.clearTimeout(timer);
  }, [advance, progress.status, progress.currentStage, progress.completedDayCount, stopped]);

  return (
    <section className="roamly-no-print mt-6 rounded-[1.15rem] border border-ocean/20 bg-white p-4 shadow-[0_14px_36px_rgba(16,32,51,0.07)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{stageLabel(progress.currentStage)}</p>
          <h2 className="mt-1 text-xl font-black text-ink">
            {progress.completedDayCount} of {progress.totalDayCount} days ready
          </h2>
          <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-slate-600">
            We’re building your itinerary. You can leave this page—we’ll email you when it’s ready.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void advance()}
          disabled={busy || stopped}
          className="rounded-full bg-ink px-4 py-2 text-xs font-black text-white disabled:opacity-50"
        >
          {busy ? "Working..." : stopped ? "Paused" : "Continue"}
        </button>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-ocean transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1.5 text-xs font-black text-ocean">
          Email me when ready {emailStatus?.email_me_when_ready === false ? "off" : "on"}
          {emailStatus?.delivery_status ? ` · ${emailStatus.delivery_status}` : ""}
        </span>
        {progress.days.map((day) => (
          <span key={day.dayNumber} className={`rounded-full border px-3 py-1.5 text-xs font-black ${statusClass(day.status)}`}>
            Day {day.dayNumber} {day.status}
          </span>
        ))}
      </div>
      {message ? <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{message}</p> : null}
      {progress.status === "partially_failed" ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-bold leading-6 text-slate-600">
            One batch needs attention. Completed days are preserved.
          </p>
          {progress.batches.filter((batch) => batch.status === "failed").map((batch) => (
            batch.attemptCount < progress.retryLimit ? (
              <button
                key={batch.id}
                type="button"
                onClick={() => void advance("retry_batch", batch.id)}
                disabled={busy}
                className="rounded-full border border-coral/25 bg-coral/10 px-4 py-2 text-xs font-black text-coral disabled:opacity-50"
              >
                Retry Days {batch.dayNumbers.join(", ")}
              </button>
            ) : (
              <span
                key={batch.id}
                className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black text-slate-500"
              >
                Retry limit reached for Days {batch.dayNumbers.join(", ")}
              </span>
            )
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-[0.7rem] font-black uppercase tracking-[0.12em] text-slate-400">
        AI calls {progress.aiCallCount} · est. ${progress.estimatedAiCostUsd.toFixed(4)}
      </p>
    </section>
  );
}
