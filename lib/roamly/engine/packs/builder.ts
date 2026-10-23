import { contentId, sourceKey } from "@/lib/roamly/engine/ids";
import type {
  CandidateDTO,
  DestinationDTO,
  GoogleEnrichmentDTO,
  ProvenanceDTO
} from "@/lib/roamly/engine/types";
import type { UtcInstant } from "@/lib/roamly/engine/time";
import type { EngineCandidate, EnginePack, EngineWeatherDay } from "@/lib/roamly/engine/util";
import type { PackStore } from "@/lib/roamly/engine/packs/store";
import type {
  BuildJobRecord,
  PackVersionRecord,
  ServingPackResult,
  StoredCandidate,
  StoredEnrichment,
  WeatherSnapshotKind,
  WeatherSnapshotRecord
} from "@/lib/roamly/engine/packs/types";
import {
  OPEN_PLACES_CLASSIFIER_VERSION,
  PACK_CLASSIFIER_VERSION,
  PACK_FRESHNESS_MS,
  PACK_LEASE_TTL_MS,
  PackStoreError,
  toInstant
} from "@/lib/roamly/engine/packs/types";
import { PACK_SCHEMA_VERSION } from "@/lib/roamly/engine/types";
import {
  collectPoiCandidates,
  fetchWeatherDays,
  liveBuildProvenance,
  systemFetcher,
  type FetchPolicy,
  type Fetcher,
  type PoiCollection
} from "@/lib/roamly/engine/packs/collectors";
import { DEFAULT_FETCH_POLICY } from "@/lib/roamly/engine/packs/collectors";
import {
  collectPoiCandidatesFromOpenPlaces,
  openPlacesBuildProvenance,
  type OpenPlacesOptions
} from "@/lib/roamly/engine/packs/openPlaces";

/*
 * Pack builder service — the application layer of the data plane
 * (DESIGN-PRODUCTION.md §2.2). It owns the write path:
 *
 *   requestBuild (coalescing) -> claim (lease) -> beginVersion
 *   -> collect (provider services) -> publishVersion (atomic flip)
 *
 * and the serving read path (stale-while-revalidate), and the
 * boundary translations: stored rows -> Phase 1 DTOs, and pinned
 * version + weather snapshot -> the Phase 2 EnginePack the solver
 * consumes. The domain core never sees the store; generations pin
 * a version here and assemble from the pin.
 *
 * ATTACH POINT (design Phase 3 asked for one, chosen + recorded):
 * a dedicated cron route `app/api/cron/roamly-pack-refresh`
 * (CRON_SECRET via lib/roamly/cronAuth.ts, daily off-peak) will
 * drain the queue through drainQueuedBuilds once M7 is applied and
 * the Supabase PackStore exists. The route file is deliberately NOT
 * added in this phase: without its tables it could only fail, and
 * an unproven route is worse than a recorded deferral. Everything
 * the route will call is built and proven here.
 */

/* ------------------------------------------------------------------ */
/* Kind partitions — the shadow pack's array splits, verbatim          */
/* ------------------------------------------------------------------ */

export const SIGHT_KINDS: readonly string[] = [
  "museum",
  "gallery",
  "attraction",
  "viewpoint",
  "park",
  "historic",
  "market",
  "venue"
];
export const EXCURSION_KINDS: readonly string[] = ["falls", "lighthouse"];
export const TRANSPORT_KINDS: readonly string[] = ["ferry", "station"];

/** The shadow pack's counts block, recomputed from stored rows:
 *  sights INCLUDES the excursion kinds (falls/lighthouse), exactly
 *  as collectors.mjs counted them. */
export function packCounts(candidates: readonly StoredCandidate[]): EnginePack["counts"] {
  const by = (kinds: readonly string[]): number => candidates.filter((c) => kinds.includes(c.kind)).length;
  return {
    total: candidates.length,
    sights: by([...SIGHT_KINDS, ...EXCURSION_KINDS]),
    foods: by(["food"]),
    stays: by(["stay"]),
    transport: by(TRANSPORT_KINDS)
  };
}

/* ------------------------------------------------------------------ */
/* Boundary conversions: stored rows -> Phase 1 DTOs                   */
/* ------------------------------------------------------------------ */

