// Roamly SPEED FIX — simulated end-to-end (2026-11-07).
//
// The crawl investigation's production numbers (CRAWL-
// INVESTIGATION-REPORT, PRODUCTION-OBSERVED): a FRESH destination
// trip took 41m37s (Prayagraj) and 78m24s (Tokyo) wall-clock
// against ~5 s of stage compute; warm trips took ~20–31 s. This
// suite drives the SAME engine seams (startEngineGeneration +
// advanceEngineGeneration over in-memory stores — the wiring /
// pack-kick / KF-2 harness pattern) with the speed fix in place
// and states the resulting wall clocks plainly. Category:
// SIMULATED — store latency is in-memory, not Supabase; every
// other step (extract classification, pack drive, OSRM matrix,
// outline, per-day solves, finalize, production validation) is
// the real code path.
//
//   FRESH — Fukuoka (never warm anywhere): trip create -> the
//     outline waits -> the scheduled DRIVE builds the pack from
//     the real Overture extract (no cron tick exists in this
//     harness) -> generation runs to a locked, validated final
//     itinerary. Wall clock printed.
//   WARM — Charlottetown (recorded pack seeded, the KF-2 golden
//     shape): create -> locked with NO pack wait and NO scheduled
//     task. Wall clock printed.
//   F6 — the background chain's production worker config pins
//     maxLayersPerRun at 25 (single-invocation generation); the
//     shared worker default (the cron's 8) is untouched, and the
//     explicit-override path still clamps to the same ceiling.
//
// Run: npm run test:speed-e2e (OSRM wants NODE_USE_ENV_PROXY=1 in
// the sandbox; without it the matrix falls back honestly and the
// timings grow, but nothing else changes)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}
delete process.env.OPENAI_API_KEY;

const { advanceEngineGeneration, startEngineGeneration, ZERO_ENGINE_SOURCE } = await import(
  "@/lib/roamly/engine/generate.ts"
);
const { getStagedGenerationState, nextStagedGenerationWork } = await import("@/lib/roamly/stagedItineraryGeneration.ts");
const { validateItineraryForProduction } = await import("@/lib/itinerary.ts");
const { InMemoryPackStore } = await import("@/lib/roamly/engine/packs/store.ts");
const { primaryCollector, seedDestinationFromRecordedPack } = await import("@/lib/roamly/engine/packs/builder.ts");
const { breadthDestination } = await import("@/lib/roamly/engine/packs/destinations.ts");
const { getGenerationWorkerConfig } = await import("@/lib/roamly/generationWorker.ts");

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
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---------------- F6 config pins ---------------- */
{
  // The background module imports next/server (the after() seam)
  // and cannot be imported into a plain-node suite — the codebase
  // pins it by source text (roamly-core-checks pattern); the
  // worker half is imported and pinned by value.
  const bgSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "roamly", "stagedGenerationBackground.ts"),
    "utf8"
  );
  ok(bgSource.includes("BACKGROUND_WORKER_MAX_LAYERS_PER_RUN = 25"), "F6: the background chain's layers-per-run is 25 (was 1)");
  ok(bgSource.includes("maxLayersPerRun: BACKGROUND_WORKER_MAX_LAYERS_PER_RUN"), "F6: the chain's worker config actually uses the 25");
  ok(bgSource.includes("BACKGROUND_WORKER_SLICE_BUDGET_MS = 90_000"), "F6: the slice budget stays 90 s (the worker yields cleanly inside it)");
  ok(!bgSource.includes("maxLayersPerRun: 1"), "F6: the one-layer-per-slice chain is gone");
  eq(getGenerationWorkerConfig({}).maxLayersPerRun, 8, "F6: the shared worker default (the cron's) is untouched at 8");
  eq(getGenerationWorkerConfig({ maxLayersPerRun: 25 }).maxLayersPerRun, 25, "F6: the background's explicit override passes through the worker config");
}

