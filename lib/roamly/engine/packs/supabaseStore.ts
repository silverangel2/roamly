import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentId } from "@/lib/roamly/engine/ids";
import type { DestinationDTO } from "@/lib/roamly/engine/types";
import type { PackStore } from "@/lib/roamly/engine/packs/store";
import { candidateContentHash } from "@/lib/roamly/engine/packs/store";
import { PRODUCTION_DESTINATION_SEEDS } from "@/lib/roamly/engine/packs/destinations";
import type {
  BuildJobRecord,
  BuildLease,
  PackPinRecord,
  PackVersionRecord,
  StoredCandidate,
  StoredEnrichment,
  WeatherSnapshotRecord
} from "@/lib/roamly/engine/packs/types";
import { PackStoreError, systemPackClock, toInstant, type PackClock } from "@/lib/roamly/engine/packs/types";

/*
 * SupabasePackStore — the production PackStore over M7's tables
 * (supabase/migrations/20261022_roamly_destination_packs.sql), landed
 * with the 2026-10-22 production ship (SHIP-MANIFEST §4 step 4). It
 * implements the exact contract InMemoryPackStore defines, with the
 * M7 header's mapping:
 *
 *   - the claim is conditional UPDATEs guarded by the job's current
 *     status (and, for a steal, its current lease_id + epoch): the
 *     update matches zero rows when the job moved under us, which is
 *     the PR #60 lease/CAS discipline expressed through PostgREST;
 *   - publish is guarded by requireHeldLease BEFORE any write (a
 *     stolen lease refuses the publish, I3), then writes candidate
 *     rows, flips the new version to "ready", flips the previous
 *     "ready" version to "superseded" (the only mutation a published
 *     version ever sees, I1), and completes the job pointing at the
 *     version row;
 *   - reads return freshly mapped records (the deep-clone guarantee
 *     of the in-memory store is structural here: rows are re-read
 *     from the database, never shared by reference).
 *
 * Two contract corners have no M7 table BY DESIGN, and ride the
 * house key-value store instead (DATA-INFRA §5, the same pattern the
 * places ledger uses):
 *
 *   - the destination REGISTRY is application state (M7: "the
 *     registry itself is application state, so there is deliberately
 *     no registry table"). The registry this store serves is the
 *     compiled-in seed registry (packs/destinations.ts) plus any
 *     destinations registered into this instance at runtime
 *     (registerDestination — process-lifetime, exactly the lifetime
 *     a seeding run needs; nothing in the serving path registers).
 *   - generation PINS ride `roamly_admin_settings` under
 *     `pack_pin:v1:<generationRef>` — durable across processes,
 *     which is the property the generation seam actually needs (a
 *     trip's stages advance in separate worker wakes).
 *
 * Candidate reads come back ordered by candidate_key: a total,
 * stable order (candidate keys are unique per version), so a pinned
 * read is byte-stable across wakes. Consumers key candidates by
 * candidateKey/osmKey or partition by kind; no consumer depends on
 * collection order.
 *
 * The client MUST be the service-role admin client: M7's tables are
 * service-role only under RLS (packs are system data; travelers
 * never query them). buildEngineRuntimeDeps enforces this.
 */

const BUILDS_TABLE = "roamly_destination_pack_builds";
const PACKS_TABLE = "roamly_destination_packs";
const CANDIDATES_TABLE = "roamly_destination_candidates";
const WEATHER_TABLE = "roamly_destination_weather_snapshots";
const SETTINGS_TABLE = "roamly_admin_settings";

const CANDIDATE_INSERT_CHUNK = 200;
const CAS_ATTEMPTS = 6;

interface BuildRow {
  job_id: string;
  destination_id: string;
  reason: string;
  status: BuildJobRecord["status"];
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  lease_worker_id: string | null;
  lease_id: string | null;
  lease_epoch: number | null;
  lease_expires_at: string | null;
  coalesced_requests: number;
  result_pack_id: string | null;
  error: string | null;
  updated_at: string;
}

interface PackRow {
  id: string;
  pack_version_id: string;
  destination_id: string;
  version: number;
  schema_version: number;
  classifier_version: string;
  status: PackVersionRecord["dto"]["status"];
  built_at: string | null;
  candidate_count: number;
  counts_by_kind: Record<string, number>;
  content_hash: string | null;
  supersedes_pack_version_id: string | null;
  build_job_id: string | null;
  provenance: PackVersionRecord["dto"]["provenance"];
}

