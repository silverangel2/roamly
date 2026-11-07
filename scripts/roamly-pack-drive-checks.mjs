// Roamly SPEED FIX checks (2026-11-07) — CONTINUOUS PACK DRIVING.
// The pack kick could only START a big-city build: its 45 s budget
// released the job back to queued by design, and only the hourly
// pack-refresh cron could ever finish it (CRAWL-INVESTIGATION-
// REPORT: fresh trips waited 41–78 minutes, 87–94% pure timer
// wait). drivePackBuild (packs/kick.ts) closes that: the kick,
// looped inside the requesting trip's own post-response window,
// each attempt budgeted by the drive's remaining lifetime.
//
//   §1 Contrast: a plain kick with a short budget releases a slow
//      collector (nothing publishes, job queued, no failure
//      recorded); a DRIVE over the same collector publishes it in
//      one attempt — the attempt budget is the drive's, not 45 s.
//   §2 The loop itself: an attempt budget-released mid-drive is
//      re-decided and re-claimed IMMEDIATELY inside the same
//      drive call and the build completes — no cron tick exists
//      anywhere in this harness. (A frozen drive clock keeps every
//      attempt's budget at the drive size; the release is forced
//      by a collector slower than one attempt but faster than
//      two.)
//   §3 Drive stops at pack-ready: no collector run, no publish.
//   §4 Drive stops at build-in-flight: another worker's live lease
//      owns the build; the drive does not touch it.
//   §5 A failing collector ends the drive after exactly ONE
//      attempt (no spin): outcome build-failed, the job records
//      the failure honestly.
//   §6 A collector that outlasts even the drive budget: outcome
//      budget-exhausted, the job is back at queued with NO failure
//      recorded — the hourly backstop (or the next wake) owns it
//      from there, exactly the pre-fix posture but reached in
//      seconds of trying instead of an hour of waiting.
//   §7 Generate integration: a cold trip's waiting wake schedules
//      the drive; running the scheduled tasks builds the pack
//      exactly once; the waiting state is the NAMED pack-wait
//      state (F8: waitingOnPack stamped, cleared on outline
//      success); the next wake proceeds past the outline.
//
// Run: npm run test:pack-drive

import assert from "node:assert/strict";

const { advanceEngineGeneration, startEngineGeneration, ZERO_ENGINE_SOURCE } = await import(
  "@/lib/roamly/engine/generate.ts"
);
const { InMemoryPackStore } = await import("@/lib/roamly/engine/packs/store.ts");
const { readServingPack } = await import("@/lib/roamly/engine/packs/builder.ts");
const { runPackKick, drivePackBuild } = await import("@/lib/roamly/engine/packs/kick.ts");

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
  console.log(`  PASS ${label}`);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label}\n  GOT:  ${JSON.stringify(actual)}\n  WANT: ${JSON.stringify(expected)}`);
  console.log(`  PASS ${label}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

let destSeq = 0;
function testDestination() {
  destSeq += 1;
  return {
    destinationId: `dst-drive-${destSeq}`,
    displayName: `Drivetown ${destSeq}`,
    country: "Testland",
    centre: { lat: 45.0, lon: -64.0 },
    bbox: null,
    timeZone: "UTC",
    geocodeProvenance: { source: "test", sourceRef: null, recordedAt: null, label: "drive checks" }
  };
}

function fakeCandidates() {
  return [
    { candidateKey: "osm:test/stay-1", osmKey: "test/stay-1", kind: "stay", name: "Drivetown Grand Hotel", nameEn: null, pos: { lat: 45.001, lon: -64.001 }, hoursRaw: null, tags: {}, url: "https://example.invalid/stay", enrichment: null },
    { candidateKey: "osm:test/sight-1", osmKey: "test/sight-1", kind: "museum", name: "Drivetown Museum", nameEn: null, pos: { lat: 45.002, lon: -64.0 }, hoursRaw: null, tags: {}, url: "https://example.invalid/museum", enrichment: null },
    { candidateKey: "osm:test/food-1", osmKey: "test/food-1", kind: "food", name: "Drivetown Bistro", nameEn: null, pos: { lat: 45.0, lon: -64.002 }, hoursRaw: null, tags: {}, url: "https://example.invalid/bistro", enrichment: null }
  ];
}

const TEST_PROVENANCE = { source: "test", sourceRef: "drive-checks", recordedAt: "2026-11-07T00:00:00.000Z", label: "drive checks collector" };

/** A collector factory (destinationId) => PackCollector whose
 *  per-call delays come from `delays` (last value repeats). */
