import { contentId, sha256Hex } from "@/lib/roamly/engine/ids";
import type { DestinationDTO } from "@/lib/roamly/engine/types";
import type {
  BuildJobRecord,
  BuildLease,
  PackClock,
  PackPinRecord,
  PackVersionRecord,
  StoredCandidate,
  StoredEnrichment,
  WeatherSnapshotRecord
} from "@/lib/roamly/engine/packs/types";
import { PackStoreError, systemPackClock, toInstant } from "@/lib/roamly/engine/packs/types";

/*
 * PackStore — the persistence contract for the pack data plane
 * (DESIGN-PRODUCTION.md §2.2: "State lives in the database").
 *
 * The interface is the boundary the builder, the queue worker, and
 * (in Phase 5) the generation job consume. Two implementations are
 * expected over the program's life:
 *   - InMemoryPackStore (this file) — the reference implementation
 *     that DEFINES the semantics and carries the Phase 3 proof. It
 *     enforces every invariant in packs/types.ts (I1–I4) exactly as
 *     the database implementation must.
 *   - the Supabase implementation over M7's tables, written when M7
 *     is applied (migrations are applied manually, in a later
 *     phase): each method below maps to the table operations named
 *     in the M7 file's comments, and the lease claim/publish checks
 *     map to single conditional UPDATEs (the PR #60 lease/CAS
 *     discipline). Until then nothing in production reads packs
 *     (Phase 5 is the first consumer), so the semantics are proven
 *     here, against the contract, first.
 *
 * All reads return deep clones: a caller can never mutate stored
 * state through a returned record (I1 is enforced structurally,
 * not by convention).
 */

export interface PackStore {
  /* Registry */
  registerDestination(destination: DestinationDTO): Promise<DestinationDTO>;
  getDestination(destinationId: string): Promise<DestinationDTO | null>;
  listDestinations(): Promise<DestinationDTO[]>;

  /* Build queue + leases (I3) */
  /** Enqueue a build, coalescing onto the live (queued|building)
   *  job for the destination when one exists. */
  enqueueBuild(destinationId: string, reason: string): Promise<{ job: BuildJobRecord; coalesced: boolean }>;
  getBuildJob(jobId: string): Promise<BuildJobRecord | null>;
  listBuildJobs(destinationId?: string): Promise<BuildJobRecord[]>;
  /** Claim a queued job (or steal a building job whose lease has
   *  expired) for a worker. Returns null when nothing is claimable. */
  claimBuild(jobId: string, workerId: string, leaseTtlMs: number): Promise<BuildLease | null>;
  /** Extend the lease; throws LEASE_LOST when the caller no longer
   *  holds it (stolen or expired-and-stolen). */
  heartbeatBuild(jobId: string, leaseId: string, leaseTtlMs: number): Promise<BuildLease>;
  failBuild(jobId: string, leaseId: string, error: string): Promise<BuildJobRecord>;
  /** Release a claimed job back to "queued" under its lease fencing
   *  token, WITHOUT recording a failure. The distinct honest outcome
   *  for "the holder yielded": the job is live and re-drainable,
   *  the lease is cleared, and the cron's drain (which only feeds
   *  queued jobs) can reclaim it. Returns null when the job is not
   *  building under the presented lease (claimed under us), and
   *  throws JOB_NOT_FOUND for an unknown job.
   *
   *  Two callers: (a) the kick-scoped build budget — runBuildJob
   *  releases its own still-live lease when the collector outlasts
   *  the kick's function budget, so a metro-scale build can never
   *  be hard-killed mid-claim (the 2026-10-22/23 Lisbon kill loop);
   *  (b) the kick's expired-lease recycle — a "building" job whose
   *  lease expired is yielded back to the queue instead of being
   *  stolen, so dead jobs never need a steal to become visible to
   *  the drain again. */
  releaseBuild(jobId: string, leaseId: string): Promise<BuildJobRecord | null>;

