// Pack-rescue checks (2026-11-07).
//
// The Tokyo pack stall (PACK-STALL-REPORT): a build the pack KICK
// started sits at status "building" under a lease for most of
// every hour. The hourly pack-refresh cron could not see it — its
// work gate counted only "queued" rows, and drainQueuedBuilds only
// offered "queued" jobs to runBuildJob — so when the kick's
// function died mid-build, claimBuild's expired-lease steal (the
// reclaim mechanism that already existed) was never invoked until
// some later tick happened to find the row queued again. A whole
// hourly tick passed silently while a trip waited.
//
// The fix is exactly two hunks, pinned here:
//   1. drainQueuedBuilds also offers "building" jobs to
//      runBuildJob — an expired lease is stolen and the build
//      completes in the SAME drain; a live lease makes claimBuild
//      return null and the drain safely no-ops (the collector
//      never runs, the holder's lease is untouched);
//   2. the cron route's work gate counts queued+building rows, so
//      a tick with only a stranded building job still wakes the
//      drain (source assertion on the route + the real workGate
//      helpers driven through the same predicate shape).
//
// Everything runs against the real InMemoryPackStore (the contract
// the Supabase store mirrors) with an injectable clock, so lease
// expiry is exact, not slept through.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}

const { InMemoryPackStore } = await import("@/lib/roamly/engine/packs/store.ts");
const { drainQueuedBuilds } = await import("@/lib/roamly/engine/packs/builder.ts");
const { countWorkRows, anyWorkPresent } = await import("@/lib/roamly/workGate.ts");

const root = path.resolve(new URL("..", import.meta.url).pathname);

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
}

const PACK_LEASE_TTL_MS = 600_000; // types.ts PACK_LEASE_TTL_MS — the production lease
const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);

let destSeq = 0;
function testDestination() {
  destSeq += 1;
  return {
    destinationId: `dst-rescue-${destSeq}`,
    displayName: `Rescuetown ${destSeq}`,
    country: "Testland",
    centre: { lat: 35.68, lon: 139.69 },
    bbox: null,
    timeZone: "UTC",
    geocodeProvenance: { source: "test", sourceRef: null, recordedAt: null, label: "pack rescue checks" }
  };
}
function fakeCandidates() {
  return [
    { candidateKey: "osm:test/stay-1", osmKey: "test/stay-1", kind: "stay", name: "Rescuetown Grand Hotel", nameEn: null, pos: { lat: 35.681, lon: 139.691 }, hoursRaw: null, tags: {}, url: "https://example.invalid/stay", enrichment: null },
    { candidateKey: "osm:test/sight-1", osmKey: "test/sight-1", kind: "museum", name: "Rescuetown Museum", nameEn: null, pos: { lat: 35.682, lon: 139.69 }, hoursRaw: null, tags: {}, url: "https://example.invalid/museum", enrichment: null }
  ];
}
const TEST_PROVENANCE = { source: "test", sourceRef: "pack-rescue-checks", recordedAt: "2026-11-07T00:00:00.000Z", label: "pack rescue collector" };
function countingCollector(calls) {
  return () => async () => {
    calls.count += 1;
    return { candidates: fakeCandidates(), provenance: TEST_PROVENANCE };
  };
}
function makeStore(startMs) {
  let nowMs = startMs;
  const store = new InMemoryPackStore(() => new Date(nowMs));
  return { store, setNow: (ms) => { nowMs = ms; } };
}

/* ------------------------------------------------------------------ */
/* 1. A building job with an EXPIRED lease is reclaimed by the drain   */
/* ------------------------------------------------------------------ */

console.log("(1) expired-lease building job — reclaimed in the same drain");

{
  const { store, setNow } = makeStore(T0);
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  // The kick claims the build, then its function dies mid-build:
  // the row stays "building" under the kick's lease.
  const kickLease = await store.claimBuild(job.jobId, "pack-kick", PACK_LEASE_TTL_MS);
  ok(kickLease, "1a: the kick claimed the build");
  eq((await store.getBuildJob(job.jobId)).status, "building", "1a: the job sits at building");

  // The hourly tick arrives after the lease has expired.
  setNow(T0 + PACK_LEASE_TTL_MS + 60_000);
  const calls = { count: 0 };
  const published = await drainQueuedBuilds(store, countingCollector(calls), {
    workerId: "pack-refresh-cron"
  });
  eq(published.length, 1, "1b: the drain published the stranded build in the same tick");
  eq(calls.count, 1, "1b: the collector ran exactly once — for the reclaimed build");
  const after = await store.getBuildJob(job.jobId);
  eq(after.status, "done", "1b: the reclaimed job completed");
  const ready = await store.getReadyVersion(dest.destinationId);
  ok(ready && ready.dto.packVersionId === published[0].dto.packVersionId, "1b: the reclaimed version is the serving version");
}

/* ------------------------------------------------------------------ */
/* 2. A building job with a LIVE lease is skipped safely               */
/* ------------------------------------------------------------------ */

console.log("(2) live-lease building job — offered, refused, untouched");

