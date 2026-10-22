// Roamly wiring SHIP checks — the deferred landings of SHIP-MANIFEST
// §4 step 4 (2026-10-22 production ship):
//
//   A. SupabasePackStore conformance: the SAME scenario runs against
//      InMemoryPackStore (the contract's reference semantics) and
//      SupabasePackStore over a fake PostgREST client, and the
//      outcome logs must agree field-for-field (modulo the two
//      documented divergences: candidate reads are candidate_key
//      ordered — the scenario sorts before comparing — and the
//      lease's acquiredAt, which M7 does not carry as a column).
//   B. SupabasePlacesLedgerStore conformance: same pattern against
//      InMemoryPlacesLedgerStore, including the cap refusal and the
//      CAS-guarded settle discipline.
//   C. buildEngineRuntimeDeps: null without ROAMLY_PACK_STORE, null
//      without a service-role admin client, fully wired (Supabase
//      stores + mode-off Places service) with both present.
//
// (The pack-refresh route itself is not imported here — app routes
// are outside this harness's module resolution, the same reason no
// phase script imports one. Its fail-closed guards are the house
// cron pattern shared with the lifecycle route, and are proven by
// the production build plus the live probes in the ship report.)
//
// The fake client emulates exactly the PostgREST surface the two
// stores use (select/insert/update/upsert with eq/in/lte/like
// filters, order/limit, single/maybeSingle), the tables' unique
// constraints (including the builds live-job partial index), and
// trigger-maintained updated_at on the tables that carry one.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

let passed = 0;
function ok(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed += 1;
}
function eq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`FAIL: ${label}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
  passed += 1;
}
async function throwsCode(fn, code, label) {
  try {
    await fn();
  } catch (err) {
    if (err && err.code === code) {
      passed += 1;
      return;
    }
    throw new Error(`FAIL: ${label} — wrong error: ${err && err.message} (code ${err && err.code})`);
  }
  throw new Error(`FAIL: ${label} — no error thrown`);
}

/* ------------------------------------------------------------------ */
/* Fake PostgREST client                                               */
/* ------------------------------------------------------------------ */

const TABLE_DEFS = {
  roamly_destination_pack_builds: {
    uniques: [["job_id"]],
    hasUpdatedAt: true,
    liveIndex: true
  },
  roamly_destination_packs: {
    uniques: [["pack_version_id"], ["destination_id", "version"]],
    hasUpdatedAt: false
  },
  roamly_destination_candidates: {
    uniques: [["pack_id", "candidate_key"]],
    hasUpdatedAt: false
  },
  roamly_destination_weather_snapshots: {
    uniques: [["snapshot_id"], ["destination_id", "provider", "kind", "start_date", "end_date", "fetched_at"]],
    hasUpdatedAt: false
  },
  roamly_admin_settings: {
    uniques: [["key"]],
    hasUpdatedAt: true
  }
};

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function likeToRegex(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`);
}

class FakeDb {
  constructor() {
    this.tables = new Map(Object.keys(TABLE_DEFS).map((name) => [name, []]));
    this.stampSeq = 0;
  }

  stamp() {
    this.stampSeq += 1;
    return new Date(Date.UTC(2026, 0, 1) + this.stampSeq * 1000).toISOString();
  }

  rows(table) {
    return this.tables.get(table);
  }

  checkUniques(table, candidate, ignoreRow) {
    const def = TABLE_DEFS[table];
    for (const cols of def.uniques) {
      for (const row of this.rows(table)) {
        if (ignoreRow && row === ignoreRow) continue;
        if (cols.every((c) => deepEqual(row[c], candidate[c]))) {
          return { code: "23505", message: `duplicate key value violates unique constraint "fake_${table}_${cols.join("_")}"` };
        }
      }
    }
    if (def.liveIndex && (candidate.status === "queued" || candidate.status === "building")) {
      for (const row of this.rows(table)) {
        if (ignoreRow && row === ignoreRow) continue;
        if (row.destination_id === candidate.destination_id && (row.status === "queued" || row.status === "building")) {
          return { code: "23505", message: 'duplicate key value violates unique constraint "roamly_destination_pack_builds_live_idx"' };
        }
      }
    }
    return null;
  }

