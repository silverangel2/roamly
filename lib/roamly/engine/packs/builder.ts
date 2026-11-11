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
  StoredLegMatrix,
  WeatherSnapshotKind,
  WeatherSnapshotRecord
} from "@/lib/roamly/engine/packs/types";
import {
  OPEN_PLACES_CLASSIFIER_VERSION,
  OVERTURE_EXTRACT_CLASSIFIER_VERSION,
  PACK_CLASSIFIER_VERSION,
  PACK_FRESHNESS_MS,
  PACK_LEASE_TTL_MS,
  PackStoreError,
  toInstant
} from "@/lib/roamly/engine/packs/types";
import {
  collectPoiCandidatesFromExtract,
  extractBuildProvenance,
  type OvertureExtractLoadOptions
} from "@/lib/roamly/engine/packs/overtureExtract";
import { PACK_SCHEMA_VERSION } from "@/lib/roamly/engine/types";
import {
  collectPoiCandidates,
  fetchGuideSights,
  fetchWeatherDays,
  liveBuildProvenance,
  systemFetcher,
  type FetchPolicy,
  type Fetcher,
  type PoiCollection
} from "@/lib/roamly/engine/packs/collectors";
import { buildLegMatrix } from "@/lib/roamly/engine/packs/legMatrix";
import { solveTrip } from "@/lib/roamly/engine/solver";
import { scoreStays } from "@/lib/roamly/engine/anchors";
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
      label:
        source === "overture"
          ? row.tags?.source_dataset === "overture-places-extract"
            ? "Overture place (prebuilt Overture Places extract, CDLA Permissive 2.0)"
            : "Overture place (via Open Places API)"
          : source === "guide"
            ? "Open-guide sight (Wikipedia/Wikivoyage geosearch — thin-destination enrichment)"
            : "OpenStreetMap element"
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
  /** OSRM leg matrix built with the candidates (consolidation
   *  2026-11-06), or null when routing was unreachable — the
   *  solver then falls back to labelled haversine estimates. */
  legMatrix?: StoredLegMatrix | null;
}

export type PackCollector = (destination: DestinationDTO) => Promise<CollectedBuild>;

/**
 * The kick-scoped collection budget (pack-kick kill-loop fix,
 * 2026-10-22/23): the kick runs inside function contexts whose
 * hard lifetime is shorter than a metro-scale build (the manual
 * advance route's maxDuration = 90 s; the batch-cron tail even
 * less). When the collector outlasts this budget, runBuildJob
 * RELEASES the job back to "queued" (no failure recorded) instead
 * of being hard-killed mid-claim — the 300 s hourly cron then does
 * the real build. Well inside the advance tail (90 s) with margin
 * for the release write; small-city builds (tens of seconds) still
 * complete in the tail exactly as before.
 */
export const KICK_BUILD_BUDGET_MS = 45_000;