function scriptedCollector(calls, delays, { failWith = null } = {}) {
  return () => async () => {
    const idx = Math.min(calls.count, delays.length - 1);
    calls.count += 1;
    if (delays[idx]) await sleep(delays[idx]);
    if (failWith) throw new Error(failWith);
    return { candidates: fakeCandidates(), provenance: TEST_PROVENANCE };
  };
}

/* ---------------- §1 — kick releases, drive completes ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const calls = { count: 0 };
  const collectorFor = scriptedCollector(calls, [900]);
  const kick = await runPackKick(store, dest.destinationId, { collectorFor, kickBudgetMs: 150 });
  eq(kick.publishedPackVersionIds.length, 0, "§1 a short-budget kick cannot finish a 900ms collector");
  eq((await store.getBuildJob(job.jobId)).status, "queued", "§1 the kick released the job back to queued");
  eq((await store.getBuildJob(job.jobId)).error, null, "§1 the release recorded no failure");

  const drive = await drivePackBuild(store, dest.destinationId, { collectorFor, driveBudgetMs: 10_000 });
  eq(drive.outcome, "published", "§1 the drive completes the same build");
  eq(drive.attempts, 1, "§1 one attempt suffices when the budget is the drive's");
  eq(drive.publishedPackVersionIds.length, 1, "§1 the drive publishes exactly one version");
  eq(drive.error, null, "§1 the drive reports no error");
  eq((await store.getBuildJob(job.jobId)).status, "done", "§1 the job completed through the drive");
  const serving = await readServingPack(store, dest.destinationId);
  eq(serving.state, "ready", "§1 the pack serves after the drive");
}

/* ---------------- §2 — release inside a drive loops immediately ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const calls = { count: 0 };
  // First collector run: 1500ms (outlasts one 1200ms attempt).
  // Second run: 100ms (an upstream that warmed up). The drive
  // clock is frozen, so the drive's remaining budget never decays
  // between attempts — this isolates the LOOP, which is the unit
  // under test; real-clock deadline behaviour is §6.
  const collectorFor = scriptedCollector(calls, [1500, 100]);
  const frozenNow = () => 1_000_000;
  const drive = await drivePackBuild(store, dest.destinationId, {
    collectorFor,
    driveBudgetMs: 1200,
    now: frozenNow
  });
  eq(drive.outcome, "published", "§2 the drive completes after an in-drive release");
  eq(drive.attempts, 2, "§2 the release was re-decided and re-claimed inside the same drive (2 attempts)");
  eq(calls.count, 2, "§2 the collector ran once per attempt");
  eq(drive.publishedPackVersionIds.length, 1, "§2 exactly one version published across both attempts");
  eq((await store.getBuildJob(job.jobId)).status, "done", "§2 the job completed — no cron tick exists in this harness");
}

/* ---------------- §3 — drive stops at pack-ready ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  await store.enqueueBuild(dest.destinationId, "cold-read");
  const calls = { count: 0 };
  const collectorFor = scriptedCollector(calls, [0]);
  const first = await drivePackBuild(store, dest.destinationId, { collectorFor });
  eq(first.outcome, "published", "§3 setup: first drive builds the pack");
  const second = await drivePackBuild(store, dest.destinationId, { collectorFor });
  eq(second.outcome, "pack-ready", "§3 a drive over a serving pack stops at pack-ready");
  eq(second.publishedPackVersionIds.length, 0, "§3 nothing republishes");
  eq(calls.count, 1, "§3 the collector never runs again");
}

/* ---------------- §4 — drive stops at build-in-flight ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const lease = await store.claimBuild(job.jobId, "other-worker", 60_000);
  ok(lease, "§4 setup: another worker holds the claim");
  const calls = { count: 0 };
  const drive = await drivePackBuild(store, dest.destinationId, { collectorFor: scriptedCollector(calls, [0]) });
  eq(drive.outcome, "build-in-flight", "§4 the drive defers to the live lease holder");
  eq(calls.count, 0, "§4 the collector never runs");
  eq((await store.getBuildJob(job.jobId)).status, "building", "§4 the claimed job is untouched");
}

/* ---------------- §5 — failing collector: one attempt, honest failure ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const calls = { count: 0 };
  const drive = await drivePackBuild(store, dest.destinationId, {
    collectorFor: scriptedCollector(calls, [0], { failWith: "overpass at capacity" }),
    driveBudgetMs: 10_000
  });
  eq(drive.outcome, "build-failed", "§5 a failing collector ends the drive as build-failed");
  ok(drive.error && drive.error.includes("overpass at capacity"), "§5 the failure rides the result, never a throw");
  eq(calls.count, 1, "§5 exactly ONE attempt — the drive never spins against a broken collector");
  eq((await store.getBuildJob(job.jobId)).status, "failed", "§5 the job records the failure");
  ok(((await store.getBuildJob(job.jobId)).error || "").includes("overpass at capacity"), "§5 the job carries the collector's error");
}

/* ---------------- §6 — drive budget exhausted: honest posture ---------------- */
{
  const store = new InMemoryPackStore();
  const dest = testDestination();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "cold-read");
  const calls = { count: 0 };
  const drive = await drivePackBuild(store, dest.destinationId, {
    collectorFor: scriptedCollector(calls, [3000]),
    driveBudgetMs: 600
  });
  eq(drive.outcome, "budget-exhausted", "§6 a collector past the drive budget ends the drive as budget-exhausted");
  eq(drive.publishedPackVersionIds.length, 0, "§6 nothing publishes");
  eq(drive.error, null, "§6 exhaustion is not an error");
  const released = await store.getBuildJob(job.jobId);
  eq(released.status, "queued", "§6 the job is back at queued for the backstop / next wake");
  eq(released.error, null, "§6 NO failure is recorded on the job");
  eq(released.lease, null, "§6 the lease is cleared");
}

