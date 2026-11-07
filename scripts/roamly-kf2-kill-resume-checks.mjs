// KF-2 KILL-AND-RESUME ACCEPTANCE — stranded-generation recovery fix
// (2026-11-02, proof-harness pass, LOCAL ONLY).
//
// Lane A of harness/diagnosis/HARNESS-PLAN.md: the deterministic
// zero-engine driver over the wiring-phase5 in-memory store seam.
// A "kill" is simulated by fabricating exactly the persistent state
// a dead driver leaves (the store IS the process boundary — every
// stage persists before/after its work; phase-5 §D / pack-kick
// precedent). Evidence category: CODE-PROVEN at the store seam.
// A real process SIGKILL is NOT DONE (HARNESS-PLAN gap G2).
//
// Proves:
//   GOLDEN  — an uninterrupted Charlottetown generation driven
//             wake-by-wake to complete; canon(full_json) saved.
//   K-OUT   — kill at OUTLINE (G1 recipe: fabricated post-claim /
//             pre-persist state, worker lease already past): the
//             resume wake re-runs the outline and the drive
//             completes with canon(full_json) === golden.
//             Live-foreign-lease variant: busy, state untouched.
//   K-BATCH — kill MID-BATCH (phase-5 §D fabrication): the resume
//             wake records a STAGE_DRIVER_LOST stage run, the reset
//             batch completes in the SAME wake, the drive completes,
//             canon(full_json) === golden. Negative control: the
//             same fabrication with a fresh timestamp is NOT
//             stranded (watchdog changed:false).
//   TERM    — a completed generation is never resurrected: extra
//             wakes change nothing.
//   ONE     — exactly one trip row, one final itinerary
//             (final===true, source "zero-engine"), one prediction
//             (duplicate writePrediction -> written:false);
//             validateItineraryForProduction(full_json).ok === true.
//   EMAIL   — exactly one completion-email SELECTION over the
//             resumed run's stored final itinerary, via the
//             v1-finalization (c2) procedure: a single email result
//             object (status "skipped" — no admin client locally,
//             transport boundary) and exactly one finalize RPC.
//             Selection-level proof only; no real send in this lane.
//
// Run: npm run test:kf2-kill-resume (phase-5 register).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// No Supabase service-role configuration may leak into this lane:
// that keeps sendStagedGenerationEmail at its local skipped result
// and every store/finalization call on the fakes below.
for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}
delete process.env.OPENAI_API_KEY;

