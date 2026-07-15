type MetadataProgress = {
  status?: string | null;
  completedDayCount?: number | null;
  totalDayCount?: number | null;
  percent?: number | null;
  [key: string]: unknown;
};

export type StagedGenerationStatusJobRow = {
  status?: string | null;
  error_message?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
};

export type StagedGenerationStatusLayerRow = {
  status?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
};

function normalizedStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isCompletedStatus(value: unknown) {
  return ["complete", "completed", "succeeded", "success", "skipped"].includes(
    normalizedStatus(value)
  );
}

function isFailedStatus(value: unknown) {
  return ["failed", "error", "timeout", "cancelled"].includes(normalizedStatus(value));
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

export function deriveTripGenerationStatus({
  tripStatus,
  itineraryStatus,
  metadataProgress,
  latestJob,
  layers,
  queueProgress
}: {
  tripStatus?: string | null;
  itineraryStatus?: string | null;
  metadataProgress: MetadataProgress;
  latestJob?: StagedGenerationStatusJobRow | null;
  layers: StagedGenerationStatusLayerRow[];
  queueProgress?: Record<string, unknown> | null;
}) {
  const queueTotal = positiveInteger(queueProgress?.totalLayerCount, 0);
  const queueCompleted = positiveInteger(queueProgress?.completedLayerCount, 0);
  const metadataTotal = positiveInteger(metadataProgress.totalDayCount, 1);
  const metadataCompleted = positiveInteger(metadataProgress.completedDayCount, 0);
  const totalLayerCount = layers.length || queueTotal || Math.max(metadataTotal, 1);
  const completedLayerCount = layers.length
    ? layers.filter((layer) => isCompletedStatus(layer.status)).length
    : queueCompleted || metadataCompleted;

  const tripAlreadyGenerated =
    normalizedStatus(tripStatus) === "generated" ||
    normalizedStatus(itineraryStatus) === "generated" ||
    normalizedStatus(itineraryStatus) === "locked";

  const jobMarkedComplete =
    isCompletedStatus(latestJob?.status) ||
    latestJob?.error_message === "STAGED_GENERATION_COMPLETED";
  const layersMarkedComplete =
    layers.length > 0 && layers.every((layer) => isCompletedStatus(layer.status));
  const countsMarkedComplete =
    totalLayerCount > 0 &&
    completedLayerCount >= totalLayerCount &&
    (layers.length > 0 || queueTotal > 0);

  const isComplete =
    tripAlreadyGenerated || jobMarkedComplete || layersMarkedComplete || countsMarkedComplete;
  const isFailed =
    !isComplete &&
    (isFailedStatus(latestJob?.status) ||
      layers.some((layer) => isFailedStatus(layer.status)) ||
      isFailedStatus(metadataProgress.status));

  const progressStatus = isComplete
    ? "complete"
    : isFailed
      ? "failed"
      : metadataProgress.status === "complete"
        ? "generating_day"
        : String(metadataProgress.status || "queued");

  const percent = isComplete
    ? 100
    : Math.max(
        0,
        Math.min(99, Math.round((completedLayerCount / Math.max(totalLayerCount, 1)) * 100))
      );

  return {
    isComplete,
    isFailed,
    status: isComplete ? "generated" : tripStatus || "draft",
    itineraryStatus: isComplete ? "generated" : itineraryStatus || "draft",
    progressStatus,
    completedLayerCount,
    totalLayerCount,
    percent
  };
}
