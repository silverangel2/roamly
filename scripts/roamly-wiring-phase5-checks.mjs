import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  advanceEngineGeneration,
  startEngineGeneration,
  runEnginePlan,
  zeroEngineEnabledForJob,
  zeroEngineFlagEnabled,
  ZERO_ENGINE_GENERATION_NOTE,
  ZERO_ENGINE_GENERATION_VERSION,
  ZERO_ENGINE_PROVIDER,
  ZERO_ENGINE_SOURCE
} from "@/lib/roamly/engine/generate.ts";
import {
  canResumeStagedGeneration,
  getStagedGenerationState,
  nextStagedGenerationWork,
  publicStagedGenerationProgress,
  resetStrandedGeneratingBatches,
  STAGED_GENERATION_STRANDED_ERROR_CODE
} from "@/lib/roamly/stagedItineraryGeneration.ts";
import { isFinalStoredItinerary } from "@/lib/roamly/generationFinalization.ts";
import { validateItineraryForProduction } from "@/lib/itinerary.ts";
import { InMemoryPackStore } from "@/lib/roamly/engine/packs/store.ts";
import { assemblePinnedEnginePack, seedDestinationFromRecordedPack } from "@/lib/roamly/engine/packs/builder.ts";
import { breadthDestination } from "@/lib/roamly/engine/packs/destinations.ts";
import { judgeTrip } from "@/lib/roamly/engine/judges.ts";
import { gradeRequirements, specConstraints } from "@/lib/roamly/engine/understand.ts";

// Phase 5 checks (DESIGN-PRODUCTION.md Phase 5 proof):
//   A — flag law: default OFF everywhere; a job is engine-driven only
//       when flag AND job version agree.
//   B — state-machine conformance: the adapter's state document is
//       read back by the INCUMBENT's own getStagedGenerationState /
//       publicStagedGenerationProgress / nextStagedGenerationWork
//       untouched, and the work sequence is outline -> day_batch xN ->
//       finalization -> null.
//   C — lease discipline: a live lease held by another request makes
//       advance return busy without touching the state; an expired
//       lease lets the next wake in.
//   D — watchdog compatibility: the SHIPPED resetStrandedGenerating-
//       Batches, unmodified, resets an engine job's stranded batch
//       identically (queued / exhausted-failed / STAGE_DRIVER_LOST),
//       both called directly and inside a real advance wake.
//   E — finalization acceptance (M10): legacy staged-AI acceptance is
//       unchanged; an engine final is accepted only with BOTH the
//       stamped source and the honest note; content validation is
//       untouched and still gates engine output.
//   F — A/B harness: the 3 pool destinations with full golden coverage
//       (Quebec City 5d, Charlottetown 3d, Halifax 4d) driven through
//       the adapter end-to-end over recorded packs, graded against the
//       frozen Phase 2/3 goldens (judge, requirement verdicts, budget
//       posture), with predictions written per trip and zero model
//       calls. The incumbent leg is graded from RECORDED production
//       behavior (KF-1/KF-2) and is never executed here.
//   G — two-pass Places enrichment: fires once, inside the first
//       day-batch step, only when a service is injected.
//   H — no model call exists in the engine path (static source proof
//       over the adapter module).
// Run a single section with: --only=<A|B|C|D|E|F|G|H>

const ONLY = new Set(((process.argv.find((a) => a.startsWith("--only=")) || "").slice(7)).split(",").filter(Boolean));
const section = (name) => ONLY.size === 0 || ONLY.has(name);