export function enrichmentToDTO(enrichment: StoredEnrichment | null, builtAt: UtcInstant | null): GoogleEnrichmentDTO | null {
  if (!enrichment || !enrichment.placeId) return null;
  const fetchedAt = (enrichment.fetchedAt as UtcInstant | undefined) ?? builtAt;
  if (!fetchedAt) return null;
  const refreshRaw = enrichment.refreshDue || null;
  const refreshDueAt = refreshRaw
    ? (/^\d{4}-\d{2}-\d{2}$/.test(refreshRaw) ? (`${refreshRaw}T00:00:00.000Z` as UtcInstant) : (refreshRaw as UtcInstant))
    : fetchedAt;
  return {
    placeId: enrichment.placeId,
    priceLevel: enrichment.priceLevel ?? null,
    rating: enrichment.rating ?? null,
    ratingCount: enrichment.userRatingCount ?? null,
    hoursStatus:
      enrichment.businessStatus === "CLOSED_TEMPORARILY"
        ? "closed-temporarily"
        : enrichment.hoursByDay
          ? "known"
          : null,
    wheelchairEntrance: enrichment.wheelchairEntrance ?? null,
    fetchedAt,
    refreshDueAt,
    provenance: {
      source: "google",
      sourceRef: sourceKey("google", enrichment.placeId),
      recordedAt: fetchedAt,
      label: enrichment.source || "google enrichment"
    }
  };
}

export function candidateRowToDTO(row: StoredCandidate, builtAt: UtcInstant | null): CandidateDTO {
  // The row's provenance source is its candidateKey's source prefix:
  // "osm" for every row the OSM lane and the recorded seeds produce
  // (unchanged), "overture" for Open Places fallback rows.
  const source = row.candidateKey.split(":", 1)[0] || "osm";
  return {
    candidateKey: row.candidateKey,
    kind: row.kind,
    name: row.name,
    pos: row.pos,
    hours: { status: row.hoursRaw ? "known" : "unknown", raw: row.hoursRaw },
    enrichment: enrichmentToDTO(row.enrichment, builtAt),
    provenance: {
      source,
      sourceRef: row.candidateKey,
      recordedAt: builtAt,
      label: source === "overture" ? "Overture place (via Open Places API)" : "OpenStreetMap element"
    }
  };
}

/* ------------------------------------------------------------------ */
/* Recorded (shadow) pack ingestion — the seed input path              */
/* ------------------------------------------------------------------ */

/** The shadow pack's candidate shape (cache/pack-*.json), as frozen
 *  into the Phase 2 fixtures. */
export interface RecordedCandidate {
  key: string;
  name: string;
  nameEn?: string | null;
  kind: string;
  pos: { lat: number; lon: number } | null;
  hoursRaw: string | null;
  tags?: Record<string, string>;
  url: string;
  google?: Record<string, unknown> | null;
}

export interface RecordedPack {
  destination: string;
  country: string;
  center: { lat: number; lon: number };
  startIso?: string;
  endIso?: string;
  generatedAt?: string;
  counts?: EnginePack["counts"];
  stays: RecordedCandidate[];
  sights: RecordedCandidate[];
  excursions: RecordedCandidate[];
  foods: RecordedCandidate[];
  transport: RecordedCandidate[];
  weather: { date: string; tMax: number | null; tMin: number | null; precipProb: number | null }[];
}

function recordedEnrichment(google: Record<string, unknown> | null | undefined): StoredEnrichment | null {
  if (!google) return null;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    source: str(google.source) || "google",
    placeId: str(google.placeId),
    priceLevel: str(google.priceLevel),
    rating: num(google.rating),
    userRatingCount: num(google.userRatingCount),
    businessStatus: str(google.businessStatus),
    wheelchairEntrance: typeof google.wheelchairEntrance === "boolean" ? google.wheelchairEntrance : null,
    hoursByDay: (google.hoursByDay as StoredEnrichment["hoursByDay"]) ?? undefined,
    fetchedAt: str(google.fetchedAt) ?? undefined,
    refreshDue: str(google.refreshDue) ?? undefined
  };
}

export function normalizeRecordedCandidate(c: RecordedCandidate): StoredCandidate {
  return {
    candidateKey: sourceKey("osm", c.key),
    osmKey: c.key,
    kind: c.kind,
    name: c.name,
    nameEn: c.nameEn ?? null,
    pos: c.pos,
    hoursRaw: c.hoursRaw,
    tags: c.tags || {},
    url: c.url,
    enrichment: recordedEnrichment(c.google)
  };
}