interface CandidateRow {
  candidate_key: string;
  osm_key: string;
  kind: string;
  name: string;
  name_en: string | null;
  lat: number | null;
  lon: number | null;
  hours_raw: string | null;
  tags: Record<string, string>;
  url: string | null;
  enrichment: StoredEnrichment | null;
}

interface WeatherRow {
  snapshot_id: string;
  destination_id: string;
  provider: string;
  kind: WeatherSnapshotRecord["kind"];
  start_date: string;
  end_date: string;
  fetched_at: string;
  days: WeatherSnapshotRecord["days"];
  provenance: WeatherSnapshotRecord["provenance"];
}

const clone = <T>(value: T): T => structuredClone(value);

function dbFailure(context: string, error: { message: string }): Error {
  return new Error(`SupabasePackStore ${context}: ${error.message}`);
}

export class SupabasePackStore implements PackStore {
  private readonly client: SupabaseClient;
  private readonly clock: PackClock;
  private readonly registered = new Map<string, DestinationDTO>();

  constructor(client: SupabaseClient, clock: PackClock = systemPackClock) {
    this.client = client;
    this.clock = clock;
    for (const seed of PRODUCTION_DESTINATION_SEEDS) this.registered.set(seed.destinationId, clone(seed));
  }

  private now(): Date {
    return this.clock();
  }

  private nowInstant(): string {
    return toInstant(this.now());
  }

  /* ------------------------------ registry ------------------------------ */

  async registerDestination(destination: DestinationDTO): Promise<DestinationDTO> {
    if (this.registered.has(destination.destinationId)) {
      throw new PackStoreError("DUPLICATE_DESTINATION", `destination already registered: ${destination.destinationId}`);
    }
    this.registered.set(destination.destinationId, clone(destination));
    return clone(destination);
  }

  async getDestination(destinationId: string): Promise<DestinationDTO | null> {
    const d = this.registered.get(destinationId);
    return d ? clone(d) : null;
  }

  async listDestinations(): Promise<DestinationDTO[]> {
    return [...this.registered.values()].map((d) => clone(d));
  }

  /* ------------------------------ row mapping ------------------------------ */

  private async resultVersionId(packRowId: string | null): Promise<string | null> {
    if (!packRowId) return null;
    const { data, error } = await this.client
      .from(PACKS_TABLE)
      .select("pack_version_id")
      .eq("id", packRowId)
      .maybeSingle();
    if (error) throw dbFailure("resolve result pack", error);
    const row = data as { pack_version_id: string } | null;
    return row ? row.pack_version_id : null;
  }

  private async mapJob(row: BuildRow): Promise<BuildJobRecord> {
    return {
      jobId: row.job_id,
      destinationId: row.destination_id,
      reason: row.reason,
      status: row.status,
      requestedAt: row.requested_at as BuildJobRecord["requestedAt"],
      startedAt: row.started_at as BuildJobRecord["startedAt"],
      finishedAt: row.finished_at as BuildJobRecord["finishedAt"],
      lease:
        row.lease_id && row.lease_worker_id && row.lease_expires_at
          ? {
              workerId: row.lease_worker_id,
              leaseId: row.lease_id,
              epoch: row.lease_epoch ?? 1,
              // M7 carries no lease-acquired column; the row's
              // updated_at is stamped by trigger at claim time and
              // is the closest durable witness. Expiry — the field
              // every decision reads — is exact.
              acquiredAt: row.updated_at as BuildLease["acquiredAt"],
              expiresAt: row.lease_expires_at as BuildLease["expiresAt"]
            }
          : null,
      coalescedRequests: row.coalesced_requests,
      resultPackVersionId: await this.resultVersionId(row.result_pack_id),
      error: row.error
    };
  }

