// Roamly pack-kick checks (2026-10-22, immediate pack-build kick;
// 2026-10-22/23 kill-loop fix: the kick never builds in a box that
// cannot finish it):
//
//   The outline stage leaves a trip waiting on a queued pack build;
//   the kick drains that build as post-response work instead of
//   leaving it for the hourly pack-refresh cron. These checks pin
//   the contract:
//     1. A kick fires on a freshly enqueued build and publishes.
//     2. No kick when a ready pack already serves the destination.
//     3. No kick when a build is already claimed (live lease).
//     4. Two concurrent kicks produce exactly ONE build (the
//        store's claim is the single-flight discipline).
//     5. A failing collector: runPackKick reports the error, the
//        job records it, nothing publishes, and the serving read
//        re-enqueues a fresh job — the trip stays honestly waiting.
//     6. A "building" job whose lease expired is RECYCLED to
//        "queued" (never stolen) and then built inside the kick
//        budget — the kick never builds on a held job.
//     7. drainQueuedBuilds' onlyDestinationId filter builds only
//        the target; the unfiltered drain (the cron's call) is
//        unchanged.
//     8. Outline integration through advanceEngineGeneration: the
//        waiting wake schedules exactly one kick task; running the
//        scheduled tasks builds the pack exactly once even when
//        two wakes scheduled two tasks; the next wake proceeds
//        past the outline. Without an injected scheduler there is
//        no kick at all (pre-kick behavior preserved).
//     9. Kick budget respected: a collector that outlasts the kick
//        budget releases the job back to "queued" (lease cleared,
//        NO failure recorded) and returns null — the trip waits
//        honestly, nothing publishes, and the failure-recording
//        path (§5) is untouched for pre-budget failures.
//    10. Release-then-cron-reclaim: after a budget release, an
//        unfiltered drain WITHOUT the budget (the cron's call)
//        claims the job again and publishes — the loop cannot
//        strand the job, and decidePackKick no longer suppresses
//        the wake after a release ("build-in-flight" lockout gone).
//    11. Big-city live-shaped run: the REAL collector against
//        slow stubbed fetches (Lisbon-class fan-out latency) inside
//        a short-lived harness — proves the release path against
//        the real collection shape, not a mocked one.
//
// Run: npm run test:pack-kick

import assert from "node:assert/strict";