  insert(table, inputRows) {
    const inserted = [];
    for (const input of inputRows) {
      const row = structuredClone(input);
      if (row.id === undefined && table !== "roamly_admin_settings") row.id = randomUUID();
      if (row.created_at === undefined) row.created_at = this.stamp();
      if (TABLE_DEFS[table].hasUpdatedAt && row.updated_at === undefined) row.updated_at = this.stamp();
      if (table === "roamly_destination_packs") {
        if (row.candidate_count === undefined) row.candidate_count = 0;
        if (row.counts_by_kind === undefined) row.counts_by_kind = {};
        if (row.provenance === undefined) row.provenance = {};
      }
      if (table === "roamly_destination_candidates" && row.tags === undefined) row.tags = {};
      const conflict = this.checkUniques(table, row, null);
      if (conflict) return { data: null, error: conflict };
      this.rows(table).push(row);
      inserted.push(row);
    }
    return { data: inserted, error: null };
  }

  matches(row, filters) {
    for (const f of filters) {
      const value = row[f.col];
      if (f.op === "eq" && !deepEqual(value, f.val)) return false;
      if (f.op === "in" && !f.val.some((v) => deepEqual(value, v))) return false;
      if (f.op === "lte" && !(typeof value === "string" && typeof f.val === "string" ? value <= f.val : value <= f.val)) return false;
      if (f.op === "like" && !(typeof value === "string" && likeToRegex(f.val).test(value))) return false;
    }
    return true;
  }

  select(table, filters, orders, limitN) {
    let out = this.rows(table).filter((row) => this.matches(row, filters));
    for (const order of [...orders].reverse()) {
      out = [...out].sort((a, b) => {
        const av = a[order.col];
        const bv = b[order.col];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return order.ascending ? cmp : -cmp;
      });
    }
    if (limitN !== null) out = out.slice(0, limitN);
    return out.map((row) => structuredClone(row));
  }

  update(table, patch, filters) {
    const matched = this.rows(table).filter((row) => this.matches(row, filters));
    for (const row of matched) {
      const candidate = { ...row, ...structuredClone(patch) };
      const conflict = this.checkUniques(table, candidate, row);
      if (conflict) return { data: null, error: conflict };
    }
    for (const row of matched) {
      Object.assign(row, structuredClone(patch));
      if (TABLE_DEFS[table].hasUpdatedAt) row.updated_at = this.stamp();
    }
    return { data: matched.map((row) => structuredClone(row)), error: null };
  }

  upsert(table, input, onConflictCols, ignoreDuplicates) {
    const existing = this.rows(table).find((row) => onConflictCols.every((c) => deepEqual(row[c], input[c])));
    if (existing) {
      if (!ignoreDuplicates) {
        Object.assign(existing, structuredClone(input));
        if (TABLE_DEFS[table].hasUpdatedAt) existing.updated_at = this.stamp();
      }
      return { data: [structuredClone(existing)], error: null, inserted: false };
    }
    const result = this.insert(table, [input]);
    if (result.error) return { data: null, error: result.error, inserted: false };
    return { data: result.data, error: null, inserted: true };
  }
}

class FakeQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.mode = null;
    this.payload = null;
    this.upsertOpts = null;
    this.filters = [];
    this.orders = [];
    this.limitN = null;
    this.returnCols = null;
  }

  select(cols) {
    if (this.mode === null) this.mode = "select";
    else this.returnCols = cols;
    return this;
  }

  insert(payload) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  update(patch) {
    this.mode = "update";
    this.payload = patch;
    return this;
  }

  upsert(payload, opts) {
    this.mode = "upsert";
    this.payload = payload;
    this.upsertOpts = opts || {};
    return this;
  }

  eq(col, val) {
    this.filters.push({ op: "eq", col, val });
    return this;
  }

  in(col, val) {
    this.filters.push({ op: "in", col, val });
    return this;
  }

  lte(col, val) {
    this.filters.push({ op: "lte", col, val });
    return this;
  }

  like(col, val) {
    this.filters.push({ op: "like", col, val });
    return this;
  }

  order(col, opts) {
    this.orders.push({ col, ascending: !opts || opts.ascending !== false });
    return this;
  }

  limit(n) {
    this.limitN = n;
    return this;
  }

  project(row, cols) {
    if (!row || !cols || cols === "*") return row;
    const out = {};
    for (const col of cols.split(",").map((c) => c.trim())) out[col] = row[col];
    return out;
  }

  execute() {
    if (this.mode === "select") {
      const rows = this.db.select(this.table, this.filters, this.orders, this.limitN);
      return { data: rows.map((r) => this.project(r, this.returnCols || "*")), error: null, cardinality: "many" };
    }
    if (this.mode === "insert") {
      const inputs = Array.isArray(this.payload) ? this.payload : [this.payload];
      const result = this.db.insert(this.table, inputs);
      if (result.error) return { data: null, error: result.error, cardinality: "many" };
      if (this.returnCols) return { data: result.data.map((r) => this.project(r, this.returnCols)), error: null, cardinality: "many" };
      return { data: null, error: null, cardinality: "many" };
    }
    if (this.mode === "update") {
      const result = this.db.update(this.table, this.payload, this.filters);
      if (result.error) return { data: null, error: result.error, cardinality: "many" };
      if (this.returnCols) return { data: result.data.map((r) => this.project(r, this.returnCols)), error: null, cardinality: "many" };
      return { data: null, error: null, cardinality: "many" };
    }
    if (this.mode === "upsert") {
      const onConflict = (this.upsertOpts.onConflict || "id").split(",").map((c) => c.trim());
      const result = this.db.upsert(this.table, this.payload, onConflict, this.upsertOpts.ignoreDuplicates === true);
      if (result.error) return { data: null, error: result.error, cardinality: "many" };
      if (this.returnCols) {
        return { data: (result.inserted || !this.upsertOpts.ignoreDuplicates ? result.data : []).map((r) => this.project(r, this.returnCols)), error: null, cardinality: "many" };
      }
      return { data: null, error: null, cardinality: "many" };
    }
    throw new Error("fake query executed with no mode");
  }

  async single() {
    const { data, error } = this.execute();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : [];
    if (rows.length !== 1) {
      return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    }
    return { data: rows[0], error: null };
  }

  async maybeSingle() {
    const { data, error } = this.execute();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) return { data: null, error: null };
    if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    return { data: rows[0], error: null };
  }

  then(onFulfilled, onRejected) {
    let result;
    try {
      result = this.execute();
    } catch (err) {
      return Promise.reject(err).then(onFulfilled, onRejected);
    }
    const { cardinality, ...rest } = result;
    void cardinality;
    return Promise.resolve(rest).then(onFulfilled, onRejected);
  }
}

function createFakeSupabaseClient() {
  const db = new FakeDb();
  return {
    from(table) {
      return new FakeQuery(db, table);
    },
    __db: db
  };
}

/* ------------------------------------------------------------------ */
/* Shared clocks: each store gets an identical auto-advancing clock    */
/* ------------------------------------------------------------------ */

function makeClock() {
  let nowMs = Date.UTC(2026, 9, 22, 12, 0, 0);
  const clock = () => {
    nowMs += 1000;
    return new Date(nowMs);
  };
  clock.advance = (ms) => {
    nowMs += ms;
  };
  clock.peek = () => new Date(nowMs);
  return clock;
}