  private mapVersion(row: PackRow): PackVersionRecord {
    return {
      dto: {
        packVersionId: row.pack_version_id,
        destinationId: row.destination_id,
        schemaVersion: row.schema_version,
        classifierVersion: row.classifier_version,
        status: row.status,
        builtAt: row.built_at as PackVersionRecord["dto"]["builtAt"],
        counts: { candidates: row.candidate_count, byKind: row.counts_by_kind },
        provenance: row.provenance
      },
      version: row.version,
      supersedesPackVersionId: row.supersedes_pack_version_id,
      contentHash: row.content_hash,
      buildJobId: row.build_job_id
    };
  }

  private mapCandidate(row: CandidateRow): StoredCandidate {
    return {
      candidateKey: row.candidate_key,
      osmKey: row.osm_key,
      kind: row.kind,
      name: row.name,
      nameEn: row.name_en,
      pos: row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : null,
      hoursRaw: row.hours_raw,
      tags: row.tags,
      url: row.url ?? "",
      enrichment: row.enrichment
    };
  }

  private mapWeather(row: WeatherRow): WeatherSnapshotRecord {
    return {
      snapshotId: row.snapshot_id,
      destinationId: row.destination_id,
      provider: row.provider,
      kind: row.kind,
      startDate: row.start_date as WeatherSnapshotRecord["startDate"],
      endDate: row.end_date as WeatherSnapshotRecord["endDate"],
      fetchedAt: row.fetched_at as WeatherSnapshotRecord["fetchedAt"],
      days: row.days,
      provenance: row.provenance
    };
  }

  private async rawJob(jobId: string): Promise<BuildRow | null> {
    const { data, error } = await this.client.from(BUILDS_TABLE).select("*").eq("job_id", jobId).maybeSingle();
    if (error) throw dbFailure("read build job", error);
    return (data as BuildRow | null) ?? null;
  }

  private async rawVersion(packVersionId: string): Promise<PackRow | null> {
    const { data, error } = await this.client
      .from(PACKS_TABLE)
      .select("*")
      .eq("pack_version_id", packVersionId)
      .maybeSingle();
    if (error) throw dbFailure("read pack version", error);
    return (data as PackRow | null) ?? null;
  }

  /* ------------------------------ queue ------------------------------ */

  private async liveJobRow(destinationId: string): Promise<BuildRow | null> {
    const { data, error } = await this.client
      .from(BUILDS_TABLE)
      .select("*")
      .eq("destination_id", destinationId)
      .in("status", ["queued", "building"])
      .order("requested_at", { ascending: true })
      .limit(1);
    if (error) throw dbFailure("find live build job", error);
    const rows = (data as BuildRow[] | null) ?? [];
    return rows[0] ?? null;
  }

