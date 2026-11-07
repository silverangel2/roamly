// GAP-CLOSURE WAVE 3 — G3+G4: processGenerationQueue END-TO-END
// (2026-11-02, LOCAL ONLY).
//
// ROUTE ACHIEVED: Route 2 — JS EMULATIONS of the queue RPCs over the
// diet FakeDb pattern (scripts/roamly-gap-queue-fake.mjs), NOT a real
// Postgres/PostgREST stack. Route 1 was attempted first (PostgREST
// binary downloaded, cluster provisioned — see
// harness/GAP-D-CHANGELOG.md for the exact evidence and where it
// stopped). No blurring: every RPC named below ran as the faithful
// JS emulation in roamly-gap-queue-fake.mjs, transcribed from the
// final migration version of each function (claim pair incl. the
// 20261001 terminal-trip guard + ordering, renew, release,
// retry-scheduling, complete, finalize pair, reconcile,
// get-or-create). SKIP LOCKED is vacuous under single-threaded JS
// (serialized-execution caveat, same as wiring-fixes F2); lease and
// eligibility semantics are real-time and exact.
//
// The worker itself is the REAL lib/roamly/generationWorker.ts,
// imported unmodified through scripts/roamly-gap-loader.mjs, which
// redirects only its two environment seams (the fix1 harness
// template): @/lib/supabase/admin -> the GapDb instance installed on
// globalThis, and @/lib/roamly/itineraryGenerationEmail -> a capture
// stub. The zero-engine runtime deps the worker builds
// (buildEngineRuntimeDeps) are the REAL SupabasePackStore /
// SupabasePlacesLedgerStore / engine store, all over the same GapDb,
// with ROAMLY_PACK_STORE=supabase + ROAMLY_ZERO_ENGINE_ENABLED=1 —
// the production reachability gate, satisfied locally. The pack is
// the recorded Charlottetown pack, seeded through the REAL
// SupabasePackStore write path (enqueue -> claim -> build ->
// publish), so no OpenAI call is possible (zero-engine job,
// generation_version "zero-engine-v1").
//
// PROOF: two zero-engine trips driven ONLY by repeated
// processGenerationQueue({ tripId }) calls (the cron's own entry):
//   T1 queued -> complete: exactly one job row throughout, stage
//      progression observed across calls, final itinerary stored +
//      validateItineraryForProduction ok, exactly one prediction,
//      exactly one captured completion email, job row completed.
//   T2 interrupted between queue calls: first call yields after the
//      outline (execution-budget yield, the worker's own mechanism),
//      the job is then left claimed by a dead worker with an expired
//      lease (the crash shape), and later calls reclaim it via
//      roamly_claim_generation_job_by_trip and complete it — still
//      exactly one job row, one itinerary, one email.
//
// Run: npm run test:gap-g346 (gap register).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.ROAMLY_ZERO_ENGINE_ENABLED = "1";
process.env.ROAMLY_PACK_STORE = "supabase";
delete process.env.OPENAI_API_KEY;
delete process.env.GOOGLE_PLACES_API_KEY;
delete process.env.ROAMLY_PACK_CACHE_DIR;
for (const key of Object.keys(process.env)) {
  if (/^NEXT_PUBLIC_SUPABASE|^SUPABASE_SERVICE/.test(key)) delete process.env[key];
}

const { GapDb, emptyGapTables } = await import("./roamly-gap-queue-fake.mjs");

const db = new GapDb(emptyGapTables());
globalThis.__roamlyFakeSupabase = db;
globalThis.__capturedGenerationEmails = [];

const { processGenerationQueue } = await import("@/lib/roamly/generationWorker.ts");
const { createOrResumeGenerationJob } = await import("@/lib/roamly/generationQueue.ts");
const { createSupabaseEngineGenerationStore, startEngineGeneration } = await import("@/lib/roamly/engine/generate.ts");
const { getStagedGenerationState } = await import("@/lib/roamly/stagedItineraryGeneration.ts");
const { validateItineraryForProduction } = await import("@/lib/itinerary.ts");
const { SupabasePackStore } = await import("@/lib/roamly/engine/packs/supabaseStore.ts");
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