/** A recorded shadow pack -> stored rows + weather days. The POI
 *  rows and the weather days come OUT as separate artifacts here,
 *  at ingestion — they are never re-merged into one stored object. */
export function normalizeRecordedPack(recorded: RecordedPack): {
  candidates: StoredCandidate[];
  weatherDays: EngineWeatherDay[];
} {
  const seen = new Set<string>();
  const candidates: StoredCandidate[] = [];
  for (const c of [...recorded.stays, ...recorded.sights, ...recorded.excursions, ...recorded.foods, ...recorded.transport]) {
    const row = normalizeRecordedCandidate(c);
    if (!seen.has(row.candidateKey)) {
      seen.add(row.candidateKey);
      candidates.push(row);
    }
  }
  const weatherDays: EngineWeatherDay[] = (recorded.weather || []).map((w) => ({
    date: w.date as EngineWeatherDay["date"],
    tMax: w.tMax,
    tMin: w.tMin,
    precipProb: w.precipProb
  }));
  return { candidates, weatherDays };
}

/* ------------------------------------------------------------------ */
/* Build execution — claim -> begin -> collect -> publish             */
/* ------------------------------------------------------------------ */

export interface CollectedBuild {
  candidates: StoredCandidate[];
  provenance: ProvenanceDTO;
}

export type PackCollector = (destination: DestinationDTO) => Promise<CollectedBuild>;

export interface RunBuildOptions {
  workerId: string;
  leaseTtlMs?: number;
  /** Heartbeat cadence is the caller's concern in production (the
   *  cron drains short builds); the service claims once and the
   *  collector is expected to finish inside the lease. */
  /** Drain filter (pack-kick, 2026-10-22): when set, drainQueuedBuilds
   *  runs only this destination's queued jobs. The cron calls the
   *  drain unfiltered (every queued destination, oldest first —
   *  unchanged); the in-process kick calls it filtered, so one
   *  waiting trip starts ONE bounded build instead of re-draining
   *  the whole queue inside a traveler's request lifecycle. */
  onlyDestinationId?: string;
}

/**
 * Run one queued build job end to end. Returns the published
 * version, or null when the job was not claimable (already held,
 * done, or failed). Collector failures fail the version AND the
 * job, with the error recorded — a failed build never publishes
 * a partial pack and never disturbs the serving version.
 */
export async function runBuildJob(
  store: PackStore,
  jobId: string,
  collector: PackCollector,
  options: RunBuildOptions
): Promise<PackVersionRecord | null> {
  const job = await store.getBuildJob(jobId);
  if (!job) throw new PackStoreError("JOB_NOT_FOUND", `no build job ${jobId}`);
  const lease = await store.claimBuild(jobId, options.workerId, options.leaseTtlMs ?? PACK_LEASE_TTL_MS);
  if (!lease) return null;
  const destination = await store.getDestination(job.destinationId);
  if (!destination) throw new PackStoreError("UNKNOWN_DESTINATION", `job ${jobId} targets unregistered destination`);
  const version = await store.beginVersion(jobId, lease.leaseId, PACK_CLASSIFIER_VERSION, PACK_SCHEMA_VERSION);
  try {
    const collected = await collector(destination);
    // beginVersion stamped the default (OSM) classifier version
    // before collection — the version row has to exist for the
    // lease/fencing flow. When the Open Places fallback lane is
    // the one that served this build, restamp the DTO's
    // classifierVersion truthfully at publish (see publishVersion).
    const classifierVersionRestamp =
      collected.provenance.source === "overture-open-places" ? OPEN_PLACES_CLASSIFIER_VERSION : undefined;
    return await store.publishVersion(
      version.dto.packVersionId,
      jobId,
      lease.leaseId,
      collected.candidates,
      collected.provenance,
      classifierVersionRestamp
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await store.failVersion(version.dto.packVersionId, jobId, lease.leaseId, message);
    } catch {
      /* lease already lost — the job's fate belongs to its new holder */
    }
    throw err;
  }
}

/** Request a build for a destination (coalescing) and return the job. */
export async function requestBuild(
  store: PackStore,
  destinationId: string,
  reason: string
): Promise<{ job: BuildJobRecord; coalesced: boolean }> {
  return store.enqueueBuild(destinationId, reason);
}