/* ------------------------------------------------------------------ */
/* A. PackStore scenario — run identically against both stores         */
/* ------------------------------------------------------------------ */

const TESTVILLE = {
  destinationId: "dst-testville",
  displayName: "Testville",
  country: "Testland",
  centre: { lat: 1.5, lon: 2.5 },
  bbox: null,
  timeZone: "UTC",
  geocodeProvenance: { source: "test", sourceRef: "testville", recordedAt: null, label: "scenario destination" }
};
const EMPTYTON = { ...TESTVILLE, destinationId: "dst-emptyton", displayName: "Emptyton" };

const CANDS = [
  {
    candidateKey: "osm:node/2",
    osmKey: "node/2",
    kind: "food",
    name: "Beta Bistro",
    nameEn: null,
    pos: null,
    hoursRaw: null,
    tags: {},
    url: "",
    enrichment: null
  },
  {
    candidateKey: "osm:node/1",
    osmKey: "node/1",
    kind: "museum",
    name: "Alpha Museum",
    nameEn: "Alpha Museum",
    pos: { lat: 1.51, lon: 2.51 },
    hoursRaw: "Mo-Su 09:00-17:00",
    tags: { tourism: "museum" },
    url: "https://example.test/alpha",
    enrichment: null
  },
  {
    candidateKey: "osm:node/3",
    osmKey: "node/3",
    kind: "stay",
    name: "Gamma Inn",
    nameEn: null,
    pos: { lat: 1.52, lon: 2.52 },
    hoursRaw: null,
    tags: {},
    url: "",
    enrichment: null
  }
];
const PROVENANCE = { source: "pack-builder", sourceRef: "scenario", recordedAt: null, label: "scenario build" };

const sortCands = (rows) => [...rows].sort((a, b) => (a.candidateKey < b.candidateKey ? -1 : 1));
const projCand = (c) => ({
  candidateKey: c.candidateKey,
  osmKey: c.osmKey,
  kind: c.kind,
  name: c.name,
  nameEn: c.nameEn,
  pos: c.pos,
  hoursRaw: c.hoursRaw,
  tags: c.tags,
  url: c.url,
  enrichment: c.enrichment ? { placeId: c.enrichment.placeId ?? null, priceLevel: c.enrichment.priceLevel ?? null } : null
});
const projVersion = (v) => ({
  version: v.version,
  status: v.dto.status,
  destinationId: v.dto.destinationId,
  schemaVersion: v.dto.schemaVersion,
  classifierVersion: v.dto.classifierVersion,
  counts: v.dto.counts,
  hashShape: /^[0-9a-f]{64}$/.test(v.contentHash || ""),
  supersedes: v.supersedesPackVersionId ? "set" : null,
  buildJob: v.buildJobId ? "set" : null,
  provenanceLabel: v.dto.provenance.label
});
const projJob = (j) => ({
  status: j.status,
  reason: j.reason,
  coalescedRequests: j.coalescedRequests,
  result: j.resultPackVersionId ? "set" : null,
  error: j.error,
  leaseEpoch: j.lease ? j.lease.epoch : null
});