const USER = "22222222-2222-4222-8222-222222222222";
const FIX2 = new URL("./fixtures/wiring-phase2/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, FIX2), "utf8"));
const scenarios = load("scenarios.json").data;
const scn = scenarios.find((s) => s.entry.id === "charlottetown-smalltown");

function payloadForScenario(s) {
  const { entry, requestText, startDate, endDate } = s;
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
const payload = payloadForScenario(scn);
const emptyContext = () => ({
  personalization: { enabled: false, accepted: {}, inferred: {}, aggregateGuidance: [] },
  confirmedBookings: []
});

/* ------------------------------------------------------------------ */
/* World setup — recorded pack through the REAL SupabasePackStore     */
/* ------------------------------------------------------------------ */

console.log("setup — seeding Charlottetown pack through the real SupabasePackStore over GapDb");
{
  const packStore = new SupabasePackStore(db);
  const seeded = await seedDestinationFromRecordedPack(
    packStore,
    breadthDestination("Charlottetown"),
    load("packs/pack-charlottetown.json").data,
    { workerId: "g346-harness" }
  );
  ok(seeded.version, "setup: pack seeded and published through SupabasePackStore");
  eq(db.tables.roamly_destination_packs.filter((r) => r.status === "ready").length, 1, "setup: exactly one ready pack version row");
  ok(db.tables.roamly_destination_candidates.length > 50, `setup: pack candidates stored (${db.tables.roamly_destination_candidates.length} rows)`);
}

function seedTripRow(tripId) {
  const now = new Date().toISOString();
  db.tables.roamly_trips.push({
    id: tripId,
    user_id: USER,
    metadata: {
      planning: {
        tripType: "single_destination",
        origin: "Saint John",
        destination: scn.entry.destination,
        destinationCity: scn.entry.destination,
        startDate: scn.startDate,
        endDate: scn.endDate,
        daysCount: scn.entry.days
      }
    },
    status: "generating",
    itinerary_status: "generating",
    itinerary_locked: false,
    itinerary_locked_at: null,
    itinerary_generated_at: null,
    itinerary_unlock_source: "paid",
    itinerary_payment_status: null,
    created_at: now,
    updated_at: now
  });
}

async function startTrip(tripId) {
  seedTripRow(tripId);
  const store = createSupabaseEngineGenerationStore(db);
  const state = await startEngineGeneration({
    store,
    tripId,
    userId: USER,
    payload,
    requestId: `req-g346-start-${tripId.slice(-2)}`,
    unlockSource: "paid",
    context: emptyContext()
  });
  // Production creation order (tripGenerationRoute, M6b): the state
  // is persisted FIRST, then the durable queue job is created with
  // the zero-engine version explicitly forwarded — the version is
  // decided once, at creation, in the route. ensureTripJob inside
  // the worker only ever resumes an existing job's version; a
  // version-less creation would be a brain job. This call is the
  // route's setup, not part of the drive: everything after it is
  // processGenerationQueue only.
  const created = await createOrResumeGenerationJob({
    supabase: db,
    tripId,
    userId: USER,
    payload,
    priority: 10,
    generationVersion: "zero-engine-v1",
    reason: "g346_route_creation"
  });
  assert.ok(created.ok, `route-style job creation succeeds (${created.ok ? "" : created.error})`);
  return state;
}

const jobsFor = (tripId) => db.tables.roamly_trip_generation_jobs.filter((j) => j.trip_id === tripId);
const stateOf = (tripId) => {
  const row = db.tables.roamly_trips.find((t) => t.id === tripId);
  return getStagedGenerationState(row.metadata, tripId);
};
const NORMAL = { executionBudgetMs: 300_000, stageCleanupBufferMs: 1_000, maxLayersPerRun: 8, leaseSeconds: 240 };

async function driveToComplete(tripId, tag, maxCalls = 12) {
  const progression = [];
  let calls = 0;
  let maxJobs = 0;
  while (calls < maxCalls) {
    const summary = await processGenerationQueue({
      tripId,
      userId: USER,
      requestId: `req-g346-${tag}-${calls}`,
      config: NORMAL
    });
    calls += 1;
    maxJobs = Math.max(maxJobs, jobsFor(tripId).length);
    const st = stateOf(tripId);
    progression.push(`${st.status}/${st.currentStage}/${st.completedDayCount}of${st.totalDayCount}`);
    if (st.status === "complete" || st.status === "failed" || st.status === "partially_failed") {
      return { calls, progression, maxJobs, summary };
    }
  }
  return { calls, progression, maxJobs, summary: null };
}

/* ------------------------------------------------------------------ */
/* T1 — queued -> complete, driven only by processGenerationQueue     */
/* ------------------------------------------------------------------ */

console.log("T1 — zero-engine trip driven only by repeated processGenerationQueue calls");
const T1 = "11111111-1111-4111-8111-111111111111";
{
  const started = await startTrip(T1);
  eq(started.status, "queued", "T1 setup: staged state starts queued (zero-engine)");
  eq(jobsFor(T1).length, 1, "T1 setup: exactly one queued job exists before the drive (route creation, M6b order)");
  eq(jobsFor(T1)[0].status, "queued", "T1 setup: the created job is queued");
  eq(jobsFor(T1)[0].generation_version, "zero-engine-v1", "T1 setup: the created job carries the zero-engine version");

  // First call with a tight execution budget: the worker's own
  // yield mechanism stops it after the outline stage, so stage
  // progression is observable across calls.
  const first = await processGenerationQueue({
    tripId: T1,
    userId: USER,
    requestId: "req-g346-t1-0",
    config: { executionBudgetMs: 30_000, stageCleanupBufferMs: 1_000, maxLayersPerRun: 8, leaseSeconds: 240 }
  });
  eq(jobsFor(T1).length, 1, "T1: exactly one job row after the first queue call (ensureTripJob resumed it, no second row)");
  const afterFirst = stateOf(T1);
  ok(afterFirst.outline, "T1: the first queue call completed the outline stage");
  eq(afterFirst.status, "generating_day", "T1: state progressed queued -> generating_day after the outline");
  ok(first.results.some((r) => r.yielded), "T1: the tight-budget first call yielded before the day batch (worker yield path)");

  const driven = await driveToComplete(T1, "t1");
  const finalState = stateOf(T1);
  eq(finalState.status, "complete", `T1: repeated queue calls drive the trip to complete (progression: ${driven.progression.join(" -> ")})`);
  eq(driven.maxJobs, 1, "T1: exactly one job row throughout the whole drive");
  eq(jobsFor(T1).length, 1, "T1: exactly one job row at the end");
  const job = jobsFor(T1)[0];
  eq(job.generation_version, "zero-engine-v1", "T1: the single job carries the zero-engine version");
  eq(job.status, "completed", "T1: the job row ends completed (finalize RPCs)");
  ok(job.completed_at, "T1: the job row carries completed_at");
  const stageKinds = finalState.stageRuns.map((r) => r.stage);
  ok(stageKinds.includes("outline"), "T1: stage runs include the outline stage");
  ok(stageKinds.filter((s) => s === "day_batch").length >= scn.entry.days, `T1: stage runs include one day_batch per day (${stageKinds.filter((s) => s === "day_batch").length} >= ${scn.entry.days})`);
  eq(finalState.aiCallCount, 0, "T1: aiCallCount is 0 (zero-engine — no model call)");

  const itineraries = db.tables.roamly_itineraries.filter((i) => i.trip_id === T1);
  eq(itineraries.length, 1, "T1: exactly one itinerary row stored");
  eq(itineraries[0].source, "zero-engine", 'T1: the stored itinerary source is "zero-engine"');
  eq(
    validateItineraryForProduction(itineraries[0].full_json, payload).ok,
    true,
    "T1: the stored final itinerary passes validateItineraryForProduction"
  );
  eq(db.tables.roamly_trip_predictions.filter((p) => p.trip_id === T1).length, 1, "T1: exactly one prediction row written");
  const t1Emails = globalThis.__capturedGenerationEmails.filter((e) => e.tripId === T1);
  eq(t1Emails.length, 1, "T1: exactly one completion email captured");
  eq(t1Emails[0].kind, "completion", "T1: the captured email is the completion kind");

  const rpcNames = db.rpcCalls.map((c) => c.name);
  for (const name of [
    "roamly_get_or_create_generation_job",
    "roamly_claim_generation_job_by_trip",
    "roamly_renew_generation_lease",
    "roamly_finalize_generation_trip",
    "roamly_finalize_generation_completion",
    "roamly_complete_generation_job"
  ]) {
    ok(rpcNames.includes(name), `T1: queue RPC executed (emulated): ${name}`);
  }

  // NOTE: no post-complete targeted call is asserted here — a
  // targeted processGenerationQueue for a finished trip is the
  // re-generation path (ensureTripJob creates a fresh job for a
  // non-terminal "generated" trip), not the cron's fleet behaviour.
  // Completed-never-resurrected at the state seam is the kf2
  // suite's TERM block.
}

/* ------------------------------------------------------------------ */
/* T2 — interrupted between queue calls, then reclaimed + completed   */
/* ------------------------------------------------------------------ */

console.log("T2 — worker interrupted between queue calls; later calls reclaim and complete");
const T2 = "33333333-3333-4333-8333-333333333333";
{
  await startTrip(T2);
  const first = await processGenerationQueue({
    tripId: T2,
    userId: USER,
    requestId: "req-g346-t2-0",
    config: { executionBudgetMs: 30_000, stageCleanupBufferMs: 1_000, maxLayersPerRun: 8, leaseSeconds: 240 }
  });
  ok(first.results.some((r) => r.yielded), "T2: the first queue call yields after the outline (interruption point)");
  eq(stateOf(T2).status, "generating_day", "T2: the trip is mid-generation when the worker goes away");
  eq(jobsFor(T2).length, 1, "T2: exactly one job row at the interruption");

  // The crash shape: a later worker claimed the job and died —
  // running, locked by the dead worker, lease already expired.
  const job = jobsFor(T2)[0];
  const past = new Date(Date.now() - 60_000).toISOString();
  job.status = "running";
  job.locked_by = "roamly-worker:dead";
  job.locked_at = past;
  job.lease_expires_at = past;

  const driven = await driveToComplete(T2, "t2");
  const finalState = stateOf(T2);
  eq(finalState.status, "complete", `T2: later queue calls reclaim the dead worker's job and complete the trip (progression: ${driven.progression.join(" -> ")})`);
  eq(driven.maxJobs, 1, "T2: exactly one job row throughout (reclaim, never a second row)");
  eq(jobsFor(T2)[0].status, "completed", "T2: the reclaimed job ends completed");
  eq(jobsFor(T2)[0].locked_by, null, "T2: the dead worker's lock is cleared at completion");
  eq(db.tables.roamly_itineraries.filter((i) => i.trip_id === T2).length, 1, "T2: exactly one itinerary row stored");
  eq(
    validateItineraryForProduction(db.tables.roamly_itineraries.find((i) => i.trip_id === T2).full_json, payload).ok,
    true,
    "T2: the resumed trip's final itinerary validates"
  );
  eq(globalThis.__capturedGenerationEmails.filter((e) => e.tripId === T2 && e.kind === "completion").length, 1, "T2: exactly one completion email captured");
}

console.log(`\nG3+G4 gap checks (Route 2 — JS RPC emulations over GapDb): ${count} assertions passed.`);