import { advanceEngineGeneration, startEngineGeneration, ZERO_ENGINE_SOURCE } from "@/lib/roamly/engine/generate.ts";
import { InMemoryPackStore } from "@/lib/roamly/engine/packs/store.ts";
import { drainQueuedBuilds, liveCollector, readServingPack } from "@/lib/roamly/engine/packs/builder.ts";
import { decidePackKick, runPackKick } from "@/lib/roamly/engine/packs/kick.ts";

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label}\n  GOT:  ${JSON.stringify(actual)}\n  WANT: ${JSON.stringify(expected)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

let destSeq = 0;
function testDestination() {
  destSeq += 1;
  return {
    destinationId: `dst-kick-${destSeq}`,
    displayName: `Kicktown ${destSeq}`,
    country: "Testland",
    centre: { lat: 45.0, lon: -64.0 },
    bbox: null,
    timeZone: "UTC",
    geocodeProvenance: { source: "test", sourceRef: null, recordedAt: null, label: "kick checks" }
  };
}

function fakeCandidates() {
  return [
    { candidateKey: "osm:test/stay-1", osmKey: "test/stay-1", kind: "stay", name: "Kicktown Grand Hotel", nameEn: null, pos: { lat: 45.001, lon: -64.001 }, hoursRaw: null, tags: {}, url: "https://example.invalid/stay", enrichment: null },
    { candidateKey: "osm:test/sight-1", osmKey: "test/sight-1", kind: "museum", name: "Kicktown Museum", nameEn: null, pos: { lat: 45.002, lon: -64.0 }, hoursRaw: null, tags: {}, url: "https://example.invalid/museum", enrichment: null },
    { candidateKey: "osm:test/food-1", osmKey: "test/food-1", kind: "food", name: "Kicktown Bistro", nameEn: null, pos: { lat: 45.0, lon: -64.002 }, hoursRaw: null, tags: {}, url: "https://example.invalid/bistro", enrichment: null }
  ];
}

const TEST_PROVENANCE = { source: "test", sourceRef: "kick-checks", recordedAt: "2026-10-22T00:00:00.000Z", label: "kick checks collector" };

function countingCollector(calls, { delayMs = 0, failWith = null } = {}) {
  return () => async () => {
    calls.count += 1;
    if (delayMs) await sleep(delayMs);
    if (failWith) throw new Error(failWith);
    return { candidates: fakeCandidates(), provenance: TEST_PROVENANCE };
  };
}

/* ---------------- §1 — kick fires on enqueue ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const serving = await readServingPack(store, dest.destinationId);
  eq(serving.state, "pending", "§1 cold read is pending (build enqueued by the read)");
  const calls = { count: 0 };
  const result = await runPackKick(store, dest.destinationId, { collectorFor: countingCollector(calls) });
  eq(result.decision.kick, true, "§1 decision is to kick a freshly enqueued build");
  eq(result.decision.reason, "queued-build-waiting", "§1 reason names the queued build");
  eq(result.error, null, "§1 kick reports no error");
  eq(result.publishedPackVersionIds.length, 1, "§1 kick publishes exactly one version");
  eq(calls.count, 1, "§1 collector ran exactly once");
  const ready = await store.getReadyVersion(dest.destinationId);
  ok(ready && ready.dto.packVersionId === result.publishedPackVersionIds[0], "§1 the published version is the serving version");
  const job = await store.getBuildJob(result.decision.jobId);
  eq(job.status, "done", "§1 the build job completed");
}

/* ---------------- §2 — no kick when a pack already serves ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const calls = { count: 0 };
  const collectorFor = countingCollector(calls);
  await store.enqueueBuild(dest.destinationId, "cold-read");
  await runPackKick(store, dest.destinationId, { collectorFor });
  eq(calls.count, 1, "§2 setup: pack built");
  const decision = await decidePackKick(store, dest.destinationId);
  eq(decision.kick, false, "§2 no kick once a pack serves");
  eq(decision.reason, "pack-ready", "§2 reason is pack-ready");
  const again = await runPackKick(store, dest.destinationId, { collectorFor });
  eq(again.publishedPackVersionIds.length, 0, "§2 a redundant kick publishes nothing");
  eq(calls.count, 1, "§2 collector never runs again");
}

/* ---------------- §3 — no kick when a build is already claimed ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const lease = await store.claimBuild(job.jobId, "other-worker", 60_000);
  ok(lease, "§3 setup: another worker holds the claim");
  const decision = await decidePackKick(store, dest.destinationId);
  eq(decision.kick, false, "§3 no kick while a build is claimed");
  eq(decision.reason, "build-in-flight", "§3 reason is build-in-flight");
  const calls = { count: 0 };
  const result = await runPackKick(store, dest.destinationId, { collectorFor: countingCollector(calls) });
  eq(calls.count, 0, "§3 the kick's collector never runs");
  eq(result.publishedPackVersionIds.length, 0, "§3 nothing publishes");
  const after = await store.getBuildJob(job.jobId);
  eq(after.status, "building", "§3 the claimed job is untouched");
  eq(after.lease.leaseId, lease.leaseId, "§3 the lease is still the other worker's");
}

/* ---------------- §4 — concurrent kicks build exactly once ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  await store.enqueueBuild(dest.destinationId, "cold-read");
  const calls = { count: 0 };
  const collectorFor = countingCollector(calls, { delayMs: 40 });
  const [a, b] = await Promise.all([
    runPackKick(store, dest.destinationId, { collectorFor, workerId: "kick-a" }),
    runPackKick(store, dest.destinationId, { collectorFor, workerId: "kick-b" })
  ]);
  eq(calls.count, 1, "§4 two concurrent kicks run the collector exactly once");
  eq(a.publishedPackVersionIds.length + b.publishedPackVersionIds.length, 1, "§4 exactly one publish across both kicks");
  const versions = await store.listVersions(dest.destinationId);
  eq(versions.filter((v) => v.dto.status === "ready").length, 1, "§4 exactly one ready version exists");
}

/* ---------------- §5 — failure leaves the trip honestly waiting ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const calls = { count: 0 };
  const result = await runPackKick(store, dest.destinationId, {
    collectorFor: countingCollector(calls, { failWith: "overpass at capacity" })
  });
  eq(result.decision.kick, true, "§5 the kick was attempted");
  ok(result.error && result.error.includes("overpass at capacity"), "§5 the failure is reported in the result, not thrown");
  eq(result.publishedPackVersionIds.length, 0, "§5 nothing publishes on failure");
  eq(await store.getReadyVersion(dest.destinationId), null, "§5 still no serving pack");
  const failed = await store.getBuildJob(job.jobId);
  eq(failed.status, "failed", "§5 the build job records the failure");
  ok(failed.error && failed.error.includes("overpass at capacity"), "§5 the job carries the collector's error");
  const serving = await readServingPack(store, dest.destinationId);
  eq(serving.state, "pending", "§5 the serving read still waits (honest posture)");
  ok(serving.job && serving.job.jobId !== job.jobId, "§5 a FRESH job is enqueued for the retry (cron/next wake)");
}

/* ---------------- §6 — expired-lease build is recycled, never stolen ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const lease = await store.claimBuild(job.jobId, "dead-worker", 5);
  ok(lease, "§6 setup: claim taken with a 5ms lease");
  await sleep(15);
  const decision = await decidePackKick(store, dest.destinationId);
  eq(decision.kick, true, "§6 an expired-lease build is kickable");
  eq(decision.jobStatus, "building", "§6 the decision names the expired-lease building job");
  ok(decision.leaseId, "§6 the decision carries the fencing token for the release");
  const calls = { count: 0 };
  const result = await runPackKick(store, dest.destinationId, { collectorFor: countingCollector(calls), kickBudgetMs: 5000 });
  eq(result.error, null, "§6 the recycle reports no error");
  eq(calls.count, 1, "§6 the recycled job is built by the ordinary queued drain");
  eq(result.publishedPackVersionIds.length, 1, "§6 the recycled build publishes");
  const done = await store.getBuildJob(job.jobId);
  eq(done.status, "done", "§6 the job completed (no steal ever happened)");
}

/* ---------------- §7 — drain filter; unfiltered drain unchanged ---------------- */
{
  const store = new InMemoryPackStore();
  const a = testDestination();
  const b = testDestination();
  await store.registerDestination(a);
  await store.registerDestination(b);
  await store.enqueueBuild(a.destinationId, "cold-read");
  await store.enqueueBuild(b.destinationId, "cold-read");
  const calls = { count: 0 };
  const collectorFor = countingCollector(calls);
  const filtered = await drainQueuedBuilds(store, collectorFor, { workerId: "kick", onlyDestinationId: a.destinationId });
  eq(filtered.length, 1, "§7 the filtered drain publishes only its target");
  eq(filtered[0].dto.destinationId, a.destinationId, "§7 the filtered drain built destination A");
  const bJobs = await store.listBuildJobs(b.destinationId);
  eq(bJobs[0].status, "queued", "§7 destination B is still queued after the filtered drain");
  const rest = await drainQueuedBuilds(store, collectorFor, { workerId: "cron" });
  eq(rest.length, 1, "§7 the unfiltered drain (the cron's call) builds what remains");
  eq(rest[0].dto.destinationId, b.destinationId, "§7 the unfiltered drain built destination B");
}

/* ---------------- §8 — outline integration through the real advance ---------------- */

function createMemoryGenerationStore() {
  const trips = new Map();
  const itineraries = new Map();
  const predictions = new Map();
  let rev = 0;
  const statusFor = (state) =>
    state.status === "complete" ? "generated" : state.status === "failed" || state.status === "partially_failed" ? "draft" : "generating";
  function writeRow(trip, state, run) {
    rev += 1;
    const row = trips.get(trip.id);
    const metadata = { ...(row ? row.metadata : {}), generation: clone(state), zeroEngine: clone(run) };
    const next = {
      id: trip.id,
      user_id: trip.user_id,
      metadata,
      status: statusFor(state),
      itinerary_status: statusFor(state),
      itinerary_generated_at: row ? row.itinerary_generated_at : null,
      updated_at: `rev-${rev}`
    };
    trips.set(trip.id, next);
    return clone(next);
  }
  return {
    trips,
    seedTrip(tripId, userId) {
      rev += 1;
      trips.set(tripId, {
        id: tripId,
        user_id: userId,
        metadata: {},
        status: "generating",
        itinerary_status: "generating",
        itinerary_generated_at: null,
        updated_at: `rev-${rev}`
      });
    },
    async loadTrip(tripId, userId) {
      const row = trips.get(tripId);
      if (!row || (userId && row.user_id !== userId)) throw new Error(`trip ${tripId} not found`);
      return clone(row);
    },
    async persistState(trip, state, run) {
      const row = trips.get(trip.id);
      if (!row || row.updated_at !== trip.updated_at) throw new Error("CAS conflict on persistState");
      return writeRow(trip, state, run);
    },
    async claim(trip, state, run) {
      const row = trips.get(trip.id);
      if (!row || row.updated_at !== trip.updated_at) return null;
      return writeRow(trip, state, run);
    },
    async persistItinerary(trip, itinerary, final) {
      itineraries.set(trip.id, { trip_id: trip.id, user_id: trip.user_id, full_json: clone(itinerary), source: final ? ZERO_ENGINE_SOURCE : null, final });
    },
    async writePrediction(record) {
      if (predictions.has(record.predictionId)) return { written: false };
      predictions.set(record.predictionId, clone(record));
      return { written: true };
    },
    async markFreeItineraryUsed() {
      return { ok: true };
    },
    async lockItinerary() {
      return {};
    }
  };
}

const USER_ID = "pack-kick-harness-user";
const TESTBURGH = {
  destinationId: "dst-testburgh",
  displayName: "Testburgh",
  country: "Testland",
  centre: { lat: 45.0, lon: -64.0 },
  bbox: null,
  timeZone: "UTC",
  geocodeProvenance: { source: "test", sourceRef: null, recordedAt: null, label: "pack-kick checks" }
};
const testburghPayload = {
  origin: "Saint John",
  originCity: "Saint John",
  destination: "Testburgh",
  destinationCity: "Testburgh",
  destinationCountry: "Testland",
  tripType: "single_destination",
  startDate: "2026-11-12",
  endDate: "2026-11-15",
  daysCount: 4,
  travelers: { adults: 2, children: 0, infants: 0 },
  travelersCount: 2,
  budgetAmount: 2400,
  budgetCurrency: "CAD",
  interests: ["food", "history"],
  pace: "Relaxed",
  travelStyle: "Relaxed",
  specialNotes: "",
  language: "en",
  explicitRequirements: []
};
const emptyContext = () => ({
  personalization: { enabled: false, accepted: {}, inferred: {}, aggregateGuidance: [] },
  confirmedBookings: []
});

async function startColdTrip({ genStore, tripId }) {
  genStore.seedTrip(tripId, USER_ID);
  await startEngineGeneration({
    store: genStore,
    tripId,
    userId: USER_ID,
    payload: testburghPayload,
    requestId: `req-${tripId}-start`,
    unlockSource: "paid",
    context: emptyContext()
  });
}

{
  // With a scheduler: the waiting wake schedules the kick; the
  // scheduled tasks build the pack exactly once; the trip proceeds.
  const packStore = new InMemoryPackStore();
  await packStore.registerDestination(TESTBURGH);
  const genStore = createMemoryGenerationStore();
  const scheduled = [];
  const calls = { count: 0 };
  const deps = {
    store: genStore,
    packStore,
    packKickScheduler: (task) => scheduled.push(task),
    packCollectorFor: countingCollector(calls, { delayMs: 10 })
  };
  const tripId = "trip-kick-1";
  await startColdTrip({ genStore, tripId });

  const wake1 = await advanceEngineGeneration({ deps, tripId, userId: USER_ID, requestId: "req-kick-wake-1" });
  eq(wake1.waitingForPack, true, "§8 the cold trip waits for its pack");
  eq(scheduled.length, 1, "§8 the waiting wake schedules exactly one kick task");
  eq(calls.count, 0, "§8 the build has NOT run inside the wake (post-response only)");

  const wake2 = await advanceEngineGeneration({ deps, tripId, userId: USER_ID, requestId: "req-kick-wake-2" });
  eq(wake2.waitingForPack, true, "§8 a second wake still waits (kick not yet run)");
  eq(scheduled.length, 2, "§8 the second wake schedules a second task (suppression lives in the claim)");

  await Promise.all(scheduled.map((task) => task()));
  eq(calls.count, 1, "§8 two scheduled kicks still build exactly once");
  const ready = await packStore.getReadyVersion(TESTBURGH.destinationId);
  ok(ready, "§8 the pack is ready after the kicks run");

  const wake3 = await advanceEngineGeneration({ deps, tripId, userId: USER_ID, requestId: "req-kick-wake-3" });
  ok(wake3.waitingForPack !== true, "§8 the next wake no longer waits for a pack");
  eq(scheduled.length, 2, "§8 no further kick is scheduled once the pack serves");
}

{
  // Without a scheduler: pre-kick behavior, byte for byte — the
  // trip waits and no build is attempted.
  const packStore = new InMemoryPackStore();
  await packStore.registerDestination(TESTBURGH);
  const genStore = createMemoryGenerationStore();
  const calls = { count: 0 };
  const deps = { store: genStore, packStore, packCollectorFor: countingCollector(calls) };
  const tripId = "trip-kick-2";
  await startColdTrip({ genStore, tripId });
  const wake = await advanceEngineGeneration({ deps, tripId, userId: USER_ID, requestId: "req-nokick-wake-1" });
  eq(wake.waitingForPack, true, "§8 without a scheduler the trip waits as before");
  eq(calls.count, 0, "§8 without a scheduler no build is attempted");
  eq(await packStore.getReadyVersion(TESTBURGH.destinationId), null, "§8 without a scheduler no pack appears");
}

/* ---------------- §9 — the kick budget releases (never strands) ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const calls = { count: 0 };
  // A metro-scale collector: outlasts the kick's budget (the
  // Lisbon kill loop — the function box would kill it mid-claim).
  const result = await runPackKick(store, dest.destinationId, {
    collectorFor: countingCollector(calls, { delayMs: 2000 }),
    kickBudgetMs: 200
  });
  eq(result.error, null, "§9 a budget release reports no error (not a failure)");
  eq(result.publishedPackVersionIds.length, 0, "§9 nothing publishes on a budget release");
  eq(await store.getReadyVersion(dest.destinationId), null, "§9 still no serving pack");
  const released = await store.getBuildJob(job.jobId);
  eq(released.status, "queued", "§9 the job is back to queued (the kill loop's 'building' strand is gone)");
  eq(released.lease, null, "§9 the lease is cleared");
  eq(released.error, null, "§9 NO failure is recorded on the job");
  // The trip's next wake is no longer suppressed by a
  // "build-in-flight" lockout: the decision is to kick again.
  const next = await decidePackKick(store, dest.destinationId);
  eq(next.kick, true, "§9 the next wake kicks again (no self-suppression)");
  eq(next.reason, "queued-build-waiting", "§9 reason is the queued build, not build-in-flight");
  // A fast failure (BEFORE the budget) still records a failure —
  // the release path does not swallow §5's contract.
  const { job: failJob } = await store.enqueueBuild(dest.destinationId, "cold-read-2");
  const fail = await runPackKick(store, dest.destinationId, {
    collectorFor: countingCollector({ count: 0 }, { failWith: "fast boom" }),
    kickBudgetMs: 2000
  });
  ok(fail.error && fail.error.includes("fast boom"), "§9 a pre-budget failure is still reported");
  const recorded = await store.getBuildJob(failJob.jobId);
  eq(recorded.status, "failed", "§9 a pre-budget failure still fails the job (not a release)");
}

/* ---------------- §10 — release-then-cron-reclaim end to end ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const slow = { count: 0 };
  const kick = await runPackKick(store, dest.destinationId, {
    collectorFor: countingCollector(slow, { delayMs: 2000 }),
    kickBudgetMs: 200
  });
  eq(kick.publishedPackVersionIds.length, 0, "§10 the short-lived kick releases without publishing");
  eq((await store.getBuildJob(job.jobId)).status, "queued", "§10 the job is queued after the release");
  // The cron's call: the SAME drain WITHOUT the budget (its 300 s
  // box owns the full collector deadline) — reclaims and publishes.
  const fast = { count: 0 };
  const reclaimed = await drainQueuedBuilds(store, countingCollector(fast), { workerId: "cron" });
  eq(reclaimed.length, 1, "§10 the unbudgeted drain reclaims the released job");
  const ready = await store.getReadyVersion(dest.destinationId);
  ok(ready && ready.dto.packVersionId === reclaimed[0].dto.packVersionId, "§10 the reclaimed build publishes the serving pack");
  eq((await store.getBuildJob(job.jobId)).status, "done", "§10 the job completed through the cron path");
}

/* ---------------- §11 — big-city live-shaped run (Lisbon class) ---------------- */
{
  // The REAL collector (liveCollector -> collectPoiCandidates)
  // against stubbed fetches that answer slowly, inside a
  // short-lived harness: proves the release path against the real
  // collection shape — 6 selector chunks + version assembly — not
  // a mocked collector. Lisbon's fan-out is exactly this shape
  // with a larger bbox.
  const store = new InMemoryPackStore();
  const dest = { ...testDestination(), displayName: "Lisbon Class", bbox: { minLat: 38.65, maxLat: 38.77, minLon: -9.22, maxLon: -9.06 } };
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  let fetchCalls = 0;
  const slowFetcher = async () => {
    fetchCalls += 1;
    await sleep(1500); // each chunk fetch outlasts the whole harness budget
    return { ok: true, status: 200, text: async () => JSON.stringify({ elements: [] }) };
  };
  const began = Date.now();
  const result = await runPackKick(store, dest.destinationId, {
    collectorFor: () => liveCollector(slowFetcher),
    kickBudgetMs: 300
  });
  const elapsed = Date.now() - began;
  eq(result.error, null, "§11 the live-shaped run releases without error");
  eq(result.publishedPackVersionIds.length, 0, "§11 nothing publishes inside the harness lifetime");
  ok(elapsed < 1500, `§11 the harness returned in ${elapsed}ms — long before any chunk fetch finished`);
  const released = await store.getBuildJob(job.jobId);
  eq(released.status, "queued", "§11 the job is back to queued after the live-shaped release");
  eq(released.lease, null, "§11 the lease is cleared");
  ok(fetchCalls >= 1, "§11 the real collector issued real chunk fetches (not a mocked collector)");
  const next = await decidePackKick(store, dest.destinationId);
  eq(next.kick, true, "§11 the trip is not lockout-suppressed after the release");
}

/* ---------------- §12 — KF-2: the pack wait is bounded ---------------- */
{
  // A cold trip waits honestly while the wait is young, and fails
  // LOUDLY once the wait exceeds the bound — never another silent
  // busy. (Montreal, 2026-10-24: 75 waits, zero errors, forever.)
  const packStore = new InMemoryPackStore();
  await packStore.registerDestination(TESTBURGH);
  const genStore = createMemoryGenerationStore();
  const deps = { store: genStore, packStore };
  const tripId = "trip-kf2-pack-wait";
  await startColdTrip({ genStore, tripId });
  const young = await advanceEngineGeneration({ deps, tripId, userId: USER_ID, requestId: "req-kf2-young" });
  eq(young.waitingForPack, true, "§12 a young cold wait still waits (the bound does not break the normal path)");
  eq(young.status, "queued", "§12 the young wait stays queued, not failed");
  // Backdate the run past the 2h default bound, wake again.
  const row = genStore.trips.get(tripId);
  row.metadata.zeroEngine.startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const aged = await advanceEngineGeneration({ deps, tripId, userId: USER_ID, requestId: "req-kf2-aged" });
  eq(aged.status, "failed", "§12 an over-bound pack wait fails instead of waiting forever");
  eq(aged.error, "ZERO_ENGINE_PACK_WAIT_TIMEOUT", "§12 the failure carries the named code");
  eq(aged.state.lastErrorCode, "ZERO_ENGINE_PACK_WAIT_TIMEOUT", "§12 the recorded state carries the named code");
  ok((aged.state.lastError || "").includes("map data"), "§12 the recorded error names the cause for the traveler");
  const after = await genStore.loadTrip(tripId, USER_ID);
  eq(after.metadata.generation.status, "failed", "§12 the failed state persists");
  eq(after.metadata.generation.currentStage, "failed", "§12 the failed stage persists");
}

console.log(`PACK-KICK CHECKS: ${count}/${count} PASS`);