/**
 * Drain every currently-queued build for the given collector,
 * oldest first. This is the function the recorded cron attach
 * point (and the Phase 5 cold-destination path) calls. Returns the
 * published versions, in drain order.
 */
export async function drainQueuedBuilds(
  store: PackStore,
  collectorFor: (destinationId: string) => PackCollector,
  options: RunBuildOptions
): Promise<PackVersionRecord[]> {
  const jobs = await store.listBuildJobs();
  const published: PackVersionRecord[] = [];
  for (const job of jobs) {
    if (job.status !== "queued") continue;
    if (options.onlyDestinationId && job.destinationId !== options.onlyDestinationId) continue;
    const done = await runBuildJob(store, job.jobId, collectorFor(job.destinationId), options);
    if (done) published.push(done);
  }
  return published;
}

export interface LiveCollectorOptions {
  /** Open Places fallback API key. Undefined (the default) reads
   *  process.env.OPEN_PLACES_API_KEY; an explicit null disables the
   *  fallback even if the env carries a key (proofs pin the
   *  pre-adapter behavior with it). */
  openPlacesApiKey?: string | null;
  /** Open Places collection options (deadline/sleep/clock) — proofs
   *  inject these; production takes the defaults. */
  openPlaces?: OpenPlacesOptions;
}

/** The live collector: the Overpass ladder first (chunked queries,
 *  endpoint rotation, partial acceptance — the shipped lane,
 *  unchanged), then — ONLY when the whole OSM lane failed outright
 *  or yielded zero candidates, and ONLY when an Open Places API key
 *  is configured — the Open Places fallback adapter (packs/
 *  openPlaces.ts): an independent dataset (Overture) behind an
 *  independent API, whole-pack, never merged into an OSM pack.
 *  With no key configured, the behavior is exactly the pre-adapter
 *  behavior: OSM success returns as before, OSM failure throws as
 *  before, an empty OSM collection returns empty as before. */
export function liveCollector(
  fetcher: Fetcher = systemFetcher,
  policy: FetchPolicy = DEFAULT_FETCH_POLICY,
  options: LiveCollectorOptions = {}
): PackCollector {
  const openPlacesApiKey =
    options.openPlacesApiKey !== undefined
      ? options.openPlacesApiKey
      : (process.env.OPEN_PLACES_API_KEY || "").trim() || null;
  return async (destination) => {
    let collection: PoiCollection | null = null;
    let osmError: Error | null = null;
    try {
      collection = await collectPoiCandidates(fetcher, destination, policy);
    } catch (err) {
      osmError = err instanceof Error ? err : new Error(String(err));
    }
    if (collection && collection.candidates.length > 0) {
      return {
        candidates: collection.candidates,
        provenance: liveBuildProvenance(collection, collection.evidence.fetchedAt)
      };
    }
    if (!openPlacesApiKey) {
      if (osmError) throw osmError;
      const empty = collection as PoiCollection;
      return {
        candidates: empty.candidates,
        provenance: liveBuildProvenance(empty, empty.evidence.fetchedAt)
      };
    }
    let fallback;
    try {
      fallback = await collectPoiCandidatesFromOpenPlaces(fetcher, destination, policy, openPlacesApiKey, options.openPlaces);
    } catch (err) {
      const fallbackError = err instanceof Error ? err : new Error(String(err));
      throw new Error(
        osmError
          ? `Overpass collection failed (${osmError.message}); Open Places fallback also failed (${fallbackError.message})`
          : `Open Places fallback failed (${fallbackError.message})`
      );
    }
    if (fallback.candidates.length === 0) {
      // The fallback found nothing either: preserve the OSM lane's
      // own outcome exactly (its error, or its honest empty result).
      if (osmError) throw osmError;
      const empty = collection as PoiCollection;
      return {
        candidates: empty.candidates,
        provenance: liveBuildProvenance(empty, empty.evidence.fetchedAt)
      };
    }
    return {
      candidates: fallback.candidates,
      provenance: openPlacesBuildProvenance(fallback, fallback.evidence.fetchedAt)
    };
  };
}

/** A collector over recorded input (seed packs, proof fixtures):
 *  the same publish path, a different evidence source. Provenance
 *  says so — a seeded pack never claims a live fetch. */