export interface RunBuildOptions {
  workerId: string;
  leaseTtlMs?: number;
  /** Kick-scoped overall budget in ms (see KICK_BUILD_BUDGET_MS).
   *  When set, runBuildJob races the collector against it; on
   *  expiry it releases the job back to "queued" (honest yield,
   *  never a failure) and returns null. The cron drain calls
   *  without it (its 300 s box owns the full 210 s collector
   *  deadline). Omit for the pre-kick behavior byte for byte. */
  kickBudgetMs?: number;
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
 *
 * When `options.kickBudgetMs` is set (the kick's short-lived
 * function context), the collector is raced against the budget:
 * on expiry the job is RELEASED back to "queued" (lease cleared,
 * no failure recorded) and null is returned — the trip keeps
 * waiting honestly and the 300 s hourly cron reclaims the job.
 * This is the kill-loop fix: a hard-killed function takes
 * neither the publish nor the fail path and leaves the job
 * "building" under a live lease, which suppresses every later
 * kick until the lease expires (since the 2026-11-07 pack
 * rescue, the cron's drain then reclaims it via the steal).
 * The budget release happens while the function is still
 * alive, so the job can never be stranded by a mid-claim kill.
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
  const publish = (collected: CollectedBuild): Promise<PackVersionRecord> => {
    // beginVersion stamped the default (OSM) classifier version
    // before collection — the version row has to exist for the
    // lease/fencing flow. When the Open Places fallback lane is
    // the one that served this build, restamp the DTO's
    // classifierVersion truthfully at publish (see publishVersion).
    const classifierVersionRestamp =
      collected.provenance.source === "overture-open-places"
        ? OPEN_PLACES_CLASSIFIER_VERSION
        : collected.provenance.source === "overture-places-extract"
          ? OVERTURE_EXTRACT_CLASSIFIER_VERSION
          : undefined;
    return store.publishVersion(
      version.dto.packVersionId,
      jobId,
      lease.leaseId,
      collected.candidates,
      collected.provenance,
      classifierVersionRestamp,
      collected.legMatrix ?? null
    );
  };
  const recordFailure = async (err: unknown): Promise<never> => {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await store.failVersion(version.dto.packVersionId, jobId, lease.leaseId, message);
    } catch {
      /* lease already lost — the job's fate belongs to its new holder */
    }
    throw err;
  };
  const budgetMs = options.kickBudgetMs;
  if (budgetMs === undefined) {
    try {
      return await publish(await collector(destination));
    } catch (err) {
      return recordFailure(err);
    }
  }
  // Kick-scoped run: the collector may outlast the function's own
  // lifetime — release the job before the box kills us.
  const collectPromise = collector(destination);
  type RaceWinner =
    | { type: "collected"; collected: CollectedBuild }
    | { type: "failed"; err: unknown }
    | { type: "budget" };
  const winner: RaceWinner = await Promise.race([
    collectPromise.then(
      (collected): RaceWinner => ({ type: "collected", collected }),
      (err: unknown): RaceWinner => ({ type: "failed", err })
    ),
    new Promise<RaceWinner>((resolve) => {
      const timer = setTimeout(() => resolve({ type: "budget" }), budgetMs);
      // An un-won timer must not keep the process alive on its own.
      (timer as unknown as { unref?: () => void }).unref?.();
    })
  ]);
  if (winner.type === "budget") {
    // Budget expired: yield the job back to "queued" under our own
    // still-live lease (fencing makes this ours to release) — no
    // failure recorded, so the 300 s hourly cron reclaims the job.
    // The collector's late outcome is discarded: consume it so it
    // can never surface as an unhandled rejection.
    collectPromise.then(
      () => undefined,
      () => undefined
    );
    try {
      await store.releaseBuild(jobId, lease.leaseId);
    } catch {
      /* released under us — same outcome */
    }
    return null;
  }
  if (winner.type === "failed") {
    // The collector failed BEFORE the budget: fail the job exactly
    // as the unbounded path does (recorded failure, a fresh job on
    // the next read) — never a silent release.
    return recordFailure(winner.err);
  }
  try {
    return await publish(winner.collected);
  } catch (err) {
    return recordFailure(err);
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
 *
 * Pack rescue (2026-11-07): "building" jobs are offered to
 * runBuildJob too, not just "queued" ones. A build the pack kick
 * started sits at "building" under a lease for most of every hour,
 * and when the kick's function dies mid-build the job can only be
 * reclaimed by claimBuild's expired-lease steal — which a
 * queued-only drain never invoked, so the reclaim waited for a
 * later hourly tick (or forever, while a trip kept the kick busy).
 * Offering the job is safe: claimBuild returns null for a building
 * job whose lease is still live, and runBuildJob then no-ops.
 */
export async function drainQueuedBuilds(
  store: PackStore,
  collectorFor: (destinationId: string) => PackCollector,
  options: RunBuildOptions
): Promise<PackVersionRecord[]> {
  const jobs = await store.listBuildJobs();
  const published: PackVersionRecord[] = [];
  for (const job of jobs) {
    if (job.status !== "queued" && job.status !== "building") continue;
    if (options.onlyDestinationId && job.destinationId !== options.onlyDestinationId) continue;
    const done = await runBuildJob(store, job.jobId, collectorFor(job.destinationId), options);
    if (done) published.push(done);
  }
  return published;
}

/** Sight-stock bar under which a destination counts as THIN and
 *  the fallback sequence (widen → enrich → label) engages. A
 *  multi-day trip wants several distinct sights per day; under
 *  this count the registry box alone cannot honestly fill days. */
export const THIN_PACK_SIGHTS = 12;

/** Merge two candidate sets: existing rows win; an incoming row
 *  is dropped when its candidateKey already exists or it is the
 *  same named place at the same spot (the collectors' dedupe
 *  grain). */
function mergeCandidates(base: StoredCandidate[], extra: StoredCandidate[]): StoredCandidate[] {
  const keys = new Set(base.map((c) => c.candidateKey));
  const spots = new Set(
    base.map((c) => `${c.name.toLowerCase()}|${c.kind}|${c.pos ? `${c.pos.lat.toFixed(3)},${c.pos.lon.toFixed(3)}` : "nopos"}`)
  );
  const out = [...base];
  for (const c of extra) {
    if (keys.has(c.candidateKey)) continue;
    const spot = `${c.name.toLowerCase()}|${c.kind}|${c.pos ? `${c.pos.lat.toFixed(3)},${c.pos.lon.toFixed(3)}` : "nopos"}`;
    if (spots.has(spot)) continue;
    keys.add(c.candidateKey);
    spots.add(spot);
    out.push(c);
  }
  return out;
}

/** Re-run the OSM collection against a ~15 km box around the
 *  centre. A widening failure is swallowed (the base collection
 *  stands); a widening success returns its full candidate set
 *  for merging. */
async function widenCollection(
  fetcher: Fetcher,
  destination: DestinationDTO,
  policy: FetchPolicy
): Promise<StoredCandidate[]> {
  try {
    const dLat = 0.135; // ~15 km
    const dLon = 0.135 / Math.max(0.2, Math.cos((destination.centre.lat * Math.PI) / 180));
    const widened: DestinationDTO = {
      ...destination,
      bbox: {
        minLat: destination.centre.lat - dLat,
        minLon: destination.centre.lon - dLon,
        maxLat: destination.centre.lat + dLat,
        maxLon: destination.centre.lon + dLon
      },
      coverageBoxes: []
    };
    const collection = await collectPoiCandidates(fetcher, widened, policy);
    return collection.candidates;
  } catch {
    return [];
  }
}

/** Solver shortlist for the leg matrix (fix round 2026-11-07;
 *  trip-class extension, matrix-coverage fix 2026-11-07).
 *  The pack is built before any trip exists, so the matrix cannot
 *  know a real trip's stops — but it can know the stops the solver
 *  itself picks for canonical trips over THIS pack. Run the real
 *  solver for the common trip lengths (3/5/7 days from a Monday
 *  and a Friday anchor; empty must-sees, default earliest start
 *  and profile — runEnginePlan's shape for an unadorned payload)
 *  and collect every leg endpoint and stop key in solve order,
 *  shortest trips first. buildLegMatrix fills its capped point
 *  set with these keys before topping up, so the matrix covers
 *  the candidates the solver can actually choose instead of an
 *  editorial kind order (step-4 verification: the old fill left
 *  Quebec City's solver stops uncovered — 0/18 legs routed).
 *  Pure CPU over the collected candidates; a failed canonical
 *  solve degrades to the keys collected so far, never a build
 *  failure.
 *
 *  TRIP CLASSES (2026-11-07): the canonical solves run anchored
 *  at the destination centre AND at the pack's top scored stay.
 *  Centre-only anchoring diverged from real trips: a real
 *  no-booking trip anchors at its top scored stay
 *  (deriveSolveContext's scored-fallback), and the solver's
 *  chains — above all its meal picks, chosen by proximity to the
 *  chain's current position — then visit a different
 *  neighbourhood than any centre-anchored chain reaches. That
 *  divergence is exactly how a real Tokyo trip's three food
 *  stops missed the point set while the matrix itself was
 *  perfect. The stay-anchored solves mirror the scored-fallback
 *  anchor class (basePos/baseName from the top stay, no pinned
 *  stay — the same shape runEnginePlan solves for it). */
export function solverShortlistKeys(
  destination: DestinationDTO,
  candidates: readonly StoredCandidate[],
  now: Date
): string[] {
  const engine: EngineCandidate[] = [];
  for (const row of candidates) {
    const c = storedCandidateToEngine(row);
    if (c) engine.push(c);
  }
  if (engine.length < 2) return [];
  const by = (kinds: readonly string[]): EngineCandidate[] => engine.filter((c) => kinds.includes(c.kind));
  const pack: EnginePack = {
    destination: destination.displayName,
    country: destination.country,
    center: destination.centre,
    legMatrix: null,
    counts: packCounts(candidates),
    stays: by(["stay"]),
    sights: by(SIGHT_KINDS),
    excursions: by(EXCURSION_KINDS),
    foods: by(["food"]),
    transport: by(TRANSPORT_KINDS),
    weather: []
  };
  // Canonical date anchors at build time: a Monday-anchored strip
  // of eleven dates, solved from day 0 (weekday trips) and day 4
  // (Friday — weekend trips). Opening-hours checks are weekday-
  // sensitive, so a single anchor week systematically misses
  // places a Fri–Sun trip can use (fix-round evidence: Prayagraj
  // day-3 parks). Deterministic for a given build week.
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const strip: string[] = Array.from({ length: 11 }, (_, i) =>
    new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10)
  );
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string | null | undefined): void => {
    if (key && key !== "base" && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };
  const solveClass = (basePos: { lat: number; lon: number }, baseName: string): void => {
    for (const startOffset of [0, 4]) {
      for (const days of [3, 5, 7]) {
        try {
          const plan = solveTrip(pack, {
            days,
            startIso: strip[startOffset],
            dates: strip.slice(startOffset, startOffset + days),
            earliestMin: 9 * 60,
            restSpec: null,
            mustSees: [],
            basePos,
            baseName
          });
          for (const day of plan.days) {
            for (const leg of day.legs) {
              push(leg.fromKey);
              push(leg.toKey);
            }
            for (const item of day.items) push(item.key);
          }
        } catch {
          // A canonical solve is matrix advice, not a build gate:
          // keep whatever earlier solves collected.
        }
      }
    }
  };
  // Class 1: centre-anchored (the destination-centre base class).
  solveClass(destination.centre, destination.displayName);
  // Class 2: top-stay-anchored (the scored-fallback base class a
  // real no-booking trip solves from). Skipped when the pack has
  // no scored stay, or the top stay sits on the centre itself —
  // that class's chains are the centre class's chains.
  const topStay = scoreStays(pack)[0] || null;
  if (
    topStay &&
    (topStay.pos.lat !== destination.centre.lat || topStay.pos.lon !== destination.centre.lon)
  ) {
    solveClass(topStay.pos, topStay.name);
  }
  return keys;
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

/** The leg-matrix tail every collection lane shares: OSRM /table
 *  per profile at build time, cached in the version; zero per-trip
 *  routing calls. Unreachable routing is not a build failure: the
 *  version publishes without a matrix and the solver labels its
 *  haversine fallback per leg. The point set leads with the
 *  solver's own shortlist for this pack (solverShortlistKeys) so
 *  the capped matrix covers the stops solves actually pick (fix
 *  round 2026-11-07). Profile truth is part of the build record
 *  (matrix-coverage fix, 2026-11-07): a dead profile is ALSO in
 *  the stored artefact (legMatrix.profiles) — the log lines here
 *  are so the build's own output says it out loud instead of the
 *  pack looking identical to a fully-routed one. Extracted
 *  verbatim from liveCollector (SPEED FIX F1) so the extract lane
 *  builds its matrix through the identical path. */
export async function attachLegMatrix(
  fetcher: Fetcher,
  destination: DestinationDTO,
  candidates: StoredCandidate[]
): Promise<StoredLegMatrix | null> {
  const shortlistKeys = solverShortlistKeys(destination, candidates, new Date());
  const legMatrix = await buildLegMatrix(
    fetcher,
    destination.centre,
    candidates,
    () => new Date(),
    20_000,
    shortlistKeys
  );
  if (!legMatrix) {
    console.warn(
      `[packs] leg matrix for ${destination.displayName}: routing unreachable for BOTH profiles — the pack publishes without a matrix and every leg falls back to a labelled haversine estimate.`
    );
  } else if (legMatrix.profiles && (!legMatrix.profiles.drive || !legMatrix.profiles.walk)) {
    const deadFields = [
      legMatrix.profiles.drive ? null : "profiles.drive",
      legMatrix.profiles.walk ? null : "profiles.walk"
    ].filter(Boolean);
    console.warn(
      `[packs] leg matrix for ${destination.displayName}: routing profile unreachable at build (${deadFields.join(", ")} = false, recorded on the matrix); its legs fall back to labelled haversine estimates.`
    );
  }
  return legMatrix;
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
      let candidates = collection.candidates;
      let thinNote = "";
      // Thin-destination fallback (consolidation 2026-11-06):
      // when the registry box's sight stock is thin, WIDEN the
      // collection to ~15 km, then ENRICH with open-guide sights
      // (Wikipedia/Wikivoyage geosearch), then LABEL the pack
      // honestly in its provenance. Generation still ships — a
      // sparse day, labelled sparse — instead of failing for
      // thinness (the KF-1 lesson: the failure was never the
      // data, and a traveller is owed a trip, not an error).
      if (packCounts(candidates).sights < THIN_PACK_SIGHTS) {
        const widened = await widenCollection(fetcher, destination, policy);
        if (widened.length) {
          candidates = mergeCandidates(candidates, widened);
          thinNote += "; thin destination — collection widened to ~15 km";
        }
        if (packCounts(candidates).sights < THIN_PACK_SIGHTS) {
          const guide = await fetchGuideSights(fetcher, destination.centre, policy);
          if (guide.length) {
            candidates = mergeCandidates(candidates, guide);
            thinNote += `; enriched with ${guide.length} open-guide sights (Wikipedia/Wikivoyage geosearch, labelled per row)`;
          }
        }
        if (packCounts(candidates).sights < THIN_PACK_SIGHTS) {
          thinNote += "; SPARSE destination — expect a lighter day plan; sparsity is stated, never padded with invented places";
        }
      }
      const provenance = liveBuildProvenance(collection, collection.evidence.fetchedAt);
      if (thinNote) provenance.label += thinNote;
      const legMatrix = await attachLegMatrix(fetcher, destination, candidates);
      return { candidates, provenance, legMatrix };
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

export interface PrimaryCollectorOptions extends LiveCollectorOptions {
  /** Extract-lane load options (injected loader / dir / URL
   *  template overrides) — proofs inject these; production reads
   *  the env (ROAMLY_PACK_EXTRACT_DIR / _URL_TEMPLATE). */
  extract?: OvertureExtractLoadOptions;
}

/** THE PRIMARY COLLECTOR (SPEED FIX F1, 2026-11-07) — the default
 *  collector behind every pack build (kick, pack drive, hourly
 *  cron drain). Lane order:
 *
 *    1. Overture Places EXTRACT (packs/overtureExtract.ts): a
 *       prebuilt per-destination slice of the public S3 parquet
 *       release, classified locally. Serves ONLY when an extract
 *       exists for the destination and classifies to a viable
 *       pack — sight stock at the codebase's thin bar
 *       (THIN_PACK_SIGHTS), the same bar the live lane uses to
 *       engage its own widen/enrich fallbacks. Build time is the
 *       classification plus the shared leg-matrix tail: seconds.
 *    2. The LIVE lane (liveCollector, unchanged): the Overpass
 *       ladder, its thin-destination widen/enrich/label sequence,
 *       and the Open Places API whole-pack fallback. This is the
 *       honest fallback for destinations with no extract or a
 *       thin one — including every destination with deliberate
 *       subregion coverage boxes the slicer does not cut.
 *
 *  Whole-pack discipline holds across the lanes: exactly one
 *  source builds a version, never a merge, and the version's
 *  provenance names the lane that served. An extract-lane error
 *  is a lane miss (logged), never a build failure — the live
 *  lane behind it owns the failure surface exactly as before. */
export function primaryCollector(
  fetcher: Fetcher = systemFetcher,
  policy: FetchPolicy = DEFAULT_FETCH_POLICY,
  options: PrimaryCollectorOptions = {}
): PackCollector {
  const live = liveCollector(fetcher, policy, options);
  return async (destination) => {
    let extract = null;
    try {
      extract = await collectPoiCandidatesFromExtract(destination, options.extract ?? {});
    } catch (err) {
      console.warn(
        `[packs] extract lane errored for ${destination.displayName} (${err instanceof Error ? err.message : String(err)}); falling back to live collection.`
      );
      extract = null;
    }
    if (extract && extract.candidates.length > 0) {
      const counts = packCounts(extract.candidates);
      if (counts.sights >= THIN_PACK_SIGHTS) {
        const legMatrix = await attachLegMatrix(fetcher, destination, extract.candidates);
        return {
          candidates: extract.candidates,
          provenance: extractBuildProvenance(extract, toInstant(new Date())),
          legMatrix
        };
      }
      console.warn(
        `[packs] extract for ${destination.displayName} is thin (${counts.sights} sights < ${THIN_PACK_SIGHTS}); falling back to live collection.`
      );
    }
    return live(destination);
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
    legMatrix: version.legMatrix ?? null,
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
  const parts = await assemblePinnedEnginePackParts(store, generationRef, weather);
  return parts ? { pack: parts.pack, version: parts.version } : null;
}

/** The pinned assemble with its inputs retained (Stage 7,
 *  2026-11-11): the day-batch path holds the parts so its
 *  post-enrichment refresh can merge a by-keys re-read into the
 *  candidate set it already paid to serve, instead of re-serving
 *  the whole pack. */
export type AssembledPinnedPack = {
  pack: EnginePack;
  version: PackVersionRecord;
  destination: DestinationDTO;
  candidates: StoredCandidate[];
  weatherDays: EngineWeatherDay[];
};

export async function assemblePinnedEnginePackParts(
  store: PackStore,
  generationRef: string,
  weather: WeatherSnapshotRecord | null
): Promise<AssembledPinnedPack | null> {
  const pin = await store.getPin(generationRef);
  if (!pin) return null;
  const pinned = await store.readPinned(pin.packVersionId);
  if (!pinned) return null;
  const destination = await store.getDestination(pinned.version.dto.destinationId);
  if (!destination) return null;
  const weatherDays = weather ? weather.days : [];
  return {
    pack: assembleEnginePack(destination, pinned.version, pinned.candidates, weatherDays),
    version: pinned.version,
    destination,
    candidates: [...pinned.candidates],
    weatherDays: [...weatherDays]
  };
}

/** Merge a by-keys refresh into a held candidate set: refreshed
 *  rows replace held rows with the same candidateKey; a key the
 *  store did not return keeps its held row (the refresh can only
 *  ever update the keys it asked for — it never drops a row). */
export function mergeRefreshedCandidates(
  held: readonly StoredCandidate[],
  refreshed: readonly StoredCandidate[]
): StoredCandidate[] {
  if (!refreshed.length) return [...held];
  const byKey = new Map(refreshed.map((candidate) => [candidate.candidateKey, candidate]));
  return held.map((candidate) => byKey.get(candidate.candidateKey) ?? candidate);
}

/** Stage 7 by-keys refresh (2026-11-11): re-read ONLY the named
 *  keys from the store and rebuild the solver pack over the merged
 *  set. Returns null when the store offers no by-keys read or
 *  returns nothing for the keys — the caller then falls back to
 *  the full re-assemble, exactly today's behaviour. */
export async function refreshAssembledPackByKeys(
  store: PackStore,
  parts: AssembledPinnedPack,
  candidateKeys: readonly string[]
): Promise<AssembledPinnedPack | null> {
  if (!candidateKeys.length || typeof store.getVersionCandidatesByKeys !== "function") return null;
  const refreshed = await store.getVersionCandidatesByKeys(parts.version.dto.packVersionId, candidateKeys);
  if (!refreshed.length) return null;
  const candidates = mergeRefreshedCandidates(parts.candidates, refreshed);
  return {
    ...parts,
    candidates,
    pack: assembleEnginePack(parts.destination, parts.version, candidates, parts.weatherDays)
  };
}