  /** Increment the coalescing counter under a value CAS: the count
   *  is provenance, never logic, so after bounded contention the
   *  current record is returned unmodified rather than failing the
   *  caller's request. */
  private async bumpCoalesced(row: BuildRow): Promise<BuildJobRecord> {
    let current = row;
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const { data, error } = await this.client
        .from(BUILDS_TABLE)
        .update({ coalesced_requests: current.coalesced_requests + 1 })
        .eq("job_id", current.job_id)
        .eq("coalesced_requests", current.coalesced_requests)
        .select("*");
      if (error) throw dbFailure("coalesce build job", error);
      const updated = (data as BuildRow[] | null) ?? [];
      if (updated[0]) return this.mapJob(updated[0]);
      const fresh = await this.rawJob(current.job_id);
      if (!fresh) break;
      current = fresh;
      if (fresh.status !== "queued" && fresh.status !== "building") break;
    }
    return this.mapJob(current);
  }

  async enqueueBuild(destinationId: string, reason: string): Promise<{ job: BuildJobRecord; coalesced: boolean }> {
    const destination = await this.getDestination(destinationId);
    if (!destination) {
      throw new PackStoreError("UNKNOWN_DESTINATION", `cannot enqueue a build for unregistered destination ${destinationId}`);
    }
    const live = await this.liveJobRow(destinationId);
    if (live) return { job: await this.bumpCoalesced(live), coalesced: true };
    const row = {
      job_id: contentId("packjob", [destinationId, randomUUID()]),
      destination_id: destinationId,
      destination_name: destination.displayName,
      reason,
      status: "queued",
      requested_at: this.nowInstant(),
      started_at: null,
      finished_at: null,
      lease_worker_id: null,
      lease_id: null,
      lease_epoch: null,
      lease_expires_at: null,
      coalesced_requests: 1,
      result_pack_id: null,
      error: null
    };
    const { data, error } = await this.client.from(BUILDS_TABLE).insert(row).select("*").single();
    if (error) {
      // The partial unique index is the database's own single-flight
      // guard: a racer inserted the live job first — coalesce onto it.
      if (/duplicate key|unique/i.test(error.message)) {
        const raced = await this.liveJobRow(destinationId);
        if (raced) return { job: await this.bumpCoalesced(raced), coalesced: true };
      }
      throw dbFailure("enqueue build job", error);
    }
    return { job: await this.mapJob(data as BuildRow), coalesced: false };
  }

  async getBuildJob(jobId: string): Promise<BuildJobRecord | null> {
    const row = await this.rawJob(jobId);
    return row ? this.mapJob(row) : null;
  }

  async listBuildJobs(destinationId?: string): Promise<BuildJobRecord[]> {
    let query = this.client.from(BUILDS_TABLE).select("*").order("requested_at", { ascending: true });
    if (destinationId !== undefined) query = query.eq("destination_id", destinationId);
    const { data, error } = await query;
    if (error) throw dbFailure("list build jobs", error);
    const rows = (data as BuildRow[] | null) ?? [];
    const out: BuildJobRecord[] = [];
    for (const row of rows) out.push(await this.mapJob(row));
    return out;
  }

  async claimBuild(jobId: string, workerId: string, leaseTtlMs: number): Promise<BuildLease | null> {
    const job = await this.rawJob(jobId);
    if (!job) throw new PackStoreError("JOB_NOT_FOUND", `no build job ${jobId}`);
    const nowMs = this.now().getTime();
    const expiresAt = toInstant(new Date(nowMs + leaseTtlMs));
    if (job.status === "queued") {
      const leaseId = contentId("packlease", [jobId, 1, this.nowInstant()]);
      const { data, error } = await this.client
        .from(BUILDS_TABLE)
        .update({
          status: "building",
          started_at: this.nowInstant(),
          lease_worker_id: workerId,
          lease_id: leaseId,
          lease_epoch: 1,
          lease_expires_at: expiresAt
        })
        .eq("job_id", jobId)
        .eq("status", "queued")
        .select("*");
      if (error) throw dbFailure("claim build job", error);
      const rows = (data as BuildRow[] | null) ?? [];
      if (!rows[0]) return null; // claimed (or finished) under us
      return { workerId, leaseId, epoch: 1, acquiredAt: toInstant(this.now()), expiresAt };
    }
    if (job.status === "building" && job.lease_expires_at && new Date(job.lease_expires_at).getTime() <= nowMs) {
      // Steal: guarded by the CURRENT lease_id + epoch, so two
      // stealers cannot both win — the loser's update matches zero
      // rows once the winner rotates the fencing token.
      const epoch = (job.lease_epoch ?? 1) + 1;
      const leaseId = contentId("packlease", [jobId, epoch, this.nowInstant()]);
      const { data, error } = await this.client
        .from(BUILDS_TABLE)
        .update({ lease_worker_id: workerId, lease_id: leaseId, lease_epoch: epoch, lease_expires_at: expiresAt })
        .eq("job_id", jobId)
        .eq("status", "building")
        .eq("lease_id", job.lease_id ?? "")
        .eq("lease_epoch", job.lease_epoch ?? 1)
        .select("*");
      if (error) throw dbFailure("steal build job", error);
      const rows = (data as BuildRow[] | null) ?? [];
      if (!rows[0]) return null;
      return { workerId, leaseId, epoch, acquiredAt: toInstant(this.now()), expiresAt };
    }
    return null; // claimable by nobody right now: held, done, or failed
  }

  private async requireHeldLease(jobId: string, leaseId: string): Promise<BuildRow> {
    const job = await this.rawJob(jobId);
    if (!job) throw new PackStoreError("JOB_NOT_FOUND", `no build job ${jobId}`);
    if (job.status !== "building" || !job.lease_id || job.lease_id !== leaseId) {
      throw new PackStoreError("LEASE_LOST", `job ${jobId} is no longer held by lease ${leaseId}`);
    }
    if (job.lease_expires_at && new Date(job.lease_expires_at).getTime() <= this.now().getTime()) {
      throw new PackStoreError("LEASE_EXPIRED", `lease for job ${jobId} expired at ${job.lease_expires_at}`);
    }
    return job;
  }

  async heartbeatBuild(jobId: string, leaseId: string, leaseTtlMs: number): Promise<BuildLease> {
    const job = await this.rawJob(jobId);
    if (!job) throw new PackStoreError("JOB_NOT_FOUND", `no build job ${jobId}`);
    if (job.status !== "building" || !job.lease_id || job.lease_id !== leaseId) {
      throw new PackStoreError("LEASE_LOST", `job ${jobId} is no longer held by lease ${leaseId}`);
    }
    // A heartbeat from the current holder is accepted even at the
    // expiry edge (proof the holder is alive) — parity with the
    // in-memory store: no expiry filter here.
    const expiresAt = toInstant(new Date(this.now().getTime() + leaseTtlMs));
    const { data, error } = await this.client
      .from(BUILDS_TABLE)
      .update({ lease_expires_at: expiresAt })
      .eq("job_id", jobId)
      .eq("lease_id", leaseId)
      .eq("status", "building")
      .select("*");
    if (error) throw dbFailure("heartbeat build job", error);
    const rows = (data as BuildRow[] | null) ?? [];
    if (!rows[0]) throw new PackStoreError("LEASE_LOST", `job ${jobId} is no longer held by lease ${leaseId}`);
    return {
      workerId: rows[0].lease_worker_id ?? job.lease_worker_id ?? "",
      leaseId,
      epoch: rows[0].lease_epoch ?? 1,
      acquiredAt: rows[0].updated_at as BuildLease["acquiredAt"],
      expiresAt
    };
  }

  async failBuild(jobId: string, leaseId: string, error: string): Promise<BuildJobRecord> {
    await this.requireHeldLease(jobId, leaseId);
    const { data, error: updateError } = await this.client
      .from(BUILDS_TABLE)
      .update({
        status: "failed",
        error,
        finished_at: this.nowInstant(),
        lease_worker_id: null,
        lease_id: null,
        lease_epoch: null,
        lease_expires_at: null
      })
      .eq("job_id", jobId)
      .eq("lease_id", leaseId)
      .select("*");
    if (updateError) throw dbFailure("fail build job", updateError);
    const rows = (data as BuildRow[] | null) ?? [];
    if (!rows[0]) throw new PackStoreError("LEASE_LOST", `job ${jobId} is no longer held by lease ${leaseId}`);
    return this.mapJob(rows[0]);
  }

  /* ------------------------------ versions ------------------------------ */

  async beginVersion(
    jobId: string,
    leaseId: string,
    classifierVersion: string,
    schemaVersion: number
  ): Promise<PackVersionRecord> {
    const job = await this.requireHeldLease(jobId, leaseId);
    const { data: siblings, error: countError } = await this.client
      .from(PACKS_TABLE)
      .select("pack_version_id")
      .eq("destination_id", job.destination_id);
    if (countError) throw dbFailure("count pack versions", countError);
    const version = ((siblings as { pack_version_id: string }[] | null) ?? []).length + 1;
    const destination = await this.getDestination(job.destination_id);
    const packVersionId = contentId("packv", [job.destination_id, version, classifierVersion, schemaVersion]);
    const row = {
      pack_version_id: packVersionId,
      destination_id: job.destination_id,
      destination_name: destination?.displayName ?? null,
      version,
      schema_version: schemaVersion,
      classifier_version: classifierVersion,
      status: "building",
      built_at: null,
      candidate_count: 0,
      counts_by_kind: {},
      content_hash: null,
      supersedes_pack_version_id: null,
      build_job_id: jobId,
      provenance: {
        source: "pack-builder",
        sourceRef: jobId,
        recordedAt: this.nowInstant(),
        label: "build in progress"
      }
    };
    const { data, error } = await this.client.from(PACKS_TABLE).insert(row).select("*").single();
    if (error) throw dbFailure("begin pack version", error);
    return this.mapVersion(data as PackRow);
  }

  async publishVersion(
    packVersionId: string,
    jobId: string,
    leaseId: string,
    candidates: StoredCandidate[],
    provenance: PackVersionRecord["dto"]["provenance"]
  ): Promise<PackVersionRecord> {
    // The fencing check comes FIRST: a stolen lease refuses the
    // publish no matter what state the version row is in (I3).
    await this.requireHeldLease(jobId, leaseId);
    const record = await this.rawVersion(packVersionId);
    if (!record) throw new PackStoreError("VERSION_NOT_FOUND", `no pack version ${packVersionId}`);
    if (record.status !== "building") {
      throw new PackStoreError("VERSION_NOT_BUILDING", `pack version ${packVersionId} is ${record.status}, not building`);
    }
    if (record.build_job_id !== jobId) {
      throw new PackStoreError("VERSION_NOT_BUILDING", `pack version ${packVersionId} belongs to job ${record.build_job_id}, not ${jobId}`);
    }
    // The candidates table is unique on (pack, candidate_key); the
    // recorded-pack ingestion dedupes by key the same way — first
    // occurrence wins.
    const seen = new Set<string>();
    const stored: StoredCandidate[] = [];
    for (const c of candidates) {
      if (seen.has(c.candidateKey)) continue;
      seen.add(c.candidateKey);
      stored.push(c);
    }
    const { data: readyRows, error: readyError } = await this.client
      .from(PACKS_TABLE)
      .select("*")
      .eq("destination_id", record.destination_id)
      .eq("status", "ready")
      .order("version", { ascending: false })
      .limit(1);
    if (readyError) throw dbFailure("read ready pack version", readyError);
    const previousReady = (((readyRows as PackRow[] | null) ?? [])[0] ?? null) as PackRow | null;

    for (let i = 0; i < stored.length; i += CANDIDATE_INSERT_CHUNK) {
      const chunk = stored.slice(i, i + CANDIDATE_INSERT_CHUNK).map((c) => ({
        pack_id: record.id,
        candidate_key: c.candidateKey,
        osm_key: c.osmKey,
        kind: c.kind,
        name: c.name,
        name_en: c.nameEn,
        lat: c.pos ? c.pos.lat : null,
        lon: c.pos ? c.pos.lon : null,
        hours_raw: c.hoursRaw,
        tags: c.tags,
        url: c.url,
        enrichment: c.enrichment
      }));
      const { error: insertError } = await this.client.from(CANDIDATES_TABLE).insert(chunk);
      if (insertError) throw dbFailure("write pack candidates", insertError);
    }

    const byKind: Record<string, number> = {};
    for (const c of stored) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
    const { data: flipped, error: flipError } = await this.client
      .from(PACKS_TABLE)
      .update({
        status: "ready",
        built_at: this.nowInstant(),
        candidate_count: stored.length,
        counts_by_kind: byKind,
        content_hash: candidateContentHash(stored),
        supersedes_pack_version_id: previousReady ? previousReady.pack_version_id : null,
        provenance
      })
      .eq("pack_version_id", packVersionId)
      .eq("status", "building")
      .select("*");
    if (flipError) throw dbFailure("publish pack version", flipError);
    const flippedRows = (flipped as PackRow[] | null) ?? [];
    if (!flippedRows[0]) {
      throw new PackStoreError("VERSION_NOT_BUILDING", `pack version ${packVersionId} is no longer building`);
    }
    if (previousReady) {
      // The ONLY mutation an already-published version ever sees (I1).
      const { error: supersedeError } = await this.client
        .from(PACKS_TABLE)
        .update({ status: "superseded" })
        .eq("pack_version_id", previousReady.pack_version_id)
        .eq("status", "ready");
      if (supersedeError) throw dbFailure("supersede previous pack version", supersedeError);
    }
    const { data: jobRows, error: jobError } = await this.client
      .from(BUILDS_TABLE)
      .update({
        status: "done",
        result_pack_id: record.id,
        finished_at: this.nowInstant(),
        lease_worker_id: null,
        lease_id: null,
        lease_epoch: null,
        lease_expires_at: null
      })
      .eq("job_id", jobId)
      .eq("lease_id", leaseId)
      .select("*");
    if (jobError) throw dbFailure("complete build job", jobError);
    if (!((jobRows as BuildRow[] | null) ?? [])[0]) {
      throw new PackStoreError("LEASE_LOST", `job ${jobId} is no longer held by lease ${leaseId}`);
    }
    return this.mapVersion(flippedRows[0]);
  }

  async failVersion(packVersionId: string, jobId: string, leaseId: string, error: string): Promise<PackVersionRecord> {
    await this.requireHeldLease(jobId, leaseId);
    const record = await this.rawVersion(packVersionId);
    if (!record) throw new PackStoreError("VERSION_NOT_FOUND", `no pack version ${packVersionId}`);
    const { error: versionError } = await this.client
      .from(PACKS_TABLE)
      .update({ status: "failed" })
      .eq("pack_version_id", packVersionId);
    if (versionError) throw dbFailure("fail pack version", versionError);
    const { error: jobError } = await this.client
      .from(BUILDS_TABLE)
      .update({
        status: "failed",
        error,
        finished_at: this.nowInstant(),
        lease_worker_id: null,
        lease_id: null,
        lease_epoch: null,
        lease_expires_at: null
      })
      .eq("job_id", jobId)
      .eq("lease_id", leaseId);
    if (jobError) throw dbFailure("fail build job for version", jobError);
    const updated = await this.rawVersion(packVersionId);
    if (!updated) throw new PackStoreError("VERSION_NOT_FOUND", `no pack version ${packVersionId}`);
    return this.mapVersion(updated);
  }

  async getVersion(packVersionId: string): Promise<PackVersionRecord | null> {
    const row = await this.rawVersion(packVersionId);
    return row ? this.mapVersion(row) : null;
  }

  async getVersionCandidates(packVersionId: string): Promise<StoredCandidate[]> {
    const record = await this.rawVersion(packVersionId);
    if (!record) throw new PackStoreError("VERSION_NOT_FOUND", `no pack version ${packVersionId}`);
    const { data, error } = await this.client
      .from(CANDIDATES_TABLE)
      .select("*")
      .eq("pack_id", record.id)
      .order("candidate_key", { ascending: true });
    if (error) throw dbFailure("read pack candidates", error);
    return ((data as CandidateRow[] | null) ?? []).map((row) => this.mapCandidate(row));
  }

  async getReadyVersion(destinationId: string): Promise<PackVersionRecord | null> {
    const { data, error } = await this.client
      .from(PACKS_TABLE)
      .select("*")
      .eq("destination_id", destinationId)
      .eq("status", "ready")
      .order("version", { ascending: false })
      .limit(1);
    if (error) throw dbFailure("read ready pack version", error);
    const row = ((data as PackRow[] | null) ?? [])[0];
    return row ? this.mapVersion(row) : null;
  }

  async listVersions(destinationId: string): Promise<PackVersionRecord[]> {
    const { data, error } = await this.client
      .from(PACKS_TABLE)
      .select("*")
      .eq("destination_id", destinationId)
      .order("version", { ascending: true });
    if (error) throw dbFailure("list pack versions", error);
    return ((data as PackRow[] | null) ?? []).map((row) => this.mapVersion(row));
  }

  /* ------------------------------ pins ------------------------------ */

  private pinKey(generationRef: string): string {
    return `pack_pin:v1:${generationRef}`;
  }

  async pinVersion(generationRef: string, packVersionId: string): Promise<PackPinRecord> {
    const version = await this.rawVersion(packVersionId);
    if (!version) throw new PackStoreError("VERSION_NOT_FOUND", `cannot pin unknown pack version ${packVersionId}`);
    const pin: PackPinRecord = { generationRef, packVersionId, pinnedAt: toInstant(this.now()) };
    const { error } = await this.client
      .from(SETTINGS_TABLE)
      .upsert({ key: this.pinKey(generationRef), value: pin }, { onConflict: "key" });
    if (error) throw dbFailure("write pack pin", error);
    return clone(pin);
  }

  async getPin(generationRef: string): Promise<PackPinRecord | null> {
    const { data, error } = await this.client
      .from(SETTINGS_TABLE)
      .select("value")
      .eq("key", this.pinKey(generationRef))
      .maybeSingle();
    if (error) throw dbFailure("read pack pin", error);
    const row = data as { value: PackPinRecord } | null;
    return row ? clone(row.value) : null;
  }

  async readPinned(
    packVersionId: string
  ): Promise<{ version: PackVersionRecord; candidates: StoredCandidate[] } | null> {
    const version = await this.getVersion(packVersionId);
    if (!version) return null;
    const candidates = await this.getVersionCandidates(packVersionId);
    return { version, candidates };
  }

  /* ------------------------------ enrichment ------------------------------ */

  async putCandidateEnrichment(
    packVersionId: string,
    candidateKey: string,
    enrichment: StoredEnrichment | null
  ): Promise<StoredCandidate> {
    const record = await this.rawVersion(packVersionId);
    if (!record) throw new PackStoreError("VERSION_NOT_FOUND", `no pack version ${packVersionId}`);
    const { data, error } = await this.client
      .from(CANDIDATES_TABLE)
      .select("*")
      .eq("pack_id", record.id)
      .eq("candidate_key", candidateKey)
      .maybeSingle();
    if (error) throw dbFailure("read pack candidate", error);
    const row = data as CandidateRow | null;
    if (!row) {
      throw new PackStoreError("CANDIDATE_NOT_FOUND", `pack version ${packVersionId} has no candidate ${candidateKey}`);
    }
    // The enrichment field is the ONLY field written here — the base
    // POI layer (and the version's contentHash over it) never moves.
    const { data: updated, error: updateError } = await this.client
      .from(CANDIDATES_TABLE)
      .update({ enrichment })
      .eq("pack_id", record.id)
      .eq("candidate_key", candidateKey)
      .select("*");
    if (updateError) throw dbFailure("write candidate enrichment", updateError);
    const updatedRow = ((updated as CandidateRow[] | null) ?? [])[0];
    return this.mapCandidate(updatedRow ?? { ...row, enrichment });
  }

  /* ------------------------------ weather ------------------------------ */

  async putWeatherSnapshot(snapshot: WeatherSnapshotRecord): Promise<WeatherSnapshotRecord> {
    if (!(await this.getDestination(snapshot.destinationId))) {
      throw new PackStoreError("UNKNOWN_DESTINATION", `weather for unregistered destination ${snapshot.destinationId}`);
    }
    const { data, error } = await this.client
      .from(WEATHER_TABLE)
      .insert({
        snapshot_id: snapshot.snapshotId,
        destination_id: snapshot.destinationId,
        provider: snapshot.provider,
        kind: snapshot.kind,
        start_date: snapshot.startDate,
        end_date: snapshot.endDate,
        fetched_at: snapshot.fetchedAt,
        days: snapshot.days,
        provenance: snapshot.provenance
      })
      .select("*")
      .single();
    if (error) {
      // A snapshot is a fetch event with a content-derived ID: a
      // re-put of the same snapshot is the same artifact — return
      // the stored row (idempotent put).
      if (/duplicate key|unique/i.test(error.message)) {
        const { data: existing, error: readError } = await this.client
          .from(WEATHER_TABLE)
          .select("*")
          .eq("snapshot_id", snapshot.snapshotId)
          .maybeSingle();
        if (!readError && existing) return this.mapWeather(existing as WeatherRow);
      }
      throw dbFailure("write weather snapshot", error);
    }
    return this.mapWeather(data as WeatherRow);
  }

  async getWeatherSnapshot(
    destinationId: string,
    kind: WeatherSnapshotRecord["kind"],
    startDate: string,
    endDate: string
  ): Promise<WeatherSnapshotRecord | null> {
    const { data, error } = await this.client
      .from(WEATHER_TABLE)
      .select("*")
      .eq("destination_id", destinationId)
      .eq("kind", kind)
      .eq("start_date", startDate)
      .eq("end_date", endDate)
      .order("fetched_at", { ascending: false })
      .limit(1);
    if (error) throw dbFailure("read weather snapshot", error);
    const row = ((data as WeatherRow[] | null) ?? [])[0];
    return row ? this.mapWeather(row) : null;
  }

  async listWeatherSnapshots(destinationId: string): Promise<WeatherSnapshotRecord[]> {
    const { data, error } = await this.client
      .from(WEATHER_TABLE)
      .select("*")
      .eq("destination_id", destinationId)
      .order("fetched_at", { ascending: true });
    if (error) throw dbFailure("list weather snapshots", error);
    return ((data as WeatherRow[] | null) ?? []).map((row) => this.mapWeather(row));
  }
}