async function packScenario(store, clock, builder) {
  const log = [];
  const push = (name, value) => log.push([name, value]);

  push("getDestination-unregistered", await store.getDestination(TESTVILLE.destinationId));
  await store.registerDestination(TESTVILLE);
  push("getDestination", await store.getDestination(TESTVILLE.destinationId));
  await throwsCode(() => store.registerDestination(TESTVILLE), "DUPLICATE_DESTINATION", "duplicate register");
  push("listDestinations-has-testville", (await store.listDestinations()).some((d) => d.destinationId === TESTVILLE.destinationId));

  const first = await store.enqueueBuild(TESTVILLE.destinationId, "seed");
  push("enqueue-1", { coalesced: first.coalesced, job: projJob(first.job) });
  const second = await store.enqueueBuild(TESTVILLE.destinationId, "refresh");
  push("enqueue-2-coalesced", { coalesced: second.coalesced, sameJob: second.job.jobId === first.job.jobId, job: projJob(second.job) });
  const jobId = first.job.jobId;

  await throwsCode(() => store.claimBuild("packjob-missing", "w", 60000), "JOB_NOT_FOUND", "claim missing job");
  const lease1 = await store.claimBuild(jobId, "worker-a", 60000);
  push("claim-1", lease1 ? { epoch: lease1.epoch, worker: lease1.workerId } : null);
  push("claim-while-held", await store.claimBuild(jobId, "worker-b", 60000));
  await throwsCode(() => store.heartbeatBuild(jobId, "packlease-wrong", 60000), "LEASE_LOST", "heartbeat wrong lease");
  const hb = await store.heartbeatBuild(jobId, lease1.leaseId, 60000);
  push("heartbeat", { epoch: hb.epoch, extended: hb.expiresAt > lease1.expiresAt });

  // Expire the lease, then a second worker steals it (epoch 2); the
  // old holder is fenced out of begin/publish.
  clock.advance(61000);
  const lease2 = await store.claimBuild(jobId, "worker-b", 60000);
  push("claim-steal", lease2 ? { epoch: lease2.epoch, worker: lease2.workerId } : null);
  await throwsCode(() => store.beginVersion(jobId, lease1.leaseId, "cls-1", 1), "LEASE_LOST", "begin with stolen lease");
  const v1 = await store.beginVersion(jobId, lease2.leaseId, "cls-1", 1);
  push("begin-v1", projVersion(v1));
  await throwsCode(
    () => store.publishVersion("packv-missing", jobId, lease2.leaseId, CANDS, PROVENANCE),
    "VERSION_NOT_FOUND",
    "publish missing version"
  );
  const published = await store.publishVersion(v1.dto.packVersionId, jobId, lease2.leaseId, CANDS, PROVENANCE);
  push("publish-v1", projVersion(published));
  push("job-after-publish", projJob(await store.getBuildJob(jobId)));
  push("claim-done-job", await store.claimBuild(jobId, "worker-c", 60000));

  const ready = await store.getReadyVersion(TESTVILLE.destinationId);
  push("ready-is-v1", ready ? ready.dto.packVersionId === v1.dto.packVersionId : null);
  push("candidates-v1", sortCands(await store.getVersionCandidates(v1.dto.packVersionId)).map(projCand));

  const pin = await store.pinVersion("trip-test-1", v1.dto.packVersionId);
  push("pin", { ref: pin.generationRef, sameVersion: pin.packVersionId === v1.dto.packVersionId });
  push("getPin", (await store.getPin("trip-test-1"))?.packVersionId === v1.dto.packVersionId);
  push("getPin-missing", await store.getPin("trip-nope"));
  await throwsCode(() => store.pinVersion("trip-x", "packv-missing"), "VERSION_NOT_FOUND", "pin missing version");
  const pinned = await store.readPinned(v1.dto.packVersionId);
  push("readPinned", { version: projVersion(pinned.version), candidates: sortCands(pinned.candidates).map(projCand) });

  const enriched = await store.putCandidateEnrichment(v1.dto.packVersionId, "osm:node/1", {
    source: "google",
    placeId: "g-alpha",
    priceLevel: "PRICE_LEVEL_MODERATE",
    rating: 4.5,
    userRatingCount: 10,
    businessStatus: "OPERATIONAL",
    wheelchairEntrance: true
  });
  push("enrichment-write", projCand(enriched));
  push("hash-unchanged-by-enrichment", (await store.getVersion(v1.dto.packVersionId)).contentHash === published.contentHash);
  await throwsCode(
    () => store.putCandidateEnrichment(v1.dto.packVersionId, "osm:node/999", null),
    "CANDIDATE_NOT_FOUND",
    "enrich missing candidate"
  );
  await throwsCode(() => store.putCandidateEnrichment("packv-missing", "osm:node/1", null), "VERSION_NOT_FOUND", "enrich missing version");
  await throwsCode(() => store.getVersionCandidates("packv-missing"), "VERSION_NOT_FOUND", "candidates of missing version");

  // Second build supersedes v1; the pin still reads v1 byte-for-byte.
  const rebuild = await store.enqueueBuild(TESTVILLE.destinationId, "refresh");
  const lease3 = await store.claimBuild(rebuild.job.jobId, "worker-a", 60000);
  const v2 = await store.beginVersion(rebuild.job.jobId, lease3.leaseId, "cls-1", 1);
  push("begin-v2", projVersion(v2));
  const published2 = await store.publishVersion(v2.dto.packVersionId, rebuild.job.jobId, lease3.leaseId, [CANDS[1]], PROVENANCE);
  push("publish-v2", projVersion(published2));
  push("v1-after-rebuild", projVersion(await store.getVersion(v1.dto.packVersionId)));
  push("ready-is-v2", (await store.getReadyVersion(TESTVILLE.destinationId)).dto.packVersionId === v2.dto.packVersionId);
  const pinnedAfter = await store.readPinned(v1.dto.packVersionId);
  push("pin-stable-after-rebuild", {
    version: projVersion(pinnedAfter.version),
    candidates: sortCands(pinnedAfter.candidates).map(projCand)
  });
  push("listVersions", (await store.listVersions(TESTVILLE.destinationId)).map((v) => v.version));

  // Serving reads + the drain path the cron route drives. The
  // freshness clock is the scenario clock (deterministic).
  const serving = await builder.readServingPack(store, TESTVILLE.destinationId, { now: clock.peek() });
  push("serving-ready", { state: serving.state, isV2: serving.pack?.dto.packVersionId === v2.dto.packVersionId });
  await store.registerDestination(EMPTYTON);
  const cold = await builder.readServingPack(store, EMPTYTON.destinationId, { now: clock.peek() });
  push("serving-cold", { state: cold.state, jobStatus: cold.job?.status });
  const drained = await builder.drainQueuedBuilds(store, () => async () => ({ candidates: [CANDS[1]], provenance: PROVENANCE }), {
    workerId: "scenario-drain"
  });
  push("drain-published", drained.map((v) => ({ destinationId: v.dto.destinationId, version: v.version })));
  push("serving-after-drain", (await builder.readServingPack(store, EMPTYTON.destinationId, { now: clock.peek() })).state);

  // failBuild / failVersion paths.
  const failJob = await store.enqueueBuild(EMPTYTON.destinationId, "refresh");
  const failLease = await store.claimBuild(failJob.job.jobId, "worker-a", 60000);
  await throwsCode(() => store.failBuild(failJob.job.jobId, "packlease-wrong", "x"), "LEASE_LOST", "failBuild wrong lease");
  push("failBuild", projJob(await store.failBuild(failJob.job.jobId, failLease.leaseId, "collector exploded")));
  push("claim-failed-job", await store.claimBuild(failJob.job.jobId, "worker-a", 60000));
  const fvJob = await store.enqueueBuild(TESTVILLE.destinationId, "refresh");
  const fvLease = await store.claimBuild(fvJob.job.jobId, "worker-a", 60000);
  const v3 = await store.beginVersion(fvJob.job.jobId, fvLease.leaseId, "cls-1", 1);
  push("failVersion", projVersion(await store.failVersion(v3.dto.packVersionId, fvJob.job.jobId, fvLease.leaseId, "bad collect")));
  push("failVersion-job", projJob(await store.getBuildJob(fvJob.job.jobId)));

  // Weather layer.
  const wx = {
    snapshotId: "wx-scenario-1",
    destinationId: TESTVILLE.destinationId,
    provider: "open-meteo",
    kind: "forecast",
    startDate: "2026-11-01",
    endDate: "2026-11-03",
    fetchedAt: "2026-10-22T00:00:00.000Z",
    days: [{ date: "2026-11-01", tMax: 10, tMin: 2, precipProb: 20 }],
    provenance: { source: "open-meteo", sourceRef: null, recordedAt: null, label: "scenario" }
  };
  await store.putWeatherSnapshot(wx);
  const wx2 = { ...wx, snapshotId: "wx-scenario-2", fetchedAt: "2026-10-22T06:00:00.000Z", days: [{ date: "2026-11-01", tMax: 12, tMin: 3, precipProb: 10 }] };
  await store.putWeatherSnapshot(wx2);
  const freshest = await store.getWeatherSnapshot(TESTVILLE.destinationId, "forecast", "2026-11-01", "2026-11-03");
  push("weather-freshest", { id: freshest.snapshotId, tMax: freshest.days[0].tMax });
  push("weather-kind-isolation", await store.getWeatherSnapshot(TESTVILLE.destinationId, "historical", "2026-11-01", "2026-11-03"));
  push("weather-list", (await store.listWeatherSnapshots(TESTVILLE.destinationId)).map((w) => w.snapshotId));
  await throwsCode(
    () => store.putWeatherSnapshot({ ...wx, snapshotId: "wx-x", destinationId: "dst-unknown" }),
    "UNKNOWN_DESTINATION",
    "weather for unknown destination"
  );
  await throwsCode(() => store.enqueueBuild("dst-unknown", "seed"), "UNKNOWN_DESTINATION", "enqueue unknown destination");

  return log;
}