  /* Versions (I1) */
  /** Create the next version row in status "building", bound to a
   *  claimed job + its current lease. */
  beginVersion(jobId: string, leaseId: string, classifierVersion: string, schemaVersion: number): Promise<PackVersionRecord>;
  /** Publish a building version: writes its candidate rows, stamps
   *  builtAt + contentHash, flips it to "ready", supersedes the
   *  previous ready version (the ONLY mutation an old version ever
   *  sees), and completes the job. Refused (LEASE_LOST) when the
   *  job's lease was stolen after beginVersion.
   *  classifierVersionRestamp (optional): beginVersion stamps the
   *  default classifier version before collection runs, because
   *  the lease/fencing flow needs the version row to exist; which
   *  lane actually served the build is only known afterwards.
   *  When the caller passes a restamp, the published DTO's
   *  classifierVersion is corrected to it (the Open Places
   *  fallback lane passes OPEN_PLACES_CLASSIFIER_VERSION). The
   *  packVersionId is NOT recomputed — it is the opaque id minted
   *  at beginVersion. Omitted = the stamped version stands. */
  publishVersion(
    packVersionId: string,
    jobId: string,
    leaseId: string,
    candidates: StoredCandidate[],
    provenance: PackVersionRecord["dto"]["provenance"],
    classifierVersionRestamp?: string
  ): Promise<PackVersionRecord>;
  failVersion(packVersionId: string, jobId: string, leaseId: string, error: string): Promise<PackVersionRecord>;
  getVersion(packVersionId: string): Promise<PackVersionRecord | null>;
  getVersionCandidates(packVersionId: string): Promise<StoredCandidate[]>;
  /** The currently-serving version: latest "ready", never a
   *  superseded one. Null when the destination has none. */
  getReadyVersion(destinationId: string): Promise<PackVersionRecord | null>;
  listVersions(destinationId: string): Promise<PackVersionRecord[]>;

  /* Generation pins (I2) */
  pinVersion(generationRef: string, packVersionId: string): Promise<PackPinRecord>;
  getPin(generationRef: string): Promise<PackPinRecord | null>;
  /** Read a pinned version's full content (record + candidates).
   *  Returns exactly the version that was pinned, whatever has
   *  been built since. */
  readPinned(packVersionId: string): Promise<{ version: PackVersionRecord; candidates: StoredCandidate[] } | null>;

  /* Enrichment write-back (Phase 4) */
  /** Write the Google enrichment record (or a recorded distance-gate
   *  rejection) for ONE candidate of a published version. This is the
   *  ONLY post-publish write a version's rows ever see, and it is
   *  confined to the candidate's `enrichment` field: the base POI
   *  layer (candidateKey/osmKey/kind/name/pos/hoursRaw/tags/url) is
   *  never touched, so the version's contentHash — computed over the
   *  base layer — stands. Throws VERSION_NOT_FOUND /
   *  CANDIDATE_NOT_FOUND. */
  putCandidateEnrichment(
    packVersionId: string,
    candidateKey: string,
    enrichment: StoredEnrichment | null
  ): Promise<StoredCandidate>;

  /* Weather snapshots (separate layer) */
  putWeatherSnapshot(snapshot: WeatherSnapshotRecord): Promise<WeatherSnapshotRecord>;
  /** The freshest snapshot for (destination, kind, range), or null.
   *  Kinds never substitute for one another. */
  getWeatherSnapshot(
    destinationId: string,
    kind: WeatherSnapshotRecord["kind"],
    startDate: string,
    endDate: string
  ): Promise<WeatherSnapshotRecord | null>;
  listWeatherSnapshots(destinationId: string): Promise<WeatherSnapshotRecord[]>;
}

/* ------------------------------------------------------------------ */

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .filter(([, val]) => val !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : v
  );
}

