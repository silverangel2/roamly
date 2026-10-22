import type {
  CandidateDTO,
  DestinationDTO,
  DestinationPackDTO,
  ProvenanceDTO
} from "@/lib/roamly/engine/types";
import type { UtcInstant } from "@/lib/roamly/engine/time";
import type { EngineGoogleData, EngineWeatherDay } from "@/lib/roamly/engine/util";
import type { LocalDate } from "@/lib/roamly/engine/time";

/*
 * Pack data plane — store records and service contracts
 * (DESIGN-PRODUCTION.md §2.2, Phase 3).
 *
 * The domain core (Phase 2) is persistence-free; this package is the
 * boundary where packs become durable, versioned state. Everything
 * here speaks the Phase 1 DTOs at its edges:
 *
 *   - a destination is a DestinationDTO (the registry row),
 *   - a published pack version is a DestinationPackDTO plus its
 *     normalized candidate rows (CandidateDTO is the read shape),
 *   - weather is a SEPARATE snapshot artifact — it never rides inside
 *     a pack version (the shadow's date-blind weather-file reuse is
 *     the defect this split removes).
 *
 * Invariants the store enforces (and the Phase 3 proof asserts):
 *   I1. Published versions are immutable. A rebuild creates a NEW
 *       version; the only field of an old version that may ever
 *       change is its lifecycle status (ready -> superseded), and
 *       only at the moment a newer version publishes.
 *   I2. A generation PIN records the exact pack version it used;
 *       a pinned read returns that version's content byte-for-byte,
 *       before and after any later rebuild.
 *   I3. Builds are single-flight per destination: concurrent build
 *       requests coalesce onto ONE job; a job's lease has an expiry
 *       and a fencing token (leaseId + epoch); a builder whose lease
 *       was stolen can no longer publish (its publish is refused).
 *   I4. Reads are stale-while-revalidate: a stale ready version
 *       serves while a refresh runs; a destination with NO ready
 *       version returns an honest pending state and enqueues a
 *       build — a pack is never fabricated.
 */

/** Version stamp for the OSM classification/transformation logic
 *  ported from the shadow collectors (collectors.ts). Recorded on
 *  every pack version as DestinationPackDTO.classifierVersion. */
export const PACK_CLASSIFIER_VERSION = "osm-classifier-1";

/** Version stamp for the Overpass query pair (main + wide). */
export const PACK_QUERY_VERSION = "overpass-queries-1";

/** Default freshness window for stale-while-revalidate reads.
 *  A ready pack older than this still serves, but a read enqueues
 *  a coalesced refresh. Policy constant, not a per-call choice. */
export const PACK_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/** Default build-lease TTL. A builder that stops heartbeating
 *  loses the lease at expiry and another builder may steal it. */
export const PACK_LEASE_TTL_MS = 10 * 60 * 1000;

/** Default TTL for a forecast weather snapshot to be reused for the
 *  same destination + date range (historical snapshots never expire
 *  for reuse — the past does not change). */
export const WEATHER_FORECAST_TTL_MS = 6 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Stored candidate rows                                               */
/* ------------------------------------------------------------------ */

/**
 * The normalized candidate row as stored inside a pack version.
 * This is the storage shape; CandidateDTO (types.ts) is the boundary
 * read shape and `packs/builder.ts` converts between the two.
 * `candidateKey` is the Phase 1 source key ("osm:node/283264348");
 * `osmKey` is the shadow solver key ("node/283264348") — the engine
 * keys items by it, so the row carries both rather than deriving one
 * from the other at solve time.
 */
export interface StoredCandidate {
  candidateKey: string;
  osmKey: string;
  kind: string;
  name: string;
  nameEn: string | null;
  pos: { lat: number; lon: number } | null;
  hoursRaw: string | null;
  tags: Record<string, string>;
  url: string;
  /** Google enrichment record attached to this candidate, or null.
   *  In the shadow fixtures this rides as `google` on the candidate;
   *  production Phase 4 writes it as a separate versioned record on
   *  the candidate row (M7 candidates.enrichment) — never a free
   *  mutation of the POI fields. */
  enrichment: StoredEnrichment | null;
}

/** A distance-gate REJECTION kept as provenance on the candidate row
 *  (Phase 4, CONTRACTS.md match gate): the search hit another business
 *  (or could not be verified), so NO details were attached — the
 *  rejection itself is the record. A candidate whose enrichment record
 *  carries `matchRejected` has no Google data, only this verdict. */
export interface StoredMatchRejection {
  /** The gate's rejection vocabulary (places/types.ts
   *  MatchRejectionReason — the same union, declared here so the
   *  storage contract stands alone). */
  reason: "distance-gate" | "no-results" | "no-location-returned" | "candidate-position-unknown";
  matchedName: string | null;
  placeId: string | null;
  distanceKm: number | null;
  thresholdKm: number;
}

/** The enrichment payload as stored on a candidate row: the engine's
 *  google shape plus the Place ID the boundary DTO requires
 *  (GoogleEnrichmentDTO.placeId — an external identifier only). */