const {
  advanceEngineGeneration,
  startEngineGeneration,
  ZERO_ENGINE_PROVIDER
} = await import("@/lib/roamly/engine/generate.ts");
const {
  getStagedGenerationState,
  nextStagedGenerationWork,
  resetStrandedGeneratingBatches,
  STAGED_GENERATION_STRANDED_ERROR_CODE
} = await import("@/lib/roamly/stagedItineraryGeneration.ts");
const { validateItineraryForProduction } = await import("@/lib/itinerary.ts");
const { finalizeCompletedStagedGeneration } = await import("@/lib/roamly/generationFinalization.ts");
const { payloadFromTrip } = await import("@/lib/roamly/marketPriceRefresh.ts");
const { InMemoryPackStore } = await import("@/lib/roamly/engine/packs/store.ts");
const { seedDestinationFromRecordedPack } = await import("@/lib/roamly/engine/packs/builder.ts");
const { breadthDestination } = await import("@/lib/roamly/engine/packs/destinations.ts");

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
  console.log(`  PASS ${label}`);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
  console.log(`  PASS ${label}`);
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const canon = (x) =>
  JSON.stringify(x, (k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter(([, val]) => val !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v
  );

/* ------------------------------------------------------------------ */
/* In-memory EngineGenerationStore — verbatim wiring-phase5 pattern   */
/* ------------------------------------------------------------------ */

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
        source: final ? "zero-engine" : null,
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
/* Harness plumbing — wiring-phase5 patterns                          */
/* ------------------------------------------------------------------ */

const USER_ID = "kf2-harness-user";
const FIX2 = new URL("./fixtures/wiring-phase2/", import.meta.url);
const load = (name, base = FIX2) => JSON.parse(readFileSync(new URL(name, base), "utf8"));
const scenarios = load("scenarios.json").data;
const scenarioById = (id) => scenarios.find((s) => s.entry.id === id);

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
  await seedDestinationFromRecordedPack(
    store,
    breadthDestination("Charlottetown"),
    load("packs/pack-charlottetown.json").data,
    { workerId: "kf2-harness" }
  );
  return store;
}

async function startTrip(store, tripId, payload, tag) {
  store.seedTrip(tripId, USER_ID);
  return startEngineGeneration({
    store,
    tripId,
    userId: USER_ID,
    payload,
    requestId: `req-${tag}-start`,
    unlockSource: "paid",
    context: emptyContext()
  });
}

// Wake-by-wake drive of an ALREADY-STARTED trip until terminal.
async function driveExistingToTerminal({ store, packStore, tripId, tag, maxWakes = 40 }) {
  let last = null;
  let wakes = 0;
  for (let i = 0; i < maxWakes; i++) {
    const row = await store.loadTrip(tripId, USER_ID);
    const st = getStagedGenerationState(row.metadata, tripId);
    const work = nextStagedGenerationWork(st);
    if (!work) break;
    wakes += 1;
    last = await advanceEngineGeneration({
      deps: { store, packStore },
      tripId,
      userId: USER_ID,
      requestId: `req-${tag}-wake-${i}`
    });
    if (last.state.status === "complete" || last.state.status === "failed" || last.state.status === "partially_failed") break;
  }
  const row = await store.loadTrip(tripId, USER_ID);
  return { finalState: getStagedGenerationState(row.metadata, tripId), row, wakes, last };
}

const packStore = await seedPackStore();
const scn = scenarioById("charlottetown-smalltown");
const payload = payloadForScenario(scn);

/* ------------------------------------------------------------------ */
/* GOLDEN — uninterrupted drive                                       */
/* ------------------------------------------------------------------ */

console.log("GOLDEN — uninterrupted Charlottetown generation (zero-engine)");

const goldenStore = createMemoryStore();
await startTrip(goldenStore, "trip-kf2-golden", payload, "golden");
const goldenDrive = await driveExistingToTerminal({
  store: goldenStore, packStore, tripId: "trip-kf2-golden", tag: "golden"
});
eq(goldenDrive.finalState.status, "complete", "golden: uninterrupted drive reaches complete");
const goldenItin = goldenStore.itineraries.get("trip-kf2-golden");
ok(goldenItin, "golden: a final itinerary row was persisted");
const GOLDEN_CANON = canon(goldenItin.full_json);
eq(goldenDrive.finalState.aiCallCount, 0, "golden: aiCallCount is 0 (zero-engine, no model call)");
ok(
  goldenDrive.finalState.stageRuns.every((r) => r.provider === ZERO_ENGINE_PROVIDER),
  "golden: every stage run carries the zero-engine provider"
);
eq(validateItineraryForProduction(goldenItin.full_json, payload).ok, true, "golden: validateItineraryForProduction(full_json).ok === true");

/* ------------------------------------------------------------------ */
/* K-OUT — kill at OUTLINE                                            */
/* ------------------------------------------------------------------ */

console.log("K-OUT — kill at outline (fabricated post-claim/pre-persist state, lease past)");

const outlineStore = createMemoryStore();
const outlineTrip = "trip-kf2-kill-outline";
await startTrip(outlineStore, outlineTrip, payload, "kout");
// G1 recipe: the shape a driver killed DURING the outline call
// leaves — state flipped to generating_outline, outline not yet
// persisted, claim lease still in the document but already past.
outlineStore.tamper(outlineTrip, (row) => {
  const g = row.metadata.generation;
  g.status = "generating_outline";
  g.currentStage = "generating_outline";
  g.outline = null;
  g.worker = { leaseId: "req-dead-driver", leaseExpiresAt: new Date(Date.now() - 1_000).toISOString() };
});
const outlineResume = await advanceEngineGeneration({
  deps: { store: outlineStore, packStore },
  tripId: outlineTrip,
  userId: USER_ID,
  requestId: "req-kout-resume"
});
eq(outlineResume.advanced, true, "K-OUT: the resume wake advances past the dead driver's lease");
eq(outlineResume.stage, "outline", "K-OUT: the resume wake re-runs the outline stage");
const outlineDrive = await driveExistingToTerminal({
  store: outlineStore, packStore, tripId: outlineTrip, tag: "kout"
});
eq(outlineDrive.finalState.status, "complete", "K-OUT: the resumed drive completes");
eq(
  canon(outlineStore.itineraries.get(outlineTrip).full_json),
  GOLDEN_CANON,
  "K-OUT: final canon(full_json) === golden"
);

// Live-foreign-lease variant: the same kill shape but the lease is
// still live — the wake must return busy and touch nothing.
console.log("K-OUT live-lease variant — busy, state untouched");
const liveStore = createMemoryStore();
const liveTrip = "trip-kf2-live-lease";
await startTrip(liveStore, liveTrip, payload, "live");
liveStore.tamper(liveTrip, (row) => {
  const g = row.metadata.generation;
  g.status = "generating_outline";
  g.currentStage = "generating_outline";
  g.outline = null;
  g.worker = { leaseId: "req-other-worker", leaseExpiresAt: new Date(Date.now() + 120_000).toISOString() };
});
const liveBefore = (await liveStore.loadTrip(liveTrip, USER_ID)).metadata.generation;
const busyResult = await advanceEngineGeneration({
  deps: { store: liveStore, packStore },
  tripId: liveTrip,
  userId: USER_ID,
  requestId: "req-live-mine"
});
eq(busyResult.busy, true, "K-OUT live-lease: a live foreign lease returns busy:true");
eq(busyResult.advanced, false, "K-OUT live-lease: a busy wake advances nothing");
const liveAfter = (await liveStore.loadTrip(liveTrip, USER_ID)).metadata.generation;
eq(canon(liveAfter), canon(liveBefore), "K-OUT live-lease: the state document is untouched by the busy wake");

/* ------------------------------------------------------------------ */
/* K-BATCH — kill MID-BATCH                                           */
/* ------------------------------------------------------------------ */

console.log("K-BATCH — kill mid-batch (phase-5 §D fabrication)");

const batchStore = createMemoryStore();
const batchTrip = "trip-kf2-kill-batch";
await startTrip(batchStore, batchTrip, payload, "kbatch");
const outlineWake = await advanceEngineGeneration({
  deps: { store: batchStore, packStore },
  tripId: batchTrip,
  userId: USER_ID,
  requestId: "req-kbatch-outline"
});
eq(outlineWake.stage, "outline", "K-BATCH: the pre-kill wake runs the outline stage");
const strandedAt = new Date(Date.now() - 10 * 60_000).toISOString();
batchStore.tamper(batchTrip, (row) => {
  const g = row.metadata.generation;
  g.batches["batch-1"] = { ...g.batches["batch-1"], status: "generating", attemptCount: 1, startedAt: strandedAt, updatedAt: strandedAt };
  g.days["1"] = { ...g.days["1"], status: "generating", attemptCount: 1, startedAt: strandedAt, updatedAt: strandedAt };
  g.worker = null;
});
const batchResume = await advanceEngineGeneration({
  deps: { store: batchStore, packStore },
  tripId: batchTrip,
  userId: USER_ID,
  requestId: "req-kbatch-resume"
});
eq(batchResume.advanced, true, "K-BATCH: the resume wake advances the job");
ok(
  batchResume.state.stageRuns.some((r) => r.errorCode === STAGED_GENERATION_STRANDED_ERROR_CODE),
  "K-BATCH: the resume wake records a STAGE_DRIVER_LOST stage run (errorCode === STAGED_GENERATION_STRANDED_ERROR_CODE)"
);
eq(batchResume.state.batches["batch-1"].status, "complete", "K-BATCH: the reset batch completes in the SAME wake");
const batchDrive = await driveExistingToTerminal({
  store: batchStore, packStore, tripId: batchTrip, tag: "kbatch"
});
eq(batchDrive.finalState.status, "complete", "K-BATCH: the resumed drive completes");
eq(
  canon(batchStore.itineraries.get(batchTrip).full_json),
  GOLDEN_CANON,
  "K-BATCH: final canon(full_json) === golden"
);

// Negative control: the same fabrication with a FRESH timestamp is
// not stranded — a live driver may still own it.
console.log("K-BATCH negative control — fresh timestamp is NOT stranded");
{
  const freshRow = await batchStore.loadTrip(batchTrip, USER_ID);
  void freshRow;
  const ctrlStore = createMemoryStore();
  const ctrlTrip = "trip-kf2-fresh-batch";
  const started = await startTrip(ctrlStore, ctrlTrip, payload, "fresh");
  const freshAt = new Date().toISOString();
  const fabricated = clone(started);
  fabricated.batches["batch-1"] = { ...fabricated.batches["batch-1"], status: "generating", attemptCount: 1, startedAt: freshAt, updatedAt: freshAt };
  fabricated.days["1"] = { ...fabricated.days["1"], status: "generating", attemptCount: 1, startedAt: freshAt, updatedAt: freshAt };
  const watchdog = resetStrandedGeneratingBatches(fabricated, Date.now());
  eq(watchdog.changed, false, "K-BATCH negative: a fresh 'generating' batch is NOT treated as stranded (watchdog changed:false)");
}

/* ------------------------------------------------------------------ */
/* ONE — one trip / one itinerary / one prediction (resumed run)      */
/* ------------------------------------------------------------------ */

console.log("ONE — one-ness on the killed-and-resumed (mid-batch) run");

eq(batchStore.trips.size, 1, "ONE: exactly one trip row exists");
eq(batchStore.itineraries.size, 1, "ONE: exactly one itinerary row exists");
const resumedItin = batchStore.itineraries.get(batchTrip);
eq(resumedItin.final, true, "ONE: the single itinerary is final===true");
eq(resumedItin.source, "zero-engine", 'ONE: the single itinerary source is "zero-engine"');
eq(validateItineraryForProduction(resumedItin.full_json, payload).ok, true, "ONE: validateItineraryForProduction(resumed full_json).ok === true");
const resumedPreds = [...batchStore.predictions.values()].filter((p) => p.tripId === batchTrip);
eq(resumedPreds.length, 1, "ONE: exactly one prediction was written for the trip");
const dupPred = await batchStore.writePrediction(resumedPreds[0]);
eq(dupPred.written, false, "ONE: a duplicate writePrediction returns written:false");
eq(
  [...batchStore.predictions.values()].filter((p) => p.tripId === batchTrip).length,
  1,
  "ONE: still exactly one prediction after the duplicate attempt"
);

/* ------------------------------------------------------------------ */
/* TERM — a completed generation is never resurrected                 */
/* ------------------------------------------------------------------ */

console.log("TERM — extra wakes on the completed state change nothing");

{
  const runsBefore = batchDrive.finalState.stageRuns.length;
  const itinBefore = canon(batchStore.itineraries.get(batchTrip).full_json);
  for (let i = 0; i < 3; i++) {
    await advanceEngineGeneration({
      deps: { store: batchStore, packStore },
      tripId: batchTrip,
      userId: USER_ID,
      requestId: `req-kbatch-extra-${i}`
    });
  }
  const rowAfter = await batchStore.loadTrip(batchTrip, USER_ID);
  const stateAfter = getStagedGenerationState(rowAfter.metadata, batchTrip);
  eq(stateAfter.status, "complete", "TERM: the state stays complete after extra wakes");
  eq(stateAfter.stageRuns.length, runsBefore, "TERM: no new stage runs are recorded by extra wakes");
  eq(batchStore.itineraries.size, 1, "TERM: no new itinerary appears after extra wakes");
  eq(canon(batchStore.itineraries.get(batchTrip).full_json), itinBefore, "TERM: the final itinerary document is unchanged");
  eq(batchStore.predictions.size, 1, "TERM: no new prediction appears after extra wakes");
}

/* ------------------------------------------------------------------ */
/* EMAIL — exactly one completion-email SELECTION (selection-level)   */
/* ------------------------------------------------------------------ */

console.log("EMAIL — one completion-email selection over the resumed run's stored final itinerary");
console.log("  LABEL: selection-level proof (v1-finalization c2 procedure) — sendStagedGenerationEmail");
console.log("  builds its own admin client; locally it returns one skipped result and sends nothing.");

const EMAIL_TRIP_ID = batchTrip;
const emailTripRow = {
  id: EMAIL_TRIP_ID,
  user_id: USER_ID,
  metadata: {
    planning: {
      tripType: "single_destination",
      origin: "Saint John",
      destination: scn.entry.destination,
      destinationCity: scn.entry.destination,
      startDate: scn.startDate,
      endDate: scn.endDate,
      daysCount: scn.entry.days
    },
    generationEmail: { tripId: EMAIL_TRIP_ID, email_me_when_ready: true }
  },
  status: "generating",
  itinerary_status: "generating",
  itinerary_locked: false,
  itinerary_locked_at: null,
  itinerary_generated_at: null,
  itinerary_unlock_source: "paid",
  itinerary_payment_status: null
};

function makeFakeSupabase(storedDoc) {
  const calls = { rpc: [] };
  class FakeQuery {
    constructor(table) {
      this.table = table;
    }
    select() { return this; }
    eq() { return this; }
    not() { return this; }
    order() { return this; }
    limit() { return this; }
    or() { return this; }
    update() { return this; }
    async maybeSingle() {
      if (this.table === "roamly_trips") return { data: clone(emailTripRow), error: null };
      return { data: null, error: null };
    }
    then(resolve, reject) {
      if (this.table === "roamly_itineraries") {
        return Promise.resolve({
          data: [{ id: "itin-kf2-1", full_json: clone(storedDoc), updated_at: new Date().toISOString(), source: "zero-engine" }],
          error: null
        }).then(resolve, reject);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    }
  }
  return {
    calls,
    from(table) {
      return new FakeQuery(table);
    },
    async rpc(name) {
      calls.rpc.push(name);
      return { data: true, error: null };
    }
  };
}

{
  const storedDoc = batchStore.itineraries.get(batchTrip).full_json;
  // The exact deciding call inside finalizeCompletedStagedGeneration:
  // completionKind starts "completion" and downgrades only if this
  // readiness call fails.
  const selPayload = payloadFromTrip(clone(emailTripRow));
  const readiness = validateItineraryForProduction(clone(storedDoc), selPayload);
  eq(readiness.ok, true, `EMAIL: email-selection readiness over the resumed doc is ok:true (errors: ${JSON.stringify(readiness.errors)})`);

  const fake = makeFakeSupabase(storedDoc);
  const logs = [];
  const originalInfo = console.info;
  console.info = (...args) => {
    logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  let result;
  try {
    result = await finalizeCompletedStagedGeneration({
      supabase: fake,
      tripId: EMAIL_TRIP_ID,
      userId: USER_ID,
      state: null,
      source: "kf2-kill-resume-checks"
    });
  } finally {
    console.info = originalInfo;
  }
  eq(result.ok, true, `EMAIL: finalizeCompletedStagedGeneration returns ok:true (got ${JSON.stringify({ ok: result.ok, error: result.error || null })})`);
  eq(result.recoveredFromStoredItinerary, true, "EMAIL: finalization recovered the resumed run's stored itinerary");
  ok(result.email && !Array.isArray(result.email), "EMAIL: exactly one email selection object was produced (a single sendStagedGenerationEmail call)");
  eq(result.email.status, "skipped", "EMAIL: the single selection is the local skipped result (no admin client — no real send in this lane)");
  ok(
    !logs.some((l) => l.includes("staged_generation_stored_itinerary_not_ready")),
    "EMAIL: NO not-ready diagnostic — the selection kind stayed completion"
  );
  eq(
    JSON.stringify(fake.calls.rpc),
    JSON.stringify(["roamly_finalize_generation_trip"]),
    "EMAIL: exactly one finalize RPC ran (roamly_finalize_generation_trip)"
  );
}

console.log(`\nKF-2 kill-and-resume checks: ${count} assertions passed.`);