export function recordedCollector(recorded: RecordedPack): PackCollector {
  return async () => {
    const { candidates } = normalizeRecordedPack(recorded);
    return {
      candidates,
      provenance: {
        source: "recorded-shadow-pack",
        sourceRef: `zero-engine-2026-10-21/cache/pack-${recorded.destination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
        recordedAt: (recorded.generatedAt as UtcInstant | undefined) ?? null,
        label: "Seeded from the shadow zero-engine's cached pack (recorded input, not a live fetch)"
      }
    };
  };
}

/**
 * Seed one destination end to end: enqueue (reason "seed") -> run
 * the build through the normal queue/lease/publish path -> store
 * the recorded weather as a SEPARATE forecast snapshot artifact.
 */
export async function seedDestinationFromRecordedPack(
  store: PackStore,
  destination: DestinationDTO,
  recorded: RecordedPack,
  options: RunBuildOptions
): Promise<{ version: PackVersionRecord; weather: WeatherSnapshotRecord | null }> {
  if (!(await store.getDestination(destination.destinationId))) {
    await store.registerDestination(destination);
  }
  const { job } = await store.enqueueBuild(destination.destinationId, "seed");
  const version = await runBuildJob(store, job.jobId, recordedCollector(recorded), options);
  if (!version) throw new Error(`seed build for ${destination.destinationId} was not claimable`);
  let weather: WeatherSnapshotRecord | null = null;
  if (recorded.startIso && recorded.endIso && recorded.weather.length > 0) {
    const { weatherDays } = normalizeRecordedPack(recorded);
    weather = await recordWeatherSnapshot(store, destination.destinationId, weatherDays, {
      kind: "forecast",
      startDate: recorded.startIso,
      endDate: recorded.endIso,
      fetchedAt: (recorded.generatedAt as UtcInstant | undefined) ?? version.dto.builtAt ?? toInstant(new Date()),
      provider: "open-meteo",
      provenance: {
        source: "recorded-shadow-pack",
        sourceRef: `zero-engine-2026-10-21/cache/weather-${recorded.destination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
        recordedAt: (recorded.generatedAt as UtcInstant | undefined) ?? null,
        label: "Recorded Open-Meteo forecast carried by the shadow pack (seed input)"
      }
    });
  }
  return { version, weather };
}

/* ------------------------------------------------------------------ */
/* Weather snapshots — recorded through the store as their own layer   */
/* ------------------------------------------------------------------ */

export async function recordWeatherSnapshot(
  store: PackStore,
  destinationId: string,
  days: EngineWeatherDay[],
  meta: {
    kind: WeatherSnapshotKind;
    startDate: string;
    endDate: string;
    fetchedAt: UtcInstant;
    provider: string;
    provenance: ProvenanceDTO;
  }
): Promise<WeatherSnapshotRecord> {
  const snapshot: WeatherSnapshotRecord = {
    snapshotId: contentId("wx", [destinationId, meta.provider, meta.kind, meta.startDate, meta.endDate, meta.fetchedAt]),
    destinationId,
    provider: meta.provider,
    kind: meta.kind,
    startDate: meta.startDate as WeatherSnapshotRecord["startDate"],
    endDate: meta.endDate as WeatherSnapshotRecord["endDate"],
    fetchedAt: meta.fetchedAt,
    days,
    provenance: meta.provenance
  };
  return store.putWeatherSnapshot(snapshot);
}

/** Fetch a fresh weather snapshot from Open-Meteo and store it.
 *  Returns null when the provider has no daily block for the range
 *  (weather UNKNOWN for that range — never backfilled). */
export async function fetchAndStoreWeatherSnapshot(
  store: PackStore,
  destinationId: string,
  startIso: string,
  endIso: string,
  kind: WeatherSnapshotKind,
  fetcher: Fetcher = systemFetcher,
  policy: FetchPolicy = DEFAULT_FETCH_POLICY
): Promise<WeatherSnapshotRecord | null> {
  const destination = await store.getDestination(destinationId);
  if (!destination) throw new PackStoreError("UNKNOWN_DESTINATION", `weather for unregistered destination ${destinationId}`);
  const result = await fetchWeatherDays(fetcher, destination.centre, startIso, endIso, kind, policy);
  if (!result) return null;
  return recordWeatherSnapshot(store, destinationId, result.days, {
    kind,
    startDate: startIso,
    endDate: endIso,
    fetchedAt: result.fetchedAt,
    provider: "open-meteo",
    provenance: {
      source: "open-meteo",
      sourceRef: null,
      recordedAt: result.fetchedAt,
      label: `Open-Meteo ${kind} (free, no key)${result.providerTimeZone ? ` — provider timezone ${result.providerTimeZone}` : ""}`
    }
  });
}