export interface StoredEnrichment extends EngineGoogleData {
  placeId?: string | null;
  /** Phase 4: how far the verified match sits from the OSM point, km
   *  (the gate record — provenance, ported from the shadow's
   *  normalizeDetails). Null on rejection records. */
  matchDistanceKm?: number | null;
  /** Phase 4: set when this record is a distance-gate REJECTION
   *  rather than an enrichment (see StoredMatchRejection). */
  matchRejected?: StoredMatchRejection | null;
  /** Phase 4: the Places ledger operation key that produced this
   *  record (the committed Place Details operation, or the committed
   *  Text Search operation for a rejection) — the audit link from
   *  the record back to the reserve/commit/release trail. */
  operationKey?: string | null;
}

/* ------------------------------------------------------------------ */
/* Pack versions                                                       */
/* ------------------------------------------------------------------ */

export interface PackVersionRecord {
  /** The Phase 1 boundary DTO for this version. */
  dto: DestinationPackDTO;
  /** Per-destination monotonic version number, starting at 1. */
  version: number;
  /** The version this one replaced, or null for the first build. */
  supersedesPackVersionId: string | null;
  /** SHA-256 over the canonical JSON of the candidate rows' BASE
   *  layer (enrichment excluded — it is a separate versioned record,
   *  Phase 4) — the immutability witness: a pinned read
   *  recomputes/compares it. */
  contentHash: string | null;
  /** The build job that produced this version (provenance). */
  buildJobId: string | null;
}

/* ------------------------------------------------------------------ */
/* Weather snapshots — the separate layer                              */
/* ------------------------------------------------------------------ */

export type WeatherSnapshotKind = "forecast" | "historical";

export interface WeatherSnapshotRecord {
  snapshotId: string;
  destinationId: string;
  /** Provider name, verbatim ("open-meteo"). */
  provider: string;
  /** Forecast and historical weather are DIFFERENT artifacts and
   *  are never substituted for one another: the plan reads the
   *  forecast; the post-trip library reads the historical snapshot. */
  kind: WeatherSnapshotKind;
  startDate: LocalDate;
  endDate: LocalDate;
  /** When this snapshot was fetched (instant). A snapshot is a
   *  fetch event: its as-of time is part of what it claims. */
  fetchedAt: UtcInstant;
  days: EngineWeatherDay[];
  provenance: ProvenanceDTO;
}

/* ------------------------------------------------------------------ */
/* Build queue + leases                                                */
/* ------------------------------------------------------------------ */

export type BuildJobStatus = "queued" | "building" | "done" | "failed";
export const BUILD_JOB_STATUSES: readonly BuildJobStatus[] = [
  "queued",
  "building",
  "done",
  "failed"
];

export interface BuildLease {
  workerId: string;
  /** Fencing token: minted at claim, rotated at every steal. A
   *  publish must present the CURRENT leaseId for its job. */
  leaseId: string;
  /** Monotonic per job: 1 at first claim, +1 at every steal. */
  epoch: number;
  acquiredAt: UtcInstant;
  expiresAt: UtcInstant;
}

export interface BuildJobRecord {
  jobId: string;
  destinationId: string;
  /** Why the build was requested ("seed", "refresh", "cold-read",
   *  "manual", "live-proof", ...). Provenance, never logic. */
  reason: string;
  status: BuildJobStatus;
  requestedAt: UtcInstant;
  startedAt: UtcInstant | null;
  finishedAt: UtcInstant | null;
  lease: BuildLease | null;
  /** How many requests coalesced onto this job (>= 1). */
  coalescedRequests: number;
  resultPackVersionId: string | null;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/* Generation pins                                                     */
/* ------------------------------------------------------------------ */

export interface PackPinRecord {
  /** The generation's own reference (generation job / trip ref). */
  generationRef: string;
  packVersionId: string;
  pinnedAt: UtcInstant;
}

/* ------------------------------------------------------------------ */
/* Serving reads (stale-while-revalidate)                              */
/* ------------------------------------------------------------------ */

export type ServingPackResult =
  | {
      state: "ready";
      pack: PackVersionRecord;
      /** True when the served version is past the freshness window
       *  and a refresh has been enqueued behind it. */
      stale: boolean;
      refreshJobId: string | null;
    }
  | {
      /** No ready version exists. NOTHING is fabricated: the caller
       *  gets the pending state and the build job that will produce
       *  the first version. A customer request never waits on this. */
      state: "pending";
      pack: null;
      job: BuildJobRecord;
    };

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type PackStoreErrorCode =
  | "UNKNOWN_DESTINATION"
  | "DUPLICATE_DESTINATION"
  | "VERSION_NOT_FOUND"
  | "VERSION_NOT_BUILDING"
  | "JOB_NOT_FOUND"
  | "JOB_NOT_CLAIMABLE"
  | "LEASE_LOST"
  | "LEASE_EXPIRED"
  | "CANDIDATE_NOT_FOUND"
  | "PIN_NOT_FOUND";

export class PackStoreError extends Error {
  readonly code: PackStoreErrorCode;
  constructor(code: PackStoreErrorCode, message: string) {
    super(message);
    this.name = "PackStoreError";
    this.code = code;
  }
}

/** The injected clock every service in this package reads time from.
 *  Production uses the real clock; proofs drive a fake one so lease
 *  expiry and staleness are asserted without waiting. */
export type PackClock = () => Date;

export const systemPackClock: PackClock = () => new Date();

export function toInstant(date: Date): UtcInstant {
  return date.toISOString() as UtcInstant;
}

export type { CandidateDTO, DestinationDTO, DestinationPackDTO };
