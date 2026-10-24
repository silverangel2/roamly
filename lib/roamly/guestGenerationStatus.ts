// Real generation status for the guest (signed-out) itinerary page.
//
// This module is deliberately pure and dependency-free: it only reshapes data
// the server already measured. Nothing here invents, simulates, or animates
// progress. When the server cannot measure a time, the lines say so instead
// of showing a made-up countdown.
//
// The server (app/api/trips/guest-itinerary/route.ts) feeds this module only
// the fields below. Internal error codes, error text, model names, costs, and
// tokens never reach this module, so they can never reach the guest page.

export type GuestGenerationPhase =
  | "unknown"
  | "queued"
  | "pack_wait"
  | "outline"
  | "day"
  | "validation"
  | "enrichment"
  | "done"
  | "failed";

export type GuestGenerationProgressDayInput = {
  status?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
};

export type GuestGenerationProgressRunInput = {
  stage?: unknown;
  status?: unknown;
  durationMs?: unknown;
  dayNumbers?: unknown;
};

export type GuestGenerationProgressInput = {
  status?: unknown;
  currentStage?: unknown;
  completedDayCount?: unknown;
  totalDayCount?: unknown;
  days?: GuestGenerationProgressDayInput[];
  stageRuns?: GuestGenerationProgressRunInput[];
  startedAt?: unknown;
} | null;

export type GuestGenerationStatusInput = {
  viewStatus: "building" | "ready" | "failed";
  progress: GuestGenerationProgressInput;
  waitingForPack: boolean;
  failedTimeout: boolean;
  destination: string | null;
  tripStartedAt: string | null;
  nowMs: number;
  maxPackWaitMs: number;
};

