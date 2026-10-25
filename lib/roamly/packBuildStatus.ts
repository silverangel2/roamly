// Destination pack-build visibility for the generation-status path
// (Roamly incident 2026-10-25, stream 2).
//
// This module is pure and dependency-free: it only reshapes pack rows the
// server already read. It never invents a pack state — every state below
// is a direct reading of an existing row, and the absence of any row is
// reported plainly as "not_built" instead of being dressed up as
// progress. The guest route reads the rows read-only (no enqueue, no
// build kick: readServingPack would enqueue a build as a side effect,
// which a status read must never do); a read failure degrades to
// "unknown", never to a guessed state.

export type PackBuildState = "ready" | "building" | "failed" | "not_built" | "unknown";

export type PackBuildReadyVersionInput = {
  packVersionId?: unknown;
  builtAt?: unknown;
  candidateCount?: unknown;
} | null;

export type PackBuildJobInput = {
  status?: unknown;
  requestedAt?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  error?: unknown;
} | null;

export type PackBuildStatus = {
  state: PackBuildState;
  destinationId: string | null;
  packVersionId: string | null;
  builtAt: string | null;
  candidateCount: number | null;
  buildRequestedAt: string | null;
  buildStartedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

export type DerivePackBuildStatusInput = {
  destinationId?: unknown;
  readyVersion?: PackBuildReadyVersionInput;
  buildJobs?: PackBuildJobInput[] | null;
  readFailed?: boolean;
};

function asText(value: unknown, max = 240): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, max);
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function asTime(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function latestJob(jobs: PackBuildJobInput[]): PackBuildJobInput | null {
  let best: PackBuildJobInput | null = null;
  let bestTime = -Infinity;
  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;
    const time = asTime(job.requestedAt) ?? asTime(job.startedAt) ?? asTime(job.finishedAt) ?? 0;
    if (time >= bestTime) {
      best = job;
      bestTime = time;
    }
  }
  return best;
}

export function derivePackBuildStatus(input: DerivePackBuildStatusInput): PackBuildStatus {
  const destinationId = asText(input.destinationId, 160);
  const base: Omit<PackBuildStatus, "state"> = {
    destinationId,
    packVersionId: null,
    builtAt: null,
    candidateCount: null,
    buildRequestedAt: null,
    buildStartedAt: null,
    lastError: null,
    lastErrorAt: null
  };
  if (input.readFailed) return { ...base, state: "unknown" };

  const ready = input.readyVersion;
  const readyVersionId = ready ? asText(ready.packVersionId, 160) : null;
  if (ready && readyVersionId) {
    return {
      ...base,
      state: "ready",
      packVersionId: readyVersionId,
      builtAt: asText(ready.builtAt),
      candidateCount: asCount(ready.candidateCount)
    };
  }

  const jobs = Array.isArray(input.buildJobs) ? input.buildJobs : [];
  const live = jobs.find(
    (job) => job && (job.status === "queued" || job.status === "building")
  );
  if (live) {
    return {
      ...base,
      state: "building",
      buildRequestedAt: asText(live.requestedAt),
      buildStartedAt: asText(live.startedAt)
    };
  }
  const failed = latestJob(jobs.filter((job) => job && job.status === "failed"));
  if (failed) {
    return {
      ...base,
      state: "failed",
      buildRequestedAt: asText(failed.requestedAt),
      buildStartedAt: asText(failed.startedAt),
      lastError: asText(failed.error),
      lastErrorAt: asText(failed.finishedAt)
    };
  }
  // No ready version, no live build, no failed build: either no pack row
  // exists for this destination at all, or only a completed/cancelled row
  // with no usable version — either way, nothing built is recorded.
  return { ...base, state: "not_built" };
}

// Plain words for the status area. Ready needs no line (the itinerary
// itself is the proof); every other state gets exactly one honest line.
export function packBuildStatusLines(
  status: PackBuildStatus | null | undefined,
  destinationName?: string | null
): {
  headline: string;
  detail: string | null;
} | null {
  if (!status) return null;
  const destination = destinationName && destinationName.trim() ? destinationName.trim() : "this destination";
  switch (status.state) {
    case "ready":
      return null;
    case "building":
      return {
        headline: `Map data for ${destination} is still building.`,
        detail: null
      };
    case "failed":
      return {
        headline: `The last map build for ${destination} failed.`,
        detail: status.lastError ? `Last build error: ${status.lastError}` : "No build error was recorded."
      };
    case "not_built":
      return {
        headline: "No map pack has been built for this destination yet.",
        detail: status.destinationId ? null : "No destination map pack is recorded for this trip yet."
      };
    case "unknown":
      return {
        headline: "Map pack status is not recorded for this destination.",
        detail: null
      };
  }
}