/** The version's immutability witness: SHA-256 over the canonical
 *  JSON of the candidates' BASE layer. The Google enrichment record
 *  is deliberately EXCLUDED: it is a separate versioned record on the
 *  candidate (DESIGN §2.2) with its own fetchedAt/refresh discipline
 *  and ledger operation trail (Phase 4), written after publish by
 *  putCandidateEnrichment — the base POI layer it annotates is what
 *  must never move under a pin, and it is what this hash witnesses.
 *  (Phase 3 published with the enrichment slot empty or seed-carried;
 *  its stability assertions compare this function's output across
 *  time, and both sides use this same definition.) */
export function candidateContentHash(candidates: readonly StoredCandidate[]): string {
  const baseLayer = candidates.map((c) => {
    const { enrichment, ...base } = c;
    void enrichment;
    return base;
  });
  return sha256Hex(canonicalJson(baseLayer));
}

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryPackStore implements PackStore {
  private readonly clock: PackClock;
  private readonly destinations = new Map<string, DestinationDTO>();
  private readonly jobs = new Map<string, BuildJobRecord>();
  private readonly versions = new Map<string, PackVersionRecord>();
  private readonly candidatesByVersion = new Map<string, StoredCandidate[]>();
  private readonly pins = new Map<string, PackPinRecord>();
  private readonly weather: WeatherSnapshotRecord[] = [];
  private jobSeq = 0;

  constructor(clock: PackClock = systemPackClock) {
    this.clock = clock;
  }

  private now(): Date {
    return this.clock();
  }

  private nowInstant(): string {
    return toInstant(this.now());
  }

  /* ------------------------------ registry ------------------------------ */

  async registerDestination(destination: DestinationDTO): Promise<DestinationDTO> {
    if (this.destinations.has(destination.destinationId)) {
      throw new PackStoreError("DUPLICATE_DESTINATION", `destination already registered: ${destination.destinationId}`);
    }
    this.destinations.set(destination.destinationId, clone(destination));
    return clone(destination);
  }

  async getDestination(destinationId: string): Promise<DestinationDTO | null> {
    const d = this.destinations.get(destinationId);
    return d ? clone(d) : null;
  }

  async listDestinations(): Promise<DestinationDTO[]> {
    return [...this.destinations.values()].map((d) => clone(d));
  }

  /* ------------------------------ queue ------------------------------ */

  private liveJobFor(destinationId: string): BuildJobRecord | null {
    for (const job of this.jobs.values()) {
      if (job.destinationId === destinationId && (job.status === "queued" || job.status === "building")) return job;
    }
    return null;
  }

  async enqueueBuild(destinationId: string, reason: string): Promise<{ job: BuildJobRecord; coalesced: boolean }> {
    if (!this.destinations.has(destinationId)) {
      throw new PackStoreError("UNKNOWN_DESTINATION", `cannot enqueue a build for unregistered destination ${destinationId}`);
    }
    const live = this.liveJobFor(destinationId);
    if (live) {
      live.coalescedRequests += 1;
      return { job: clone(live), coalesced: true };
    }
    this.jobSeq += 1;
    const job: BuildJobRecord = {
      jobId: contentId("packjob", [destinationId, this.jobSeq, this.nowInstant()]),
      destinationId,
      reason,
      status: "queued",
      requestedAt: this.nowInstant(),
      startedAt: null,
      finishedAt: null,
      lease: null,
      coalescedRequests: 1,
      resultPackVersionId: null,
      error: null
    };
    this.jobs.set(job.jobId, job);
    return { job: clone(job), coalesced: false };
  }

  async getBuildJob(jobId: string): Promise<BuildJobRecord | null> {
    const job = this.jobs.get(jobId);
    return job ? clone(job) : null;
  }

  async listBuildJobs(destinationId?: string): Promise<BuildJobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => destinationId === undefined || j.destinationId === destinationId)
      .map((j) => clone(j));
  }

  async claimBuild(jobId: string, workerId: string, leaseTtlMs: number): Promise<BuildLease | null> {
    const job = this.jobs.get(jobId);
    if (!job) throw new PackStoreError("JOB_NOT_FOUND", `no build job ${jobId}`);
    const nowMs = this.now().getTime();
    if (job.status === "queued") {
      const lease: BuildLease = {
        workerId,
        leaseId: contentId("packlease", [jobId, 1, this.nowInstant()]),
        epoch: 1,
        acquiredAt: this.nowInstant(),
        expiresAt: toInstant(new Date(nowMs + leaseTtlMs))
      };
      job.status = "building";
      job.startedAt = this.nowInstant();
      job.lease = lease;
      return clone(lease);
    }
    if (job.status === "building" && job.lease && new Date(job.lease.expiresAt).getTime() <= nowMs) {
      // Steal: the previous holder stopped heartbeating past expiry.
      // The fencing token rotates and the epoch increments, so the
      // old holder's publish will be refused (LEASE_LOST).
      const epoch = job.lease.epoch + 1;
      const lease: BuildLease = {
        workerId,
        leaseId: contentId("packlease", [jobId, epoch, this.nowInstant()]),
        epoch,
        acquiredAt: this.nowInstant(),
        expiresAt: toInstant(new Date(nowMs + leaseTtlMs))
      };
      job.lease = lease;
      return clone(lease);
    }
    return null; // claimable by nobody right now: held, done, or failed
  }

  private requireHeldLease(jobId: string, leaseId: string): BuildJobRecord {
    const job = this.jobs.get(jobId);
    if (!job) throw new PackStoreError("JOB_NOT_FOUND", `no build job ${jobId}`);
    if (job.status !== "building" || !job.lease || job.lease.leaseId !== leaseId) {
      throw new PackStoreError("LEASE_LOST", `job ${jobId} is no longer held by lease ${leaseId}`);
    }
    if (new Date(job.lease.expiresAt).getTime() <= this.now().getTime()) {
      throw new PackStoreError("LEASE_EXPIRED", `lease for job ${jobId} expired at ${job.lease.expiresAt}`);
    }
    return job;
  }

  async heartbeatBuild(jobId: string, leaseId: string, leaseTtlMs: number): Promise<BuildLease> {
    const job = this.jobs.get(jobId);
    if (!job) throw new PackStoreError("JOB_NOT_FOUND", `no build job ${jobId}`);
    if (job.status !== "building" || !job.lease || job.lease.leaseId !== leaseId) {
      throw new PackStoreError("LEASE_LOST", `job ${jobId} is no longer held by lease ${leaseId}`);
    }
    // A heartbeat from the current holder is accepted even at the
    // expiry edge (proof the holder is alive); a STOLEN lease means
    // the leaseId no longer matches, which is the LEASE_LOST above.
    job.lease = { ...job.lease, expiresAt: toInstant(new Date(this.now().getTime() + leaseTtlMs)) };
    return clone(job.lease);
  }

  async failBuild(jobId: string, leaseId: string, error: string): Promise<BuildJobRecord> {
    const job = this.requireHeldLease(jobId, leaseId);
    job.status = "failed";
    job.error = error;
    job.finishedAt = this.nowInstant();
    job.lease = null;
    return clone(job);
  }

  async releaseBuild(jobId: string, leaseId: string): Promise<BuildJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job) throw new PackStoreError("JOB_NOT_FOUND", `no build job ${jobId}`);
    if (job.status !== "building" || !job.lease || job.lease.leaseId !== leaseId) {
      // Not building under this lease (released, stolen, or done
      // under us): the caller yields, nothing to do.
      return null;
    }
    // The holder yields voluntarily (kick budget) or the kick
    // recycles a dead holder's job (expired lease, see kick.ts):
    // the job goes back to "queued" with no failure recorded, the
    // lease is cleared, and the drain can reclaim it. The
    // "building"-status version row (if beginVersion ran) stays
    // abandoned exactly as today's steal path leaves it — the
    // next claim begins a fresh version.
    job.status = "queued";
    job.lease = null;
    return clone(job);
  }

  /* ------------------------------ versions ------------------------------ */

  async beginVersion(
    jobId: string,
    leaseId: string,
    classifierVersion: string,
    schemaVersion: number
  ): Promise<PackVersionRecord> {
    const job = this.requireHeldLease(jobId, leaseId);
    const siblings = [...this.versions.values()].filter((v) => v.dto.destinationId === job.destinationId);
    const version = siblings.length + 1;
    const packVersionId = contentId("packv", [job.destinationId, version, classifierVersion, schemaVersion]);
    const record: PackVersionRecord = {
      dto: {
        packVersionId,
        destinationId: job.destinationId,
        schemaVersion,
        classifierVersion,
        status: "building",
        builtAt: null,
        counts: { candidates: 0, byKind: {} },
        provenance: { source: "pack-builder", sourceRef: jobId, recordedAt: this.nowInstant(), label: "build in progress" }
      },
      version,
      supersedesPackVersionId: null,
      contentHash: null,
      buildJobId: jobId
    };
    this.versions.set(packVersionId, record);
    this.candidatesByVersion.set(packVersionId, []);
    return clone(record);
  }

  async publishVersion(
    packVersionId: string,
    jobId: string,
    leaseId: string,
    candidates: StoredCandidate[],
    provenance: PackVersionRecord["dto"]["provenance"],
    classifierVersionRestamp?: string
  ): Promise<PackVersionRecord> {
    // The fencing check comes FIRST: a stolen lease refuses the
    // publish no matter what state the version row is in (I3).
    const job = this.requireHeldLease(jobId, leaseId);
    const record = this.versions.get(packVersionId);
    if (!record) throw new PackStoreError("VERSION_NOT_FOUND", `no pack version ${packVersionId}`);
    if (record.dto.status !== "building") {
      throw new PackStoreError("VERSION_NOT_BUILDING", `pack version ${packVersionId} is ${record.dto.status}, not building`);
    }
    if (record.buildJobId !== jobId) {
      throw new PackStoreError("VERSION_NOT_BUILDING", `pack version ${packVersionId} belongs to job ${record.buildJobId}, not ${jobId}`);
    }
    const previousReady = [...this.versions.values()].find(
      (v) => v.dto.destinationId === record.dto.destinationId && v.dto.status === "ready"
    );
    const byKind: Record<string, number> = {};
    for (const c of candidates) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
    const stored = clone(candidates);
    this.candidatesByVersion.set(packVersionId, stored);
    record.dto = {
      ...record.dto,
      status: "ready",
      builtAt: this.nowInstant(),
      counts: { candidates: stored.length, byKind },
      provenance: clone(provenance),
      ...(classifierVersionRestamp ? { classifierVersion: classifierVersionRestamp } : {})
    };
    record.contentHash = candidateContentHash(stored);
    record.supersedesPackVersionId = previousReady ? previousReady.dto.packVersionId : null;
    if (previousReady) {
      // The ONLY mutation an already-published version ever sees
      // (invariant I1): its lifecycle status flips to superseded.
      previousReady.dto = { ...previousReady.dto, status: "superseded" };
    }
    job.status = "done";
    job.resultPackVersionId = packVersionId;
    job.finishedAt = this.nowInstant();
    job.lease = null;
    return clone(record);
  }

  async failVersion(packVersionId: string, jobId: string, leaseId: string, error: string): Promise<PackVersionRecord> {
    const job = this.requireHeldLease(jobId, leaseId);
    const record = this.versions.get(packVersionId);
    if (!record) throw new PackStoreError("VERSION_NOT_FOUND", `no pack version ${packVersionId}`);
    record.dto = { ...record.dto, status: "failed" };
    job.status = "failed";
    job.error = error;
    job.finishedAt = this.nowInstant();
    job.lease = null;
    return clone(record);
  }

  async getVersion(packVersionId: string): Promise<PackVersionRecord | null> {
    const v = this.versions.get(packVersionId);
    return v ? clone(v) : null;
  }

  async getVersionCandidates(packVersionId: string): Promise<StoredCandidate[]> {
    if (!this.versions.has(packVersionId)) {
      throw new PackStoreError("VERSION_NOT_FOUND", `no pack version ${packVersionId}`);
    }
    return clone(this.candidatesByVersion.get(packVersionId) || []);
  }

  async getReadyVersion(destinationId: string): Promise<PackVersionRecord | null> {
    const ready = [...this.versions.values()]
      .filter((v) => v.dto.destinationId === destinationId && v.dto.status === "ready")
      .sort((a, b) => b.version - a.version)[0];
    return ready ? clone(ready) : null;
  }

  async listVersions(destinationId: string): Promise<PackVersionRecord[]> {
    return [...this.versions.values()]
      .filter((v) => v.dto.destinationId === destinationId)
      .sort((a, b) => a.version - b.version)
      .map((v) => clone(v));
  }

  /* ------------------------------ pins ------------------------------ */

  async pinVersion(generationRef: string, packVersionId: string): Promise<PackPinRecord> {
    const version = this.versions.get(packVersionId);
    if (!version) throw new PackStoreError("VERSION_NOT_FOUND", `cannot pin unknown pack version ${packVersionId}`);
    const pin: PackPinRecord = { generationRef, packVersionId, pinnedAt: this.nowInstant() };
    this.pins.set(generationRef, pin);
    return clone(pin);
  }

  async getPin(generationRef: string): Promise<PackPinRecord | null> {
    const pin = this.pins.get(generationRef);
    return pin ? clone(pin) : null;
  }

  async readPinned(
    packVersionId: string
  ): Promise<{ version: PackVersionRecord; candidates: StoredCandidate[] } | null> {
    const version = this.versions.get(packVersionId);
    if (!version) return null;
    return { version: clone(version), candidates: clone(this.candidatesByVersion.get(packVersionId) || []) };
  }

  /* ------------------------------ enrichment ------------------------------ */

  async putCandidateEnrichment(
    packVersionId: string,
    candidateKey: string,
    enrichment: StoredEnrichment | null
  ): Promise<StoredCandidate> {
    if (!this.versions.has(packVersionId)) {
      throw new PackStoreError("VERSION_NOT_FOUND", `no pack version ${packVersionId}`);
    }
    const rows = this.candidatesByVersion.get(packVersionId) || [];
    const row = rows.find((c) => c.candidateKey === candidateKey);
    if (!row) {
      throw new PackStoreError("CANDIDATE_NOT_FOUND", `pack version ${packVersionId} has no candidate ${candidateKey}`);
    }
    // The enrichment field is the ONLY field written here — the base
    // POI layer (and the version's contentHash over it) never moves.
    row.enrichment = enrichment ? clone(enrichment) : null;
    return clone(row);
  }

  /* ------------------------------ weather ------------------------------ */

  async putWeatherSnapshot(snapshot: WeatherSnapshotRecord): Promise<WeatherSnapshotRecord> {
    if (!this.destinations.has(snapshot.destinationId)) {
      throw new PackStoreError("UNKNOWN_DESTINATION", `weather for unregistered destination ${snapshot.destinationId}`);
    }
    this.weather.push(clone(snapshot));
    return clone(snapshot);
  }

  async getWeatherSnapshot(
    destinationId: string,
    kind: WeatherSnapshotRecord["kind"],
    startDate: string,
    endDate: string
  ): Promise<WeatherSnapshotRecord | null> {
    const matches = this.weather
      .filter((w) => w.destinationId === destinationId && w.kind === kind && w.startDate === startDate && w.endDate === endDate)
      .sort((a, b) => (a.fetchedAt < b.fetchedAt ? 1 : -1));
    return matches[0] ? clone(matches[0]) : null;
  }

  async listWeatherSnapshots(destinationId: string): Promise<WeatherSnapshotRecord[]> {
    return this.weather.filter((w) => w.destinationId === destinationId).map((w) => clone(w));
  }
}