export type GuestGenerationStatus = {
  phase: GuestGenerationPhase;
  completedDayCount: number;
  totalDayCount: number;
  waitingForPack: boolean;
  elapsedMs: number | null;
  estimatedRemainingMs: number | null;
  paceMsPerDay: number | null;
  packWaitDeadlineAt: string | null;
  failedTimeout: boolean;
  destination: string | null;
  maxPackWaitMs: number;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asPositiveNumber(value: unknown): number | null {
  const num = typeof value === "number" && Number.isFinite(value) ? value : null;
  return num !== null && num > 0 ? num : null;
}

function parseMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function phaseFromStage(
  stage: string,
  viewStatus: "building" | "ready" | "failed",
  waitingForPack: boolean
): GuestGenerationPhase {
  if (viewStatus === "failed") return "failed";
  if (viewStatus === "ready") return "done";
  if (waitingForPack) return "pack_wait";
  switch (stage) {
    case "queued":
      return "queued";
    case "generating_outline":
    case "validating_input":
      return "outline";
    case "generating_day":
      return "day";
    case "validating_day":
      return "validation";
    case "enriching_transport":
    case "enriching_affiliates":
      return "enrichment";
    case "complete":
    case "partially_failed":
      return "done";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

// Measured per-day durations, from the generation's own records only.
// First choice: finished days' own start-to-finish times. Fallback: finished
// day-batch runs, split across the days they covered. No usable record means
// no pace — never a guessed number.
function measuredDayDurations(progress: NonNullable<GuestGenerationProgressInput>): number[] {
  const fromDays: number[] = [];
  for (const day of Array.isArray(progress.days) ? progress.days : []) {
    if (asText(day.status) !== "complete") continue;
    const start = parseMs(day.startedAt);
    const end = parseMs(day.completedAt);
    if (start !== null && end !== null && end > start) fromDays.push(end - start);
  }
  if (fromDays.length) return fromDays;
  const fromRuns: number[] = [];
  for (const run of Array.isArray(progress.stageRuns) ? progress.stageRuns : []) {
    if (asText(run.stage) !== "day_batch" || asText(run.status) !== "success") continue;
    const duration = asPositiveNumber(run.durationMs);
    if (!duration) continue;
    const dayCount = Array.isArray(run.dayNumbers) && run.dayNumbers.length > 0 ? run.dayNumbers.length : 1;
    fromRuns.push(duration / dayCount);
  }
  return fromRuns;
}

export function buildGuestGenerationStatus(input: GuestGenerationStatusInput): GuestGenerationStatus {
  const progress = input.progress;
  const totalDayCount = Math.max(
    1,
    Math.floor(asPositiveNumber(progress?.totalDayCount) ?? 1)
  );
  const completedDayCount = Math.max(
    0,
    Math.min(Math.floor(asPositiveNumber(progress?.completedDayCount) ?? 0), totalDayCount)
  );
  const stage = asText(progress?.currentStage);
  const phase = progress
    ? phaseFromStage(stage, input.viewStatus, input.waitingForPack)
    : input.viewStatus === "failed"
      ? "failed"
      : input.viewStatus === "ready"
        ? "done"
        : "unknown";

  const startedAtMs = parseMs(progress?.startedAt) ?? parseMs(input.tripStartedAt);
  const elapsedMs = startedAtMs !== null && input.nowMs >= startedAtMs ? input.nowMs - startedAtMs : null;

  const durations = progress ? measuredDayDurations(progress) : [];
  const paceMsPerDay = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
    : null;
  const remainingDays = totalDayCount - completedDayCount;
  const estimatedRemainingMs =
    paceMsPerDay !== null && remainingDays > 0 && phase !== "pack_wait" && phase !== "unknown" && phase !== "queued"
      ? paceMsPerDay * remainingDays
      : null;

  const packWaitDeadlineAt =
    input.waitingForPack && startedAtMs !== null
      ? new Date(startedAtMs + Math.max(1, input.maxPackWaitMs)).toISOString()
      : null;

  return {
    phase,
    completedDayCount,
    totalDayCount,
    waitingForPack: input.waitingForPack,
    elapsedMs,
    estimatedRemainingMs,
    paceMsPerDay,
    packWaitDeadlineAt,
    failedTimeout: input.failedTimeout,
    destination: typeof input.destination === "string" && input.destination.trim()
      ? input.destination.trim().slice(0, 160)
      : null,
    maxPackWaitMs: Math.max(1, input.maxPackWaitMs)
  };
}

function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `about ${hours} hour${hours === 1 ? "" : "s"}${rest ? ` ${rest} minute${rest === 1 ? "" : "s"}` : ""}`;
}

function formatCapHours(ms: number): string {
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export type GuestGenerationStatusLines = {
  headline: string;
  detail: string | null;
  estimate: string | null;
};

// Plain words for one status. `deadlineLabel` is a clock time the caller
// formats in the traveler's locale (e.g. "2:35 PM"); when it is null the
// pack-wait detail falls back to the outer-bound duration, never a fake time.
export function guestGenerationStatusLines(
  status: GuestGenerationStatus,
  deadlineLabel: string | null
): GuestGenerationStatusLines {
  const { completedDayCount, totalDayCount } = status;
  const dayCount = `Day ${completedDayCount} of ${totalDayCount} done.`;
  const nextDay = Math.min(completedDayCount + 1, totalDayCount);
  const remainingEstimate =
    status.estimatedRemainingMs !== null
      ? `${formatMinutes(status.estimatedRemainingMs)} left, from your trip's own pace.`
      : null;

  switch (status.phase) {
    case "unknown":
      return {
        headline: "Roamly is building your free itinerary. Completed days appear here as they are ready.",
        detail: null,
        estimate: null
      };
    case "queued":
      return {
        headline: "Your trip is in line to be built.",
        detail: "No days are done yet.",
        estimate: null
      };
    case "pack_wait": {
      const destination = status.destination || "this destination";
      return {
        headline: `Waiting for ${destination} map data.`,
        detail: deadlineLabel
          ? `This step has no fixed time. If the map data is still not ready by ${deadlineLabel}, Roamly stops waiting and tells you.`
          : `This step has no fixed time. Roamly stops waiting after ${formatCapHours(status.maxPackWaitMs)} from the start and tells you.`,
        estimate:
          status.elapsedMs !== null ? `Waiting ${formatMinutes(status.elapsedMs)} so far.` : null
      };
    }
    case "outline":
      return {
        headline: "Drawing up the plan for your trip.",
        detail: completedDayCount > 0 ? dayCount : "No days are done yet.",
        estimate: remainingEstimate
      };
    case "day":
      return {
        headline: `Building day ${nextDay} of ${totalDayCount}.`,
        detail: dayCount,
        estimate: remainingEstimate ?? "No time estimate yet — the first day has not finished."
      };
    case "validation":
      return {
        headline: `Checking day ${nextDay} of ${totalDayCount}.`,
        detail: dayCount,
        estimate: remainingEstimate ?? "No time estimate yet — the first day has not finished."
      };
    case "enrichment":
      return {
        headline: "Adding the finishing touches to your trip.",
        detail: dayCount,
        estimate: remainingEstimate
      };
    case "done":
      return { headline: "Your free itinerary is ready.", detail: null, estimate: null };
    case "failed":
      return {
        headline: "Roamly could not finish this free itinerary.",
        detail: status.failedTimeout
          ? "It waited the full time for map data. Try again later, when the destination's map data is ready."
          : null,
        estimate: null
      };
  }
}