{
  const { store, setNow } = makeStore(T0);
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const kickLease = await store.claimBuild(job.jobId, "pack-kick", PACK_LEASE_TTL_MS);
  ok(kickLease, "2a: the kick claimed the build");

  // The tick arrives while the kick is still legitimately building.
  setNow(T0 + 60_000);
  const calls = { count: 0 };
  const published = await drainQueuedBuilds(store, countingCollector(calls), {
    workerId: "pack-refresh-cron"
  });
  eq(published.length, 0, "2b: nothing published — the live holder keeps its build");
  eq(calls.count, 0, "2b: the collector never ran for a held job");
  const after = await store.getBuildJob(job.jobId);
  eq(after.status, "building", "2b: the job is still building");
  eq(after.lease.workerId, "pack-kick", "2b: the lease still belongs to the kick");
  eq(after.lease.epoch, 1, "2b: the lease epoch never rotated — no steal was attempted on a live lease");
  eq(after.lease.leaseId, kickLease.leaseId, "2b: the fencing token is untouched");
}

/* ------------------------------------------------------------------ */
/* 3. Queued jobs drain exactly as before                              */
/* ------------------------------------------------------------------ */

console.log("(3) queued job — unchanged behaviour");

{
  const { store } = makeStore(T0);
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const calls = { count: 0 };
  const published = await drainQueuedBuilds(store, countingCollector(calls), {
    workerId: "pack-refresh-cron"
  });
  eq(published.length, 1, "3: a queued job still drains and publishes");
  eq((await store.getBuildJob(job.jobId)).status, "done", "3: the queued job completed");
}

/* ------------------------------------------------------------------ */
/* 4. Terminal jobs are never re-offered                               */
/* ------------------------------------------------------------------ */

console.log("(4) failed/done jobs — the widened filter sweeps nothing terminal");

{
  const { store } = makeStore(T0);
  const dest = testDestination();
  await store.registerDestination(dest);
  await store.enqueueBuild(dest.destinationId, "cold-read");
  const failingFor = () => async () => {
    throw new Error("collector exploded");
  };
  await assert.rejects(
    () => drainQueuedBuilds(store, failingFor, { workerId: "pack-refresh-cron" }),
    /collector exploded/,
    "4a: a collector failure surfaces from the drain (recorded, not swallowed)"
  );
  const jobs = await store.listBuildJobs();
  eq(jobs.length, 1, "4a: still exactly one job row");
  eq(jobs[0].status, "failed", "4a: the failed job is recorded failed");
  const calls = { count: 0 };
  const published = await drainQueuedBuilds(store, countingCollector(calls), {
    workerId: "pack-refresh-cron"
  });
  eq(published.length, 0, "4b: a failed job is not re-offered by the widened drain");
  eq(calls.count, 0, "4b: the collector does not re-run for a failed job");
}

/* ------------------------------------------------------------------ */
/* 5. The route gate counts building rows too                          */
/* ------------------------------------------------------------------ */

console.log("(5) work gate — a building-only table still wakes the drain");

{
  // A minimal PostgREST-shaped fake: rows exist per status; the
  // route's exact predicate (in status queued/building) is applied
  // through the real countWorkRows helper.
  const rowsByStatus = { queued: 0, building: 1, done: 4, failed: 1 };
  const fakeAdmin = {
    from() {
      const state = { statuses: null };
      const query = {
        select() {
          return query;
        },
        in(column, values) {
          state.statuses = values;
          return query;
        },
        eq(column, value) {
          state.statuses = [value];
          return query;
        },
        then(resolve) {
          const total = (state.statuses || []).reduce((sum, s) => sum + (rowsByStatus[s] || 0), 0);
          resolve({ count: total, error: null });
        }
      };
      return query;
    }
  };
  const widened = await countWorkRows(fakeAdmin, "roamly_destination_pack_builds", (query) =>
    query.in("status", ["queued", "building"])
  );
  eq(widened, 1, "5a: the widened predicate counts the building row");
  eq(anyWorkPresent([widened]), true, "5a: the gate opens for a building-only table — the tick drains");
  const oldPredicate = await countWorkRows(fakeAdmin, "roamly_destination_pack_builds", (query) =>
    query.eq("status", "queued")
  );
  eq(anyWorkPresent([oldPredicate]), false, "5b: the old queued-only predicate would have gated this tick out (the stall)");

  const routeSource = fs.readFileSync(
    path.join(root, "app/api/cron/roamly-pack-refresh/route.ts"),
    "utf8"
  );
  ok(
    routeSource.includes('query.in("status", ["queued", "building"])'),
    "5c: the route gate uses the widened predicate"
  );
  ok(
    routeSource.includes("no_queued_or_building_pack_builds"),
    "5c: the gated response names both statuses honestly"
  );
  const builderSource = fs.readFileSync(path.join(root, "lib/roamly/engine/packs/builder.ts"), "utf8");
  ok(
    builderSource.includes('job.status !== "queued" && job.status !== "building"'),
    "5d: the drain offers queued and building jobs, nothing else"
  );
}

console.log(`\nPASS: ${count} pack-rescue checks — a stranded build is reclaimed in the same tick.`);