const FIX2 = new URL("./fixtures/wiring-phase2/", import.meta.url);
const load = (name, base = FIX2) => JSON.parse(readFileSync(new URL(name, base), "utf8"));
const scenarios = load("scenarios.json").data;
const scenarioById = (id) => scenarios.find((s) => s.entry.id === id);

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
}
const canon = (x) =>
  JSON.stringify(x, (k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter(([, val]) => val !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v
  );
function eqC(actual, expected, label) {
  count += 1;
  const a = canon(actual), b = canon(expected);
  assert.equal(a, b, `${label}\n  GOT:    ${String(a).slice(0, 300)}\n  WANT:   ${String(b).slice(0, 300)}`);
}

/* ------------------------------------------------------------------ */
/* In-memory EngineGenerationStore — the same CAS/lease semantics as  */
/* the Supabase implementation in generate.ts: writes are compare-    */
/* and-swap on the trip row revision; claim refuses (null) on a lost  */
/* race; finalization is the only write that stamps the honest        */
/* source; prediction inserts are first-write-wins.                   */
/* ------------------------------------------------------------------ */

const clone = (v) => JSON.parse(JSON.stringify(v));

function createMemoryStore() {
  const trips = new Map();
  const itineraries = new Map();
  const predictions = new Map();
  let rev = 0;
  const statusFor = (state) =>
    state.status === "complete" ? "generated" : state.status === "failed" || state.status === "partially_failed" ? "draft" : "generating";
  function writeRow(trip, state, run) {
    rev += 1;
    const row = trips.get(trip.id);
    const metadata = {
      ...(row ? row.metadata : {}),
      generation: clone(state),
      zeroEngine: clone(run)
    };
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
    predictions,
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
    tamper(tripId, fn) {
      const row = trips.get(tripId);
      fn(row);
      rev += 1;
      row.updated_at = `rev-${rev}`;
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
      itineraries.set(trip.id, {
        trip_id: trip.id,
        user_id: trip.user_id,
        full_json: clone(itinerary),
        source: final ? ZERO_ENGINE_SOURCE : null,
        final
      });
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

/* ------------------------------------------------------------------ */
/* Harness plumbing                                                    */
/* ------------------------------------------------------------------ */

const USER_ID = "phase5-harness-user";

function payloadForScenario(scn) {
  const { entry, requestText, startDate, endDate } = scn;
  return {
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
}

const emptyContext = () => ({
  personalization: { enabled: false, accepted: {}, inferred: {}, aggregateGuidance: [] },
  confirmedBookings: []
});

async function seedPackStore() {
  const store = new InMemoryPackStore();
  const packs = {
    "Quebec City": load("packs/pack-quebec-city-enriched.json").data,
    Charlottetown: load("packs/pack-charlottetown.json").data,
    Halifax: load("packs/pack-halifax.json").data
  };
  for (const [name, recorded] of Object.entries(packs)) {
    await seedDestinationFromRecordedPack(store, breadthDestination(name), recorded, { workerId: "phase5-harness" });
  }
  return store;
}

async function driveToTerminal({ store, packStore, tripId, payload, placesService = null, maxWakes = 40 }) {
  store.seedTrip(tripId, USER_ID);
  const startedAt = Date.now();
  const state0 = await startEngineGeneration({
    store,
    tripId,
    userId: USER_ID,
    payload,
    requestId: `req-${tripId}-start`,
    unlockSource: "paid",
    context: emptyContext()
  });
  const workSequence = [];
  let wakes = 0;
  let last = null;
  for (let i = 0; i < maxWakes; i++) {
    const row = await store.loadTrip(tripId, USER_ID);
    const st = getStagedGenerationState(row.metadata, tripId);
    const work = nextStagedGenerationWork(st);
    workSequence.push(work ? work.stage : "none");
    if (!work) break;
    wakes += 1;
    last = await advanceEngineGeneration({
      deps: { store, packStore, placesService },
      tripId,
      userId: USER_ID,
      requestId: `req-${tripId}-wake-${i}`
    });
    if (last.state.status === "complete" || last.state.status === "failed" || last.state.status === "partially_failed") break;
  }
  const row = await store.loadTrip(tripId, USER_ID);
  const finalState = getStagedGenerationState(row.metadata, tripId);
  return { state0, finalState, row, workSequence, wakes, elapsedMs: Date.now() - startedAt, last };
}

/* ------------------------------------------------------------------ */
/* A — flag law                                                        */
/* ------------------------------------------------------------------ */

if (section("A")) {
  eq(zeroEngineFlagEnabled({}), false, "A: flag defaults OFF with no env value");
  eq(zeroEngineFlagEnabled({ ROAMLY_ZERO_ENGINE_ENABLED: "" }), false, "A: empty value is OFF");
  eq(zeroEngineFlagEnabled({ ROAMLY_ZERO_ENGINE_ENABLED: "0" }), false, "A: '0' is OFF");
  eq(zeroEngineFlagEnabled({ ROAMLY_ZERO_ENGINE_ENABLED: "false" }), false, "A: 'false' is OFF");
  eq(zeroEngineFlagEnabled({ ROAMLY_ZERO_ENGINE_ENABLED: "1" }), true, "A: '1' is ON");
  eq(zeroEngineFlagEnabled({ ROAMLY_ZERO_ENGINE_ENABLED: "true" }), true, "A: 'true' is ON");
  eq(zeroEngineFlagEnabled({ ROAMLY_ZERO_ENGINE_ENABLED: "ON" }), true, "A: 'ON' is ON (case-insensitive)");
  eq(zeroEngineFlagEnabled({ ROAMLY_ZERO_ENGINE_ENABLED: " yes " }), true, "A: ' yes ' is ON (trimmed)");
  eq(
    zeroEngineEnabledForJob({ env: { ROAMLY_ZERO_ENGINE_ENABLED: "1" }, generationVersion: ZERO_ENGINE_GENERATION_VERSION }),
    true,
    "A: flag ON + engine job version => engine drives the job"
  );
  eq(
    zeroEngineEnabledForJob({ env: { ROAMLY_ZERO_ENGINE_ENABLED: "1" }, generationVersion: "roamly-brain" }),
    false,
    "A: flag ON alone never captures an incumbent job"
  );
  eq(
    zeroEngineEnabledForJob({ env: {}, generationVersion: ZERO_ENGINE_GENERATION_VERSION }),
    false,
    "A: an engine-versioned job with the flag OFF is not engine-driven (incumbent takeover posture)"
  );
  eq(zeroEngineEnabledForJob({ env: { ROAMLY_ZERO_ENGINE_ENABLED: "1" }, generationVersion: null }), false, "A: null version is never an engine job");
  eq(ZERO_ENGINE_SOURCE, "zero-engine", "A: the honest source value is 'zero-engine'");
  ok(!/staged ai generation/i.test(ZERO_ENGINE_GENERATION_NOTE), "A: the engine note never carries the staged-AI literal");
  ok(/zero-engine/i.test(ZERO_ENGINE_GENERATION_NOTE), "A: the engine note names the zero-engine");
  console.log("A ok — flag law");
}

/* ------------------------------------------------------------------ */
/* B/C/D share one seeded world                                        */
/* ------------------------------------------------------------------ */

const packStore = await seedPackStore();

if (section("B")) {
  const scn = scenarioById("charlottetown-smalltown");
  const payload = payloadForScenario(scn);
  const store = createMemoryStore();
  const drive = await driveToTerminal({ store, packStore, tripId: "trip-b-charlottetown", payload });

  eq(drive.state0.version, 2, "B: initial state document is version 2 (the shipped contract)");
  eq(drive.state0.status, "queued", "B: initial status is queued");
  eq(drive.state0.provider, ZERO_ENGINE_PROVIDER, "B: provider is the honest engine provider from the first write");
  eq(drive.state0.aiCallCount, 0, "B: aiCallCount starts at 0");
  eq(drive.workSequence[0], "outline", "B: first work item is the outline stage");
  eq(
    drive.workSequence.filter((s) => s === "day_batch").length,
    3,
    "B: one day_batch work item per day (3-day trip)"
  );
  eq(drive.workSequence[drive.workSequence.length - 1], "finalization", "B: last work item is finalization");
  eq(drive.finalState.status, "complete", "B: the drive reaches complete");
  eq(nextStagedGenerationWork(drive.finalState), null, "B: no work remains after completion (incumbent selector agrees)");

  // The incumbent's own reader reconstructs the engine document.
  const reread = getStagedGenerationState(drive.row.metadata, "trip-b-charlottetown");
  eqC(reread, drive.finalState, "B: getStagedGenerationState round-trips the engine state document losslessly");
  const progress = publicStagedGenerationProgress(drive.row.metadata, "trip-b-charlottetown");
  eq(progress.status, "complete", "B: the shipped progress shape reports the engine job complete");
  eq(progress.completedDayCount, 3, "B: progress completedDayCount is the full trip");
  eq(progress.totalDayCount, 3, "B: progress totalDayCount matches");

  for (const run of drive.finalState.stageRuns) {
    eq(run.provider, ZERO_ENGINE_PROVIDER, "B: every stage run is stamped with the engine provider");
    eq(run.inputTokens, 0, "B: every stage run records zero input tokens");
    eq(run.outputTokens, 0, "B: every stage run records zero output tokens");
    eq(run.estimatedCostUsd, 0, "B: every stage run records zero cost");
  }
  eq(drive.finalState.aiCallCount, 0, "B: aiCallCount is still 0 at completion");
  eq(drive.finalState.estimatedAiCostUsd, 0, "B: estimatedAiCostUsd is 0 at completion");
  eq(drive.finalState.model, null, "B: model is null — no model was ever named");
  eq(canResumeStagedGeneration(drive.finalState), false, "B: a completed engine job is not resumable (incumbent predicate agrees)");
  console.log("B ok — state-machine conformance");
}

if (section("C")) {
  const scn = scenarioById("charlottetown-smalltown");
  const payload = payloadForScenario(scn);
  const store = createMemoryStore();
  const tripId = "trip-c-lease";
  store.seedTrip(tripId, USER_ID);
  await startEngineGeneration({ store, tripId, userId: USER_ID, payload, requestId: "req-c-start", unlockSource: "paid", context: emptyContext() });

  store.tamper(tripId, (row) => {
    row.metadata.generation.worker = { leaseId: "req-other-worker", leaseExpiresAt: new Date(Date.now() + 120_000).toISOString() };
  });
  const before = await store.loadTrip(tripId, USER_ID);
  const busy = await advanceEngineGeneration({
    deps: { store, packStore },
    tripId,
    userId: USER_ID,
    requestId: "req-c-mine"
  });
  eq(busy.busy, true, "C: a live lease held by another request makes advance return busy");
  eq(busy.advanced, false, "C: a busy wake advances nothing");
  const after = await store.loadTrip(tripId, USER_ID);
  eqC(after.metadata.generation, before.metadata.generation, "C: a busy wake leaves the state document untouched");

  store.tamper(tripId, (row) => {
    row.metadata.generation.worker = { leaseId: "req-other-worker", leaseExpiresAt: new Date(Date.now() - 1_000).toISOString() };
  });
  const through = await advanceEngineGeneration({
    deps: { store, packStore },
    tripId,
    userId: USER_ID,
    requestId: "req-c-mine"
  });
  eq(through.advanced, true, "C: once the lease expires the next wake drives the job");
  eq(through.stage, "outline", "C: the wake after lease expiry runs the outline stage");
  eq(through.state.worker, null, "C: the lease is released when the stage's work is persisted");
  console.log("C ok — lease discipline");
}

if (section("D")) {
  const scn = scenarioById("charlottetown-smalltown");
  const payload = payloadForScenario(scn);
  const store = createMemoryStore();
  const tripId = "trip-d-watchdog";
  store.seedTrip(tripId, USER_ID);
  const started = await startEngineGeneration({
    store,
    tripId,
    userId: USER_ID,
    payload,
    requestId: "req-d-start",
    unlockSource: "paid",
    context: emptyContext()
  });

  // Direct call: the shipped watchdog over an engine state document
  // whose batch-2 flipped to "generating" ten minutes ago and whose
  // driver then died (the KF-2 shape).
  const strandedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  const stranded = clone(started);
  stranded.batches["batch-2"] = { ...stranded.batches["batch-2"], status: "generating", attemptCount: 1, startedAt: strandedAt, updatedAt: strandedAt };
  stranded.days["2"] = { ...stranded.days["2"], status: "generating", attemptCount: 1, startedAt: strandedAt, updatedAt: strandedAt };
  const reset = resetStrandedGeneratingBatches(stranded, Date.now());
  eq(reset.changed, true, "D: the shipped watchdog sees the engine job's stranded batch");
  eqC(reset.resetBatchIds, ["batch-2"], "D: batch-2 is reset");
  eq(reset.state.batches["batch-2"].status, "queued", "D: the stranded batch returns to queued");
  eq(reset.state.days["2"].status, "queued", "D: the stranded day returns to queued");
  eq(reset.state.batches["batch-2"].lastError, STAGED_GENERATION_STRANDED_ERROR_CODE, "D: the reset carries STAGE_DRIVER_LOST");
  const watchdogRun = reset.state.stageRuns[reset.state.stageRuns.length - 1];
  eq(watchdogRun.errorCode, STAGED_GENERATION_STRANDED_ERROR_CODE, "D: the watchdog's failed stage run is appended to the engine document");
  eq(watchdogRun.failureCategory, "worker_interrupted", "D: the watchdog stage run category is worker_interrupted");

  const exhaustedState = clone(stranded);
  exhaustedState.batches["batch-2"] = { ...exhaustedState.batches["batch-2"], attemptCount: 99 };
  const exhausted = resetStrandedGeneratingBatches(exhaustedState, Date.now());
  eqC(exhausted.exhaustedBatchIds, ["batch-2"], "D: a stranded batch past the attempt limit is exhausted, not reset");
  eq(exhausted.state.batches["batch-2"].status, "failed", "D: the exhausted batch lands failed");

  const fresh = resetStrandedGeneratingBatches(clone(started), Date.now());
  eq(fresh.changed, false, "D: a healthy engine state is untouched by the watchdog");

  // End-to-end: the same stranding inside a real advance wake — the
  // driver claims, the watchdog resets, and the batch is regenerated
  // in the same wake, with the STAGE_DRIVER_LOST run preserved.
  await advanceEngineGeneration({ deps: { store, packStore }, tripId, userId: USER_ID, requestId: "req-d-outline" });
  store.tamper(tripId, (row) => {
    const g = row.metadata.generation;
    g.batches["batch-1"] = { ...g.batches["batch-1"], status: "generating", attemptCount: 1, startedAt: strandedAt, updatedAt: strandedAt };
    g.days["1"] = { ...g.days["1"], status: "generating", attemptCount: 1, startedAt: strandedAt, updatedAt: strandedAt };
    g.worker = null;
  });
  const wake = await advanceEngineGeneration({ deps: { store, packStore }, tripId, userId: USER_ID, requestId: "req-d-recover" });
  eq(wake.advanced, true, "D: the recovery wake advances the job");
  ok(
    wake.state.stageRuns.some((r) => r.errorCode === STAGED_GENERATION_STRANDED_ERROR_CODE),
    "D: the recovery wake's state preserves the watchdog's STAGE_DRIVER_LOST stage run"
  );
  eq(wake.state.batches["batch-1"].status, "complete", "D: the reset batch is regenerated to complete in the recovery wake");
  console.log("D ok — watchdog compatibility");
}

/* ------------------------------------------------------------------ */
/* E — finalization acceptance matrix (M10)                            */
/* ------------------------------------------------------------------ */

if (section("E")) {
  const aiDoc = { daily_itinerary: [{ day_number: 1 }], generation_note: "Generated through Roamly staged AI generation." };
  eq(isFinalStoredItinerary(aiDoc), true, "E: legacy staged-AI document accepted with no source (unchanged)");
  eq(isFinalStoredItinerary(aiDoc, "staged-ai"), true, "E: legacy document accepted with source staged-ai");
  eq(isFinalStoredItinerary(aiDoc, "zero-engine"), true, "E: the AI literal still accepts on its own branch");

  const engineDoc = { daily_itinerary: [{ day_number: 1 }], generation_note: ZERO_ENGINE_GENERATION_NOTE };
  eq(isFinalStoredItinerary(engineDoc, "zero-engine"), true, "E: engine final accepted with stamped source + honest note");
  eq(isFinalStoredItinerary(engineDoc), false, "E: engine note WITHOUT the stamped source is not accepted (metadata-copy posture)");
  eq(isFinalStoredItinerary(engineDoc, "staged-ai"), false, "E: engine note under a staged-ai stamp is not accepted");
  eq(isFinalStoredItinerary(engineDoc, null), false, "E: engine note with null source is not accepted");
  eq(
    isFinalStoredItinerary({ daily_itinerary: [{ day_number: 1 }], generation_note: "Generated by the engine." }, "zero-engine"),
    false,
    "E: a zero-engine stamp with a note that does not name the engine is not accepted"
  );
  eq(
    isFinalStoredItinerary({ daily_itinerary: [], generation_note: ZERO_ENGINE_GENERATION_NOTE }, "zero-engine"),
    false,
    "E: an empty itinerary is never final, whatever the provenance"
  );
  eq(
    isFinalStoredItinerary({ daily_itinerary: [{ day_number: 1 }], generation_note: "Some other note." }, "zero-engine"),
    false,
    "E: an unrelated note under a zero-engine stamp is not accepted"
  );
  console.log("E ok — finalization acceptance (M10)");
}

/* ------------------------------------------------------------------ */
/* F — A/B harness: engine leg end-to-end vs the frozen goldens; the   */
/* incumbent leg is graded from recorded production behavior only.    */
/* ------------------------------------------------------------------ */

const AB = [
  { id: "quebec-city-family", packFile: "packs/pack-quebec-city-enriched.json" },
  { id: "charlottetown-smalltown", packFile: "packs/pack-charlottetown.json" },
  { id: "halifax-coastal", packFile: "packs/pack-halifax.json" }
];

const abResults = [];

if (section("F")) {
  for (const leg of AB) {
    const scn = scenarioById(leg.id);
    const { entry } = scn;
    const payload = payloadForScenario(scn);
    const frozenGrades = load(`frozen/${leg.id}/grades.json`);
    const frozenPred = load(`frozen/${leg.id}/predictions.json`);
    const store = createMemoryStore();
    const tripId = `trip-ab-${leg.id}`;
    const drive = await driveToTerminal({ store, packStore, tripId, payload });
    const finalState = drive.finalState;

    eq(finalState.status, "complete", `F/${leg.id}: engine drive reaches complete`);
    eq(finalState.completedDayCount, entry.days, `F/${leg.id}: all ${entry.days} days complete`);

    // Finalization acceptance of the real stored document.
    const stored = store.itineraries.get(tripId);
    ok(stored, `F/${leg.id}: a final itinerary row was persisted`);
    eq(stored.source, "zero-engine", `F/${leg.id}: the final row carries the honest source stamp`);
    eq(stored.full_json.generation_note, ZERO_ENGINE_GENERATION_NOTE, `F/${leg.id}: the document's note is the honest engine note`);
    ok(!/staged ai generation/i.test(stored.full_json.generation_note), `F/${leg.id}: the AI literal appears nowhere in the engine document`);
    eq(isFinalStoredItinerary(stored.full_json, stored.source), true, `F/${leg.id}: isFinalStoredItinerary accepts the engine final (M10)`);
    eq(isFinalStoredItinerary(stored.full_json), false, `F/${leg.id}: the same document is NOT acceptable without its source stamp`);

    // Content validation — the production gate, unweakened.
    const validation = validateItineraryForProduction(stored.full_json, payload);
    ok(validation.ok, `F/${leg.id}: production content validation passes (errors: ${validation.ok ? "none" : validation.errors.join(" | ")})`);
    eq(stored.full_json.daily_itinerary.length, entry.days, `F/${leg.id}: the document carries ${entry.days} days`);

    // Zero model calls, structurally.
    eq(finalState.aiCallCount, 0, `F/${leg.id}: zero AI calls recorded`);
    eq(finalState.estimatedAiCostUsd, 0, `F/${leg.id}: zero AI cost recorded`);
    ok(
      finalState.stageRuns.every((r) => r.provider === ZERO_ENGINE_PROVIDER && (r.inputTokens || 0) === 0 && (r.outputTokens || 0) === 0),
      `F/${leg.id}: every stage run is engine-stamped with zero tokens`
    );

    // Predictions (PREDICT leg, M8): exactly one immutable record.
    const tripPredictions = [...store.predictions.values()].filter((p) => p.tripId === tripId);
    eq(tripPredictions.length, 1, `F/${leg.id}: exactly one prediction record written for the trip`);
    const pred = tripPredictions[0];
    eq(pred.record.budgetPosture.verdict, frozenPred.budgetPosture.verdict, `F/${leg.id}: budget verdict matches the golden (${frozenPred.budgetPosture.verdict})`);
    eq(pred.record.budgetPosture.estimatedTotals.low, frozenPred.budgetPosture.estimatedTotals.low, `F/${leg.id}: budget total low matches the golden`);
    eq(pred.record.budgetPosture.estimatedTotals.high, frozenPred.budgetPosture.estimatedTotals.high, `F/${leg.id}: budget total high matches the golden`);
    eq(pred.record.budgetPosture.coverage, frozenPred.budgetPosture.coverage, `F/${leg.id}: budget coverage matches the golden`);
    eq(pred.generationVersion, ZERO_ENGINE_GENERATION_VERSION, `F/${leg.id}: the prediction carries the engine generation version`);
    const again = await store.writePrediction(pred);
    eq(again.written, false, `F/${leg.id}: a second prediction write for the same trip+pack is refused (first record stands)`);
    eq([...store.predictions.values()].filter((p) => p.tripId === tripId).length, 1, `F/${leg.id}: still exactly one prediction after the duplicate attempt`);

    // Judge + requirement verdicts, replayed over the pinned pack with
    // the adapter's own plan runner (deterministic: the replay IS the
    // plan the adapter converted — the anchor is asserted identical).
    const runRecord = drive.row.metadata.zeroEngine;
    const assembled = await assemblePinnedEnginePack(packStore, tripId, null);
    ok(assembled, `F/${leg.id}: the pinned pack still assembles after the drive`);
    const replay = runEnginePlan({ pack: assembled.pack, payload, totalDayCount: entry.days });
    eq(replay.ctx.anchorName, runRecord.anchor.name, `F/${leg.id}: replay anchor is the anchor the adapter pinned (${runRecord.anchor.name})`);
    const judge = judgeTrip(replay.daysOut, { earliestMin: replay.ctx.earliestMin });
    eq(judge.pass, frozenGrades.judge.pass, `F/${leg.id}: make-sense judge verdict matches the golden (pass=${frozenGrades.judge.pass})`);
    eqC(judge.hardViolations, frozenGrades.judge.hardViolations, `F/${leg.id}: judge hard violations match the golden`);
    const truth = specConstraints(entry);
    const verdicts = gradeRequirements(
      { days: replay.daysOut.map((d) => ({ ...d, narrative: d.narrative.join("\n") })) },
      truth,
      entry.checks
    );
    const verdictMap = Object.fromEntries(verdicts.map((v) => [v.id, v.verdict]));
    for (const frozen of frozenGrades.verdicts) {
      eq(verdictMap[frozen.id], frozen.verdict, `F/${leg.id}: requirement '${frozen.id}' verdict matches the golden (${frozen.verdict})`);
    }

    abResults.push({
      destination: entry.destination,
      days: entry.days,
      elapsedMs: drive.elapsedMs,
      wakes: drive.wakes,
      judge: judge.pass ? "PASS" : "FAIL",
      budget: `${pred.record.budgetPosture.verdict} (CAD ${pred.record.budgetPosture.estimatedTotals.low}–${pred.record.budgetPosture.estimatedTotals.high}, coverage ${pred.record.budgetPosture.coverage})`,
      finalization: "ACCEPTED (source=zero-engine)",
      contentValidation: validation.ok ? "PASS" : "FAIL",
      aiCalls: finalState.aiCallCount,
      predictions: tripPredictions.length
    });
    console.log(
      `F/${leg.id} ok — ${entry.destination} ${entry.days}d in ${drive.elapsedMs} ms / ${drive.wakes} wakes; judge ${judge.pass ? "PASS" : "FAIL"}; budget ${pred.record.budgetPosture.verdict} CAD ${pred.record.budgetPosture.estimatedTotals.low}–${pred.record.budgetPosture.estimatedTotals.high}`
    );
  }

  // The incumbent leg — RECORDED production behavior, never executed
  // in this harness (task law). Sources:
  //   Charlottetown 2026-10-20: hidden_files/daily-test-runs/2026-10-20/
  //     FIX-AND-RERUN.md — FINAL_VALIDATION_FAILED (KF-1).
  //   Quebec City 2026-10-21: ship proof run — 6 model stages OK
  //     (~$0.033), then FINAL_VALIDATION_FAILED (KF-1, 2nd occurrence);
  //     KF-2: a day-5 stage driver hard-killed mid-call, stranding a
  //     "generating" batch with no failure record.
  console.log("F incumbent leg (recorded production behavior — NOT executed):");
  console.log("  Charlottetown 3d (2026-10-20): FAILED — FINAL_VALIDATION_FAILED at finalization (KF-1); no itinerary locked.");
  console.log("  Quebec City 5d (2026-10-21): FAILED — FINAL_VALIDATION_FAILED after 6 successful model stages (~$0.033) (KF-1, 2nd occurrence).");
  console.log("  Quebec City 5d (2026-10-21): KF-2 — stage driver hard-killed mid-call; stranded 'generating' batch, no failure record (the class the shipped watchdog + section D address).");
  console.log("  Halifax 4d: no recorded production generation in the daily-test archive (pool began 2026-10-20; Charlottetown and Quebec City are the recorded legs).");
}

/* ------------------------------------------------------------------ */
/* G — two-pass Places enrichment                                      */
/* ------------------------------------------------------------------ */

if (section("G")) {
  const scn = scenarioById("charlottetown-smalltown");
  const payload = payloadForScenario(scn);
  const calls = [];
  const fakeService = {
    async enrichPackFinalists(packVersionId, finalistKeys) {
      calls.push({ packVersionId, keys: finalistKeys });
      return {
        mode: "live",
        enriched: finalistKeys.length,
        fromCache: 0,
        callsThisRun: { textSearch: 1, placeDetails: finalistKeys.length },
        cost: { grossUsd: 0, netUsd: 0 }
      };
    }
  };
  const store = createMemoryStore();
  const drive = await driveToTerminal({
    store,
    packStore,
    tripId: "trip-g-enrichment",
    payload,
    placesService: fakeService
  });
  eq(drive.finalState.status, "complete", "G: the enriched drive still completes");
  eq(calls.length, 1, "G: enrichment fires exactly once — inside the first day-batch step");
  ok(calls[0].keys.length > 0, "G: enrichment receives the first-pass plan's finalist keys");
  const runRecord = drive.row.metadata.zeroEngine;
  eq(runRecord.enrichment.mode, "live", "G: the run record carries the enrichment report");
  eq(runRecord.enrichment.calls, 1 + calls[0].keys.length, "G: the run record counts the provider calls the step made");

  const storeOff = createMemoryStore();
  const driveOff = await driveToTerminal({ store: storeOff, packStore, tripId: "trip-g-off", payload, placesService: null });
  eq(driveOff.finalState.status, "complete", "G: with no Places service the drive completes (provider-OFF posture)");
  eq(driveOff.row.metadata.zeroEngine.enrichment, null, "G: with no Places service no enrichment is recorded — OSM-only, engine identical");
  console.log("G ok — two-pass enrichment");
}

/* ------------------------------------------------------------------ */
/* H — static proof: no model call exists in the engine path           */
/* ------------------------------------------------------------------ */

if (section("H")) {
  const source = readFileSync(new URL("../lib/roamly/engine/generate.ts", import.meta.url), "utf8");
  ok(!/from\s+["']openai["']/.test(source), "H: the adapter never imports the OpenAI SDK");
  ok(!/new\s+OpenAI\s*\(/.test(source), "H: the adapter never constructs an OpenAI client");
  ok(!/callJsonStage/.test(source), "H: the adapter never calls the incumbent's model stage runner");
  ok(!/chat\.completions/.test(source), "H: no chat.completions call shape exists in the adapter");
  ok(!/OPENAI_API_KEY/.test(source), "H: the adapter never references the OpenAI API key");
  ok(!/generateText|generateObject|streamText/.test(source), "H: no AI-SDK generation call exists in the adapter");
  ok(!/["']Generated through Roamly staged AI generation/.test(source), "H: the AI-generation literal is never written by the adapter");
  console.log("H ok — zero model calls in the engine path (static)");
}

console.log(`\nPhase 5 checks: ${count} assertions passed.`);
if (abResults.length) {
  console.log("\nA/B summary (engine leg, this harness):");
  for (const r of abResults) {
    console.log(
      `  ${r.destination} (${r.days}d): elapsed ${r.elapsedMs} ms, wakes ${r.wakes}, judge ${r.judge}, budget ${r.budget}, finalization ${r.finalization}, content validation ${r.contentValidation}, AI calls ${r.aiCalls}, predictions ${r.predictions}`
    );
  }
}