/* ---------------- §7 — generate integration + the named wait state ---------------- */

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
    itineraries,
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

const USER_ID = "pack-drive-harness-user";
const DRIVETON = {
  destinationId: "dst-driveton",
  displayName: "Driveton",
  country: "Testland",
  centre: { lat: 45.0, lon: -64.0 },
  bbox: null,
  timeZone: "UTC",
  geocodeProvenance: { source: "test", sourceRef: null, recordedAt: null, label: "drive checks" }
};
const drivetonPayload = {
  origin: "Saint John",
  originCity: "Saint John",
  destination: "Driveton",
  destinationCity: "Driveton",
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

{
  const packStore = new InMemoryPackStore();
  await packStore.registerDestination(DRIVETON);
  const genStore = createMemoryGenerationStore();
  const scheduled = [];
  const calls = { count: 0 };
  const deps = {
    store: genStore,
    packStore,
    packKickScheduler: (task) => scheduled.push(task),
    packCollectorFor: scriptedCollector(calls, [400])
  };
  const tripId = "trip-drive-1";
  genStore.seedTrip(tripId, USER_ID);
  await startEngineGeneration({
    store: genStore,
    tripId,
    userId: USER_ID,
    payload: drivetonPayload,
    requestId: `req-${tripId}-start`,
    unlockSource: "paid",
    context: emptyContext()
  });

  const wake1 = await advanceEngineGeneration({ deps, tripId, userId: USER_ID, requestId: "req-drive-wake-1" });
  eq(wake1.waitingForPack, true, "§7 the cold trip waits for its pack");
  eq(scheduled.length, 1, "§7 the waiting wake schedules exactly one drive task");
  eq(calls.count, 0, "§7 the build has NOT run inside the wake (post-response only)");
  // F8: the persisted waiting state is the NAMED pack-wait state.
  const waitingRow = await genStore.loadTrip(tripId, USER_ID);
  const waitingState = waitingRow.metadata.generation;
  ok(waitingState.waitingOnPack, "§7 F8: the waiting state carries waitingOnPack");
  eq(waitingState.waitingOnPack.destinationId, DRIVETON.destinationId, "§7 F8: waitingOnPack names the destination");
  ok(typeof waitingState.waitingOnPack.since === "string" && waitingState.waitingOnPack.since, "§7 F8: waitingOnPack stamps the wait's start");
  ok(waitingState.waitingOnPack.waits >= 1, "§7 F8: waitingOnPack counts the wait cycles");

  await Promise.all(scheduled.map((task) => task()));
  eq(calls.count, 1, "§7 the scheduled drive builds the pack exactly once");
  ok(await packStore.getReadyVersion(DRIVETON.destinationId), "§7 the pack is ready after the drive — no cron tick anywhere");

  const wake2 = await advanceEngineGeneration({ deps, tripId, userId: USER_ID, requestId: "req-drive-wake-2" });
  ok(wake2.waitingForPack !== true, "§7 the next wake proceeds past the outline");
  const proceededRow = await genStore.loadTrip(tripId, USER_ID);
  eq(proceededRow.metadata.generation.waitingOnPack ?? null, null, "§7 F8: outline success clears the named wait state");
}

console.log(`PACK-DRIVE CHECKS: ${count}/${count} PASS`);