/* ---------------- harness (pack-kick / KF-2 pattern) ---------------- */

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

const USER_ID = "speed-e2e-harness-user";
const emptyContext = () => ({
  personalization: { enabled: false, accepted: {}, inferred: {}, aggregateGuidance: [] },
  confirmedBookings: []
});

async function driveTripToTerminal({ genStore, deps, tripId, tag, scheduled = null, maxWakes = 80 }) {
  let wakes = 0;
  for (let i = 0; i < maxWakes; i++) {
    // Post-response work (the pack drive) runs between wakes —
    // the production shape: after() tasks complete before the
    // traveller's next poll / the worker's next slice.
    if (scheduled) {
      while (scheduled.length > 0) {
        const tasks = scheduled.splice(0, scheduled.length);
        await Promise.all(tasks.map((task) => task()));
      }
    }
    const row = await genStore.loadTrip(tripId, USER_ID);
    const st = getStagedGenerationState(row.metadata, tripId);
    if (st.status === "complete" || st.status === "failed" || st.status === "partially_failed") {
      return { state: st, wakes };
    }
    if (!nextStagedGenerationWork(st)) return { state: st, wakes };
    wakes += 1;
    await advanceEngineGeneration({ deps, tripId, userId: USER_ID, requestId: `req-${tag}-wake-${i}` });
  }
  const row = await genStore.loadTrip(tripId, USER_ID);
  return { state: getStagedGenerationState(row.metadata, tripId), wakes };
}

/* ---------------- FRESH — Fukuoka, extract-driven ---------------- */
const proofDir =
  process.env.ROAMLY_EXTRACT_PROOF_DIR ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "goals", "roamly-october-4-repair", "hidden_files", "ship-2026-11-07", "extracts");