/* ------------------------------------------------------------------ */
/* Serving reads — stale-while-revalidate (invariant I4)               */
/* ------------------------------------------------------------------ */

export async function readServingPack(
  store: PackStore,
  destinationId: string,
  options?: { now?: Date; freshnessMs?: number }
): Promise<ServingPackResult> {
  const destination = await store.getDestination(destinationId);
  if (!destination) {
    throw new PackStoreError("UNKNOWN_DESTINATION", `no destination registered as ${destinationId}`);
  }
  const ready = await store.getReadyVersion(destinationId);
  if (!ready) {
    const { job } = await store.enqueueBuild(destinationId, "cold-read");
    return { state: "pending", pack: null, job };
  }
  const now = options?.now ?? new Date();
  const freshnessMs = options?.freshnessMs ?? PACK_FRESHNESS_MS;
  const builtMs = ready.dto.builtAt ? new Date(ready.dto.builtAt).getTime() : 0;
  const stale = now.getTime() - builtMs > freshnessMs;
  let refreshJobId: string | null = null;
  if (stale) {
    const { job } = await store.enqueueBuild(destinationId, "refresh");
    refreshJobId = job.jobId;
  }
  return { state: "ready", pack: ready, stale, refreshJobId };
}

/* ------------------------------------------------------------------ */
/* Assembly — pinned version + weather snapshot -> EnginePack          */
/* ------------------------------------------------------------------ */

export function storedCandidateToEngine(row: StoredCandidate): EngineCandidate | null {
  if (!row.pos) return null; // an unplaceable candidate cannot enter a solve
  return {
    key: row.osmKey,
    name: row.name,
    kind: row.kind,
    pos: row.pos,
    hoursRaw: row.hoursRaw,
    tags: row.tags,
    url: row.url,
    // Phase 4: a distance-gate REJECTION record is provenance, not
    // enrichment — the engine must see NO google data for it (the
    // shadow's applyToPack skipped rejected records the same way).
    google: row.enrichment && !row.enrichment.matchRejected ? row.enrichment : null
  };
}

export function assembleEnginePack(
  destination: DestinationDTO,
  version: PackVersionRecord,
  candidates: readonly StoredCandidate[],
  weatherDays: readonly EngineWeatherDay[]
): EnginePack {
  const engine: EngineCandidate[] = [];
  for (const row of candidates) {
    const c = storedCandidateToEngine(row);
    if (c) engine.push(c);
  }
  const by = (kinds: readonly string[]): EngineCandidate[] => engine.filter((c) => kinds.includes(c.kind));
  return {
    destination: destination.displayName,
    country: destination.country,
    center: destination.centre,
    startIso: weatherDays.length > 0 ? weatherDays[0].date : undefined,
    endIso: weatherDays.length > 0 ? weatherDays[weatherDays.length - 1].date : undefined,
    counts: packCounts(candidates),
    stays: by(["stay"]),
    sights: by(SIGHT_KINDS),
    excursions: by(EXCURSION_KINDS),
    foods: by(["food"]),
    transport: by(TRANSPORT_KINDS),
    weather: [...weatherDays]
  };
}

/** Read a generation's pinned pack and assemble the solver's input.
 *  This is the Phase 5 generation seam's read path: the pin — not
 *  "the latest pack" — decides what a generation solves against. */
export async function assemblePinnedEnginePack(
  store: PackStore,
  generationRef: string,
  weather: WeatherSnapshotRecord | null
): Promise<{ pack: EnginePack; version: PackVersionRecord } | null> {
  const pin = await store.getPin(generationRef);
  if (!pin) return null;
  const pinned = await store.readPinned(pin.packVersionId);
  if (!pinned) return null;
  const destination = await store.getDestination(pinned.version.dto.destinationId);
  if (!destination) return null;
  return {
    pack: assembleEnginePack(destination, pinned.version, pinned.candidates, weather ? weather.days : []),
    version: pinned.version
  };
}