/* ------------------------------------------------------------------ */
/* B. PlacesLedgerStore scenario                                       */
/* ------------------------------------------------------------------ */

const projCounters = (c) => ({
  textSearch: c.textSearch,
  placeDetails: c.placeDetails
});
const projOp = (op) => ({
  shape: /^placesop-/.test(op.operationKey),
  scope: op.scope,
  month: op.month,
  sku: op.sku,
  packVersionId: op.packVersionId,
  candidateKey: op.candidateKey,
  status: op.status,
  settled: op.settledAt !== null,
  note: op.note
});

async function ledgerScenario(store) {
  const log = [];
  const push = (name, value) => log.push([name, value]);
  const SCOPE = "roamly-production";
  const MONTH = "2026-10";

  push("counters-empty", projCounters(await store.getCounters(SCOPE, MONTH)));
  const r1 = await store.tryReserve({ scope: SCOPE, sku: "placeDetails", cap: 2, packVersionId: "packv-1", candidateKey: "osm:node/1" });
  push("reserve-1", projOp(r1));
  const r2 = await store.tryReserve({ scope: SCOPE, sku: "placeDetails", cap: 2, packVersionId: "packv-1", candidateKey: "osm:node/2" });
  push("reserve-2", projOp(r2));
  push("reserve-3-over-cap", await store.tryReserve({ scope: SCOPE, sku: "placeDetails", cap: 2, packVersionId: "packv-1", candidateKey: "osm:node/3" }));
  push("counters-reserved", projCounters(await store.getCounters(SCOPE, MONTH)));

  push("commit-1", projOp(await store.commit(r1.operationKey)));
  push("counters-after-commit", projCounters(await store.getCounters(SCOPE, MONTH)));
  await throwsCode(() => store.commit(r1.operationKey), "OPERATION_ALREADY_SETTLED", "double commit");
  await throwsCode(() => store.commit("placesop-missing"), "OPERATION_NOT_FOUND", "commit missing op");

  push("release-2", projOp(await store.release(r2.operationKey, "call never made")));
  push("counters-after-release", projCounters(await store.getCounters(SCOPE, MONTH)));

  const r3 = await store.tryReserve({ scope: SCOPE, sku: "textSearch", cap: 9000, packVersionId: "packv-1", candidateKey: "osm:node/1" });
  push("reserve-search", projOp(r3));
  push("reconcile-3", projOp(await store.markReconciliation(r3.operationKey, "outcome unknown")));
  push("counters-reconcile-keeps-unit", projCounters(await store.getCounters(SCOPE, MONTH)));
  push("commit-reconciled", projOp(await store.commit(r3.operationKey)));
  push("counters-final", projCounters(await store.getCounters(SCOPE, MONTH)));

  push("getOperation", projOp(await store.getOperation(r1.operationKey)));
  push("getOperation-missing", await store.getOperation("placesop-missing"));
  push(
    "listOperations",
    (await store.listOperations(SCOPE, MONTH)).map((op) => ({ sku: op.sku, status: op.status }))
  );
  push("counters-other-scope", projCounters(await store.getCounters("other-scope", MONTH)));
  return log;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const { InMemoryPackStore } = await import("@/lib/roamly/engine/packs/store");
  const { SupabasePackStore } = await import("@/lib/roamly/engine/packs/supabaseStore");
  const builder = await import("@/lib/roamly/engine/packs/builder");
  const { InMemoryPlacesLedgerStore } = await import("@/lib/roamly/engine/places/ledger");
  const { SupabasePlacesLedgerStore } = await import("@/lib/roamly/engine/places/supabaseLedgerStore");

  // A — pack store conformance
  const memClockA = makeClock();
  const memLog = await packScenario(new InMemoryPackStore(memClockA), memClockA, builder);
  const supClockA = makeClock();
  const supLog = await packScenario(new SupabasePackStore(createFakeSupabaseClient(), supClockA), supClockA, builder);
  eq(supLog, memLog, "A: SupabasePackStore outcome log matches InMemoryPackStore");
  ok(true, `A: pack scenario completed (${memLog.length} comparable outcomes)`);

  // B — ledger store conformance
  const fixedClock = () => new Date(Date.UTC(2026, 9, 22, 12, 0, 0));
  let memTick = 0;
  const memClockB = () => new Date(Date.UTC(2026, 9, 22, 12, 0, 0) + (memTick += 1000));
  const memLedgerLog = await ledgerScenario(new InMemoryPlacesLedgerStore(memClockB));
  void fixedClock;
  let supTick = 0;
  const supClockB = () => new Date(Date.UTC(2026, 9, 22, 12, 0, 0) + (supTick += 1000));
  const supLedgerLog = await ledgerScenario(new SupabasePlacesLedgerStore(createFakeSupabaseClient(), supClockB));
  eq(supLedgerLog, memLedgerLog, "B: SupabasePlacesLedgerStore outcome log matches InMemoryPlacesLedgerStore");
  ok(true, `B: ledger scenario completed (${memLedgerLog.length} comparable outcomes)`);

  // C — the runtime deps factory
  const { buildEngineRuntimeDeps } = await import("@/lib/roamly/engine/generate");
  const savedEnv = { ...process.env };
  try {
    delete process.env.ROAMLY_PACK_STORE;
    eq(buildEngineRuntimeDeps(null), null, "C: factory null without ROAMLY_PACK_STORE");
    process.env.ROAMLY_PACK_STORE = "supabase";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    eq(buildEngineRuntimeDeps(null), null, "C: factory null without a service-role admin client");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
    delete process.env.GOOGLE_PLACES_API_KEY;
    const deps = buildEngineRuntimeDeps(null);
    ok(deps !== null, "C: factory wires deps with pack store = supabase + admin client");
    ok(deps.packStore instanceof SupabasePackStore, "C: pack store is the Supabase implementation");
    ok(deps.placesService !== null, "C: places service constructed (mode off without the owner key)");
    eq(
      await deps.packStore.getDestination("dst-paris") !== null ||
        (await deps.packStore.listDestinations()).some((d) => d.displayName === "Paris"),
      true,
      "C: registry serves Paris"
    );
  } finally {
    process.env = savedEnv;
  }

  console.log(`roamly wiring ship checks: ${passed} assertions PASS`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