const fukuokaFile = join(proofDir, "fukuoka-overture-2026-10-21.0.json");
if (!existsSync(fukuokaFile)) {
  console.log(`  SKIP FRESH — real extract not found at ${fukuokaFile}`);
} else {
  const fileDoc = JSON.parse(readFileSync(fukuokaFile, "utf8"));
  const { mkdtemp, symlink, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const stageDir = await mkdtemp(join(tmpdir(), "roamly-speed-e2e-"));
  await symlink(fukuokaFile, join(stageDir, `${fileDoc.destination.destinationId}.json`));

  const packStore = new InMemoryPackStore();
  await packStore.registerDestination({
    destinationId: fileDoc.destination.destinationId,
    displayName: "Fukuoka",
    country: "Japan",
    centre: { lat: 33.5904, lon: 130.4017 },
    bbox: { minLat: 33.5354, maxLat: 33.6454, minLon: 130.3267, maxLon: 130.4767 },
    timeZone: "Asia/Tokyo",
    geocodeProvenance: { source: "test", sourceRef: null, recordedAt: null, label: "speed e2e (real slice)" }
  });
  const genStore = createMemoryGenerationStore();
  const scheduled = [];
  const deps = {
    store: genStore,
    packStore,
    packKickScheduler: (task) => scheduled.push(task),
    packCollectorFor: () =>
      primaryCollector(undefined, undefined, { extract: { dir: stageDir }, openPlacesApiKey: null })
  };
  const payload = {
    origin: "Saint John",
    originCity: "Saint John",
    destination: "Fukuoka",
    destinationCity: "Fukuoka",
    destinationCountry: "Japan",
    tripType: "single_destination",
    startDate: "2026-12-10",
    endDate: "2026-12-12",
    daysCount: 3,
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
  const tripId = "trip-speed-fresh-fukuoka";
  genStore.seedTrip(tripId, USER_ID);
  const t0 = Date.now();
  await startEngineGeneration({
    store: genStore,
    tripId,
    userId: USER_ID,
    payload,
    requestId: `req-${tripId}-start`,
    unlockSource: "paid",
    context: emptyContext()
  });
  // The traveller's request has returned; between wakes the
  // post-response tasks (the pack drive) run — the production
  // shape, minus any cron.
  const { state, wakes } = await driveTripToTerminal({ genStore, deps, tripId, tag: "fresh", scheduled });
  const freshMs = Date.now() - t0;
  eq(state.status, "complete", `FRESH: the Fukuoka trip completes (status=${state.status}, error=${state.lastErrorCode || "none"})`);
  const itin = genStore.itineraries.get(tripId);
  ok(itin && itin.final === true, "FRESH: a final itinerary persisted (the lock seam)");
  eq(itin.source, ZERO_ENGINE_SOURCE, "FRESH: the final itinerary carries the zero-engine source");
  eq(validateItineraryForProduction(itin.full_json, payload).ok, true, "FRESH: the locked itinerary passes production validation");
  console.log(`  INFO FRESH Fukuoka create->locked: ${freshMs}ms wall (${wakes} engine wakes, pack built by the drive from the extract, no cron)`);
  ok(freshMs < 120_000, `FRESH: ${freshMs}ms is not the crawl's 41–78 minutes`);
  await rm(stageDir, { recursive: true, force: true });
}

/* ---------------- WARM — Charlottetown, recorded pack ---------------- */
{
  const FIX2 = new URL("./fixtures/wiring-phase2/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, FIX2), "utf8"));
  const scenarios = load("scenarios.json").data;
  const scn = scenarios.find((s) => s.entry.id === "charlottetown-smalltown");
  const { entry, requestText, startDate, endDate } = scn;
  const payload = {
    origin: "Saint John",
    originCity: "Saint John",
    destination: entry.destination,
    destinationCity: entry.destination,
    destinationCountry: entry.destinationCountry,
    tripType: "single_destination",
    startDate,
    endDate,
    daysCount: entry.days,
    travelers: entry.travelers,
    travelersCount: (entry.travelers.adults || 0) + (entry.travelers.children || 0),
    budgetAmount: entry.budgetAmount,
    budgetCurrency: entry.budgetCurrency,
    interests: entry.interests,
    pace: entry.pace,
    travelStyle: entry.travelStyle,
    specialNotes: requestText,
    language: "en",
    explicitRequirements: entry.checks
      .filter((c) => c.kind === "keyword")
      .map((c) => ({ type: "activity", request: c.label, priority: "hard" }))
  };
  const packStore = new InMemoryPackStore();
  await seedDestinationFromRecordedPack(packStore, breadthDestination("Charlottetown"), load("packs/pack-charlottetown.json").data, {
    workerId: "speed-e2e"
  });
  const genStore = createMemoryGenerationStore();
  const scheduled = [];
  const deps = { store: genStore, packStore, packKickScheduler: (task) => scheduled.push(task) };
  const tripId = "trip-speed-warm-charlottetown";
  genStore.seedTrip(tripId, USER_ID);
  const t0 = Date.now();
  await startEngineGeneration({
    store: genStore,
    tripId,
    userId: USER_ID,
    payload,
    requestId: `req-${tripId}-start`,
    unlockSource: "paid",
    context: emptyContext()
  });
  const { state, wakes } = await driveTripToTerminal({ genStore, deps, tripId, tag: "warm" });
  const warmMs = Date.now() - t0;
  eq(state.status, "complete", `WARM: the Charlottetown trip completes (status=${state.status})`);
  eq(scheduled.length, 0, "WARM: no pack task was ever scheduled (the pack already served)");
  const itin = genStore.itineraries.get(tripId);
  ok(itin && itin.final === true, "WARM: a final itinerary persisted");
  eq(validateItineraryForProduction(itin.full_json, payload).ok, true, "WARM: the locked itinerary passes production validation");
  console.log(`  INFO WARM Charlottetown create->locked: ${warmMs}ms wall (${wakes} engine wakes, driven back-to-back by one worker run in production under the F6 config)`);
}

console.log(`SPEED-E2E CHECKS: ${count}/${count} PASS`);
