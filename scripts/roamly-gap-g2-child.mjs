// GAP-CLOSURE WAVE 3 — G2 child-process driver. NOT a suite: the
// parent suite (roamly-gap-g2-checks.mjs) spawns this file as its
// own node process so it can be SIGKILLed mid-stage.
//
// Modes:
//   run    — seed + start a zero-engine Charlottetown generation on
//            a FRESH file store and drive it wake-by-wake. The pack
//            store is wrapped in the slow proxy below: the SECOND
//            getPin call (the first day-batch stage's pinned-pack
//            assembly — the outline's assembly is call #1) writes
//            the in-flight marker and blocks the process for ~3 s
//            with Atomics.wait. That is the kill window: the batch
//            has already been flipped to "generating" and persisted
//            to the file store, and no stage work has completed.
//   resume — load the SAME file store (no seed/start) and drive the
//            remaining wakes with an unproxied pack store.
//
// On completion the child writes <markerDir>/completed.json with
// the canonical final itinerary, then exits 0.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FileEngineStore } from "./roamly-gap-g2-file-store.mjs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const mode = args.get("--mode");
const storePath = args.get("--store");
const markerDir = args.get("--markers");
const TRIP_ID = "trip-g2-shared";
const USER_ID = "g2-harness-user";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}
delete process.env.OPENAI_API_KEY;

const { advanceEngineGeneration, startEngineGeneration } = await import("@/lib/roamly/engine/generate.ts");
const { getStagedGenerationState, nextStagedGenerationWork } = await import("@/lib/roamly/stagedItineraryGeneration.ts");
const { InMemoryPackStore } = await import("@/lib/roamly/engine/packs/store.ts");
const { seedDestinationFromRecordedPack } = await import("@/lib/roamly/engine/packs/builder.ts");
const { breadthDestination } = await import("@/lib/roamly/engine/packs/destinations.ts");

const FIX2 = new URL("./fixtures/wiring-phase2/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, FIX2), "utf8"));
const scn = load("scenarios.json").data.find((s) => s.entry.id === "charlottetown-smalltown");
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
const emptyContext = () => ({
  personalization: { enabled: false, accepted: {}, inferred: {}, aggregateGuidance: [] },
  confirmedBookings: []
});
const canon = (x) =>
  JSON.stringify(x, (k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter(([, val]) => val !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v
  );

const packStore = new InMemoryPackStore();
await seedDestinationFromRecordedPack(
  packStore,
  breadthDestination("Charlottetown"),
  load("packs/pack-charlottetown.json").data,
  { workerId: "g2-child" }
);

let getPinCalls = 0;
const slowPackStore = new Proxy(packStore, {
  get(target, prop) {
    const value = target[prop];
    if (prop === "getPin") {
      return async (...callArgs) => {
        getPinCalls += 1;
        if (getPinCalls === 2) {
          // Mid day-batch stage: the batch flip is already persisted
          // in the file store. Announce, then block hard.
          writeFileSync(path.join(markerDir, "inflight.marker"), `getPin#2 pid=${process.pid}\n`);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 3000);
        }
        return target.getPin(...callArgs);
      };
    }
    return typeof value === "function" ? value.bind(target) : value;
  }
});

const store = new FileEngineStore(storePath);

if (mode === "resume") {
  // Pack-store pin rehydration: the pin TABLE of the in-memory
  // pack store cannot cross processes (in production it is a
  // Postgres table in SupabasePackStore and persists). The durable
  // run record in the file store carries the pinned version id, so
  // the resume process re-pins from it — after asserting the
  // re-seeded pack is byte-identical by content address (same
  // packVersionId), which is what makes the re-pin sound.
  const existing = await store.loadTrip(TRIP_ID, USER_ID);
  const runRecord = existing.metadata.zeroEngine;
  if (!runRecord?.packVersionId) throw new Error("resume: no pinned pack version in the run record");
  const versions = await packStore.listVersions(runRecord.destinationId);
  const match = versions.find((v) => v.dto.packVersionId === runRecord.packVersionId);
  if (!match) throw new Error(`resume: re-seeded pack version ${runRecord.packVersionId} not found`);
  await packStore.pinVersion(TRIP_ID, runRecord.packVersionId);
}

if (mode === "run") {
  store.seedTrip(TRIP_ID, USER_ID);
  await startEngineGeneration({
    store,
    tripId: TRIP_ID,
    userId: USER_ID,
    payload,
    requestId: "req-g2-start",
    unlockSource: "paid",
    context: emptyContext()
  });
} else if (mode !== "resume") {
  throw new Error(`unknown mode ${mode}`);
}

const drivePackStore = mode === "resume" ? packStore : slowPackStore;

if (mode === "resume") {
  // The stranded-batch watchdog (resetStrandedGeneratingBatches)
  // only resets a "generating" batch once its flip is older than
  // STAGE_LEASE_MS + DAY_TIMEOUT_MS — with the harness env that is
  // 12 s. Wait out the remainder in real time; the gate executes
  // unmodified inside advance.
  const strandedAgeMs =
    Number(process.env.ROAMLY_STAGED_GENERATION_LEASE_MS || 240000) +
    Number(process.env.OPENAI_DAY_TIMEOUT_MS || 45000) +
    500;
  for (let waited = 0; waited < 90000; waited += 500) {
    const row = await store.loadTrip(TRIP_ID, USER_ID);
    const st = getStagedGenerationState(row.metadata, TRIP_ID);
    const generating = Object.values(st.batches).filter((b) => b.status === "generating");
    if (!generating.length) break;
    const flippedAt = Math.max(...generating.map((b) => new Date(b.updatedAt || b.startedAt || 0).getTime()));
    if (Date.now() - flippedAt > strandedAgeMs) break;
    await new Promise((r) => setTimeout(r, 500));
  }
}

for (let wake = 0; wake < 40; wake++) {
  const row = await store.loadTrip(TRIP_ID, USER_ID);
  const st = getStagedGenerationState(row.metadata, TRIP_ID);
  if (!nextStagedGenerationWork(st)) break;
  const result = await advanceEngineGeneration({
    deps: { store, packStore: drivePackStore },
    tripId: TRIP_ID,
    userId: USER_ID,
    requestId: `req-g2-${mode}-wake-${wake}`
  });
  if (result.state.status === "complete" || result.state.status === "failed" || result.state.status === "partially_failed") break;
}

const finalRow = await store.loadTrip(TRIP_ID, USER_ID);
const finalState = getStagedGenerationState(finalRow.metadata, TRIP_ID);
const data = store.read();
const itin = data.itineraries[TRIP_ID];
writeFileSync(
  path.join(markerDir, `completed-${mode}.json`),
  JSON.stringify({
    status: finalState.status,
    canon: itin ? canon(itin.full_json) : null,
    itineraries: Object.keys(data.itineraries).length,
    predictions: Object.values(data.predictions).filter((p) => p.tripId === TRIP_ID).length
  })
);
process.exit(finalState.status === "complete" ? 0 : 1);
