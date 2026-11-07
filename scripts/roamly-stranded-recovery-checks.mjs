// KF-2 STRANDED-GENERATION RECOVERY — sweep + gate-parity checks
// (2026-11-02, proof-harness pass, LOCAL ONLY).
//
// Exercises the REAL runStrandedGenerationRecovery
// (lib/roamly/generationRecovery.ts) and the REAL
// generationSweeperHasWork (lib/roamly/generationWorkGate.ts)
// against the diet FakeDb (scripts/roamly-egress-diet-fake.mjs),
// with an INJECTED recording drive passed via opts.drive — the
// same seam Impl-A's smoke test used. The production drive
// (processGenerationQueue over real RPCs) is NOT run here:
// HARNESS-PLAN gaps G3/G4, NOT DONE.
//
// Classes proven:
//   A dead_driver      — running job, queue lease expired, state
//                        lease expired, stale progress -> driven,
//                        no reopen.
//   B retry_exhausted  — failed job retry_count 3, completed_at
//                        null, mid-flight generating_day state,
//                        stale -> reopened FIRST (job row waiting /
//                        retry_count 0 / locks cleared), then
//                        driven; exactly one job row throughout.
//   C no_active_job    — legacy-set trip, stranded resumable
//                        state, no active job -> driven.
//   SKIPS              — complete state; failed-terminal
//                        non-resumable state; live staged lease
//                        (skippedLive >= 1); live queue lease on a
//                        running job; fresh progress (< 285 s);
//                        terminal trip with an exhausted job (no
//                        reopen). Drive never called, nothing
//                        mutated.
//   GATE PARITY        — generationSweeperHasWork directly over
//                        the failed-job shapes M4 made invisible.
//   FIX #1 INTERLEAVE  — see the section's own note: the
//                        wiring-fixes fake cannot be imported (its
//                        suite executes top-level), so the
//                        interleave is implemented here against the
//                        diet FakeDb extended in-suite with the
//                        migration's step-1 active-wins RPC
//                        semantics (the only step the interleave
//                        reaches — the killed trip HAS an active
//                        job). The serialized-execution caveat of
//                        wiring-fixes §1 applies unchanged.
//
// Run: npm run test:stranded-recovery (phase-5 register).

import assert from "node:assert/strict";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}
delete process.env.OPENAI_API_KEY;

const { runStrandedGenerationRecovery, STRANDED_GENERATION_MIN_AGE_MS } = await import(
  "@/lib/roamly/generationRecovery.ts"
);
const { generationSweeperHasWork } = await import("@/lib/roamly/generationWorkGate.ts");
const { createOrResumeGenerationJob } = await import("@/lib/roamly/generationQueue.ts");
const { ensureTripJob } = await import("@/lib/roamly/generationWorker.ts");
const { FakeDb, FakeQuery } = await import("./roamly-egress-diet-fake.mjs");

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

const NOW = new Date("2026-11-02T15:00:00.000Z");
const NOW_MS = NOW.getTime();
const iso = (ms) => new Date(ms).toISOString();
const STALE = iso(NOW_MS - 10 * 60_000); // 600 s without progress (> 285 s)
const FRESH = iso(NOW_MS - 60_000); // 60 s (< 285 s)
const PAST = iso(NOW_MS - 60_000);
const FUTURE = iso(NOW_MS + 3_600_000);
const USER = "22222222-2222-4222-8222-222222222222";

eq(STRANDED_GENERATION_MIN_AGE_MS, 285_000, "setup: STRANDED_GENERATION_MIN_AGE_MS is 285000 (240 s lease + 45 s day timeout)");

function makeState(tripId, overrides = {}) {
  return {
    version: 2,
    tripId,
    status: "generating_day",
    currentStage: "generating_day",
    totalDayCount: 3,
    completedDayCount: 1,
    outline: {
      tripSummary: "Stranded-recovery harness trip.",
      hotelAreaRecommendation: "Downtown.",
      importantConstraints: [],
      days: [1, 2, 3].map((n) => ({
        id: `day-${n}`, dayNumber: n, date: "", theme: "Exploring",
        geographicArea: "Charlottetown", priorityActivities: []
      }))
    },
    days: {
      "1": { dayNumber: 1, status: "complete", attemptCount: 1, updatedAt: STALE },
      "2": { dayNumber: 2, status: "queued", attemptCount: 0, updatedAt: STALE },
      "3": { dayNumber: 3, status: "queued", attemptCount: 0, updatedAt: STALE }
    },
    batches: {
      "batch-1": { id: "batch-1", dayNumbers: [1], status: "complete", attemptCount: 1, updatedAt: STALE },
      "batch-2": { id: "batch-2", dayNumbers: [2], status: "queued", attemptCount: 0, updatedAt: STALE },
      "batch-3": { id: "batch-3", dayNumbers: [3], status: "queued", attemptCount: 0, updatedAt: STALE }
    },
    generatedDays: {},
    payload: { destination: "Charlottetown", daysCount: 3, startDate: "2026-11-10", endDate: "2026-11-12" },
    personalization: { enabled: false, accepted: {}, inferred: {}, aggregateGuidance: [] },
    stageRuns: [],
    aiCallCount: 0,
    startedAt: STALE,
    updatedAt: STALE,
    completedAt: null,
    worker: null,
    ...overrides
  };
}

function tripRow(tripId, state, overrides = {}) {
  return {
    id: tripId,
    user_id: USER,
    metadata: { generation: state },
    status: "generating",
    itinerary_status: "generating",
    updated_at: STALE,
    ...overrides
  };
}

function jobRow(jobId, tripId, overrides = {}) {
  return {
    id: jobId,
    trip_id: tripId,
    user_id: USER,
    status: "running",
    retry_count: 0,
    lease_expires_at: PAST,
    completed_at: null,
    next_attempt_at: PAST,
    locked_at: PAST,
    locked_by: "dead-worker",
    last_error_code: null,
    last_error_message: null,
    updated_at: STALE,
    ...overrides
  };
}

function recorder() {
  const calls = [];
  return {
    calls,
    drive: async (tripId, userId) => {
      calls.push({ tripId, userId });
      return { ok: true, drivenBy: "injected-recorder" };
    }
  };
}

async function runRecovery(db, rec) {
  return runStrandedGenerationRecovery(db, { now: NOW, drive: rec.drive });
}

// RECOVERY-EVENTS ADDENDUM (2026-11-03): the sweep persists one
// roamly_app_events row (event_type "generation_recovery") per
// candidate action it takes. The FakeDb stores the recordAppEvent
// insert verbatim, so the rows are directly assertable here.
function recoveryEvents(db) {
  return (db.tables.roamly_app_events || []).filter((row) => row.event_type === "generation_recovery");
}

/* ------------------------------------------------------------------ */
/* Class A — dead_driver                                              */
/* ------------------------------------------------------------------ */

console.log("Class A — running job, both leases expired, stale progress");

{
  const tripId = "trip-stranded-a";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, makeState(tripId))],
    roamly_trip_generation_jobs: [jobRow("job-a", tripId)],
    roamly_communication_ledger: []
  });
  const rec = recorder();
  const summary = await runRecovery(db, rec);
  eq(rec.calls.length, 1, "A: the injected drive was called exactly once");
  eq(rec.calls[0].tripId, tripId, "A: the drive targeted the stranded trip");
  eq(summary.driven, 1, "A: summary.driven === 1");
  eq(summary.reopened, 0, "A: no reopen for a running job (targeted drive reclaims via claim-by-trip)");
  eq(summary.candidates.length, 1, "A: exactly one candidate was acted on");
  eq(summary.candidates[0].class, "dead_driver", "A: candidate class is dead_driver");
  eq(db.tables.roamly_trip_generation_jobs.length, 1, "A: exactly one job row throughout");
  eq(db.tables.roamly_trip_generation_jobs[0].status, "running", "A: the sweep itself did not rewrite the running job row");
  const eventsA = recoveryEvents(db);
  eq(eventsA.length, 1, "A-events: exactly one generation_recovery event was persisted for the action");
  eq(eventsA[0].user_id, USER, "A-events: the event carries the trip owner's user id");
  eq(eventsA[0].metadata.tripId, tripId, "A-events: metadata.tripId is the stranded trip");
  eq(eventsA[0].metadata.jobId, "job-a", "A-events: metadata.jobId is the dead-driver job");
  eq(eventsA[0].metadata.recoveryClass, "dead_driver", "A-events: metadata.recoveryClass is dead_driver");
  eq(eventsA[0].metadata.action, "drive", "A-events: metadata.action is drive");
  eq(eventsA[0].metadata.outcome, "driven", "A-events: metadata.outcome is driven");
  eq(eventsA[0].metadata.stalenessSeconds, 600, "A-events: metadata.stalenessSeconds is the observed 600 s without progress");
}

/* ------------------------------------------------------------------ */
/* Class B — retry_exhausted: reopen FIRST, then drive                */
/* ------------------------------------------------------------------ */

console.log("Class B — failed job, retry_count 3, completed_at null, mid-flight state");

{
  const tripId = "trip-stranded-b";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, makeState(tripId))],
    roamly_trip_generation_jobs: [
      jobRow("job-b", tripId, {
        status: "failed",
        retry_count: 3,
        lease_expires_at: null,
        last_error_code: "GENERATION_JOB_NOT_FOUND",
        last_error_message: "state missing"
      })
    ],
    roamly_communication_ledger: []
  });
  eq(db.tables.roamly_trip_generation_jobs.length, 1, "B: exactly one job row before the sweep");
  const rec = recorder();
  const summary = await runRecovery(db, rec);
  eq(summary.reopened, 1, "B: summary.reopened === 1");
  eq(summary.driven, 1, "B: summary.driven === 1");
  eq(rec.calls.length, 1, "B: the injected drive was called exactly once (after the reopen)");
  eq(summary.candidates[0].class, "retry_exhausted", "B: candidate class is retry_exhausted");
  eq(summary.candidates[0].action, "reopen_and_drive", "B: candidate action is reopen_and_drive");
  const job = db.tables.roamly_trip_generation_jobs[0];
  eq(db.tables.roamly_trip_generation_jobs.length, 1, "B: exactly one job row throughout (reopen rewrites in place)");
  eq(job.status, "waiting", "B: the job row was reopened to status waiting");
  eq(job.retry_count, 0, "B: the reopened job row has retry_count 0");
  eq(job.locked_at, null, "B: the reopen cleared locked_at");
  eq(job.locked_by, null, "B: the reopen cleared locked_by");
  eq(job.lease_expires_at, null, "B: the reopen cleared lease_expires_at");
  eq(job.last_error_code, null, "B: the reopen cleared last_error_code");
  eq(job.last_error_message, null, "B: the reopen cleared last_error_message");
  const eventsB = recoveryEvents(db);
  eq(eventsB.length, 1, "B-events: exactly one generation_recovery event was persisted for the reopen+drive");
  eq(eventsB[0].metadata.tripId, tripId, "B-events: metadata.tripId is the stranded trip");
  eq(eventsB[0].metadata.jobId, "job-b", "B-events: metadata.jobId is the reopened job (the reopen erases the row's own error fields — this event is now the persisted trace)");
  eq(eventsB[0].metadata.recoveryClass, "retry_exhausted", "B-events: metadata.recoveryClass is retry_exhausted");
  eq(eventsB[0].metadata.action, "reopen_and_drive", "B-events: metadata.action is reopen_and_drive");
  eq(eventsB[0].metadata.outcome, "driven", "B-events: metadata.outcome is driven");
  eq(eventsB[0].metadata.reopened, true, "B-events: metadata.reopened records that the reopen happened in this action");
  eq(eventsB[0].metadata.stalenessSeconds, 600, "B-events: metadata.stalenessSeconds is the observed 600 s without progress");
}

/* ------------------------------------------------------------------ */
/* Class C — no_active_job (legacy-set trip)                          */
/* ------------------------------------------------------------------ */

console.log("Class C — legacy-set trip, stranded state, no active job");

{
  const tripId = "trip-stranded-c";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, makeState(tripId))],
    roamly_trip_generation_jobs: [],
    roamly_communication_ledger: []
  });
  const rec = recorder();
  const summary = await runRecovery(db, rec);
  eq(rec.calls.length, 1, "C: the injected drive was called exactly once");
  eq(summary.driven, 1, "C: summary.driven === 1");
  eq(summary.reopened, 0, "C: no reopen (there is no job to reopen — ensureTripJob creates it in the drive)");
  eq(summary.candidates[0].class, "no_active_job", "C: candidate class is no_active_job");
  eq(summary.candidates[0].jobId, null, "C: candidate jobId is null");
  const eventsC = recoveryEvents(db);
  eq(eventsC.length, 1, "C-events: exactly one generation_recovery event was persisted");
  eq(eventsC[0].metadata.recoveryClass, "no_active_job", "C-events: metadata.recoveryClass is no_active_job");
  eq(eventsC[0].metadata.jobId, null, "C-events: metadata.jobId is null (no job existed when the action was taken)");
  eq(eventsC[0].metadata.outcome, "driven", "C-events: metadata.outcome is driven");
}

/* ------------------------------------------------------------------ */
/* SKIPS — drive never called, nothing mutated                        */
/* ------------------------------------------------------------------ */

console.log("Skips — no drive, no mutation");

async function expectSkip(label, db, check) {
  const before = JSON.stringify(db.tables);
  const rec = recorder();
  const summary = await runRecovery(db, rec);
  eq(rec.calls.length, 0, `${label}: drive never called`);
  eq(summary.driven, 0, `${label}: summary.driven === 0`);
  eq(summary.reopened, 0, `${label}: summary.reopened === 0`);
  eq(JSON.stringify(db.tables), before, `${label}: nothing was mutated`);
  if (check) check(summary);
}

{
  const tripId = "trip-skip-complete";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, makeState(tripId, { status: "complete", currentStage: "complete", completedAt: STALE }))],
    roamly_trip_generation_jobs: [jobRow("job-s1", tripId)],
    roamly_communication_ledger: []
  });
  await expectSkip("skip complete state (never resurrect)", db);
}
{
  const tripId = "trip-skip-terminal-failed";
  const db = new FakeDb({
    roamly_trips: [
      tripRow(tripId, makeState(tripId, {
        status: "failed", currentStage: "failed", outline: null,
        lastErrorCode: "OPENAI_API_KEY_MISSING", lastError: "no key"
      }), { status: "draft", itinerary_status: "generating" })
    ],
    roamly_trip_generation_jobs: [jobRow("job-s2", tripId, { status: "failed", retry_count: 3, lease_expires_at: null })],
    roamly_communication_ledger: []
  });
  await expectSkip("skip failed-terminal non-resumable state", db);
}
{
  const tripId = "trip-skip-live-staged-lease";
  const db = new FakeDb({
    roamly_trips: [
      tripRow(tripId, makeState(tripId, {
        worker: { leaseId: "req-live-driver", leaseExpiresAt: FUTURE }
      }))
    ],
    roamly_trip_generation_jobs: [jobRow("job-s3", tripId)],
    roamly_communication_ledger: []
  });
  await expectSkip("skip live staged lease", db, (summary) => {
    ok(summary.skippedLive >= 1, "skip live staged lease: skippedLive >= 1");
  });
}
{
  const tripId = "trip-skip-live-queue-lease";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, makeState(tripId))],
    roamly_trip_generation_jobs: [jobRow("job-s4", tripId, { lease_expires_at: FUTURE })],
    roamly_communication_ledger: []
  });
  await expectSkip("skip live queue lease on a running job", db, (summary) => {
    ok(summary.skippedLive >= 1, "skip live queue lease: skippedLive >= 1");
  });
}
{
  const tripId = "trip-skip-fresh";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, makeState(tripId, { updatedAt: FRESH }), { updated_at: FRESH })],
    roamly_trip_generation_jobs: [jobRow("job-s5", tripId)],
    roamly_communication_ledger: []
  });
  await expectSkip("skip fresh progress (< 285 s)", db);
}
{
  const tripId = "trip-skip-terminal-trip";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, makeState(tripId), { status: "completed", itinerary_status: "generated" })],
    roamly_trip_generation_jobs: [jobRow("job-s6", tripId, { status: "failed", retry_count: 3, lease_expires_at: null })],
    roamly_communication_ledger: []
  });
  await expectSkip("skip terminal trip with an exhausted job (no reopen)", db);
}

/* ------------------------------------------------------------------ */
/* GATE PARITY — generationSweeperHasWork directly                    */
/* ------------------------------------------------------------------ */

console.log("Gate parity — generationWorkGate over the failed-job shapes (M4)");

async function gateHasWork(jobs) {
  const db = new FakeDb({
    roamly_trip_generation_jobs: jobs,
    roamly_trips: [],
    roamly_communication_ledger: []
  });
  return generationSweeperHasWork(db, NOW);
}

eq(
  await gateHasWork([{ id: "g1", status: "failed", next_attempt_at: PAST, retry_count: 1, completed_at: null }]),
  true,
  "gate: due failed job with retry_count < 3 -> work"
);
eq(
  await gateHasWork([{ id: "g2", status: "failed", next_attempt_at: FUTURE, retry_count: 3, completed_at: null }]),
  true,
  "gate: failed retry_count >= 3 with completed_at null -> work (recovery reopen class, even before its due time)"
);
eq(
  await gateHasWork([{ id: "g3", status: "failed", next_attempt_at: PAST, retry_count: 3, completed_at: PAST }]),
  false,
  "gate: failed retry_count >= 3 with completed_at set -> no work"
);
eq(
  await gateHasWork([{ id: "g4", status: "failed", next_attempt_at: FUTURE, retry_count: 1, completed_at: null }]),
  false,
  "gate: failed job not yet due -> no work"
);
eq(await gateHasWork([]), false, "gate: empty fleet -> no work");

/* ------------------------------------------------------------------ */
/* FIX #1 INTERLEAVE — create between kill and resume                 */
/* ------------------------------------------------------------------ */

console.log("Fix #1 interleave — createOrResumeGenerationJob between kill and resume");
console.log("  ROUTE TAKEN: the wiring-fixes fake lives inside its own top-level suite and cannot be");
console.log("  imported; the interleave runs here against the diet FakeDb extended with the");
console.log("  migration's step-1 active-wins RPC semantics (the killed trip HAS an active job,");
console.log("  so step 1 is the only step reached). Serialized-execution caveat applies.");

{
  const tripId = "33333333-3333-4333-8333-333333333333";
  const jobId = "job-interleave";
  class InterleaveDb extends FakeDb {
    async rpc(name, args) {
      if (name !== "roamly_get_or_create_generation_job") {
        return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` } };
      }
      // Migration step 1: the ACTIVE job for the trip wins, whatever
      // its key, and returns resumed:true. (Steps 2-4 are the
      // wiring-fixes suite's territory; this trip never reaches them.)
      const active = (this.tables.roamly_trip_generation_jobs || []).find(
        (j) => j.trip_id === args.p_trip_id && ["queued", "running", "waiting"].includes(j.status)
      );
      if (active) return { data: [{ ...clone(active), resumed: true }], error: null };
      return { data: null, error: { code: "P0001", message: "no active job (interleave harness reaches step 1 only)" } };
    }
  }
  const db = new InterleaveDb({
    roamly_trips: [tripRow(tripId, makeState(tripId))],
    roamly_trip_generation_jobs: [
      jobRow(jobId, tripId, {
        generation_version: "zero-engine-v1",
        idempotency_key: `${tripId}:zero-engine-v1`,
        current_stage: "outline",
        priority: 10,
        user_plan: "free",
        paid_priority: false
      })
    ],
    roamly_trip_generation_layers: [],
    roamly_communication_ledger: []
  });
  // The kill has already happened (the state above is the stranded
  // Class-A shape). A create lands BETWEEN the kill and the resume:
  const created = await createOrResumeGenerationJob({
    supabase: db,
    tripId,
    userId: USER,
    payload: null,
    priority: 10,
    reason: "interleave_probe"
  });
  eq(created.ok, true, "interleave: createOrResumeGenerationJob between kill and resume succeeds");
  eq(created.job.id, jobId, "interleave: the create returns the SAME job id as the killed trip's job");
  eq(created.resumed, true, "interleave: the existing job is reported resumed, not created");
  eq(db.tables.roamly_trip_generation_jobs.length, 1, "interleave: rows(roamly_trip_generation_jobs).length === 1 after the interleaved create");
  // ...and the resume still drives that same single job's trip.
  const rec = recorder();
  const summary = await runRecovery(db, rec);
  eq(rec.calls.length, 1, "interleave: the recovery resume still drives the trip after the interleaved create");
  eq(summary.candidates[0].jobId, jobId, "interleave: the recovery candidate is the same single job");
  eq(db.tables.roamly_trip_generation_jobs.length, 1, "interleave: exactly one job row after the resume as well");
}

/* ------------------------------------------------------------------ */
/* M5 — secret-absent wake drop backstop (GAP-CLOSURE 2026-11-02)     */
/* ------------------------------------------------------------------ */
// Shape: a successor-style trip whose staged state WAS persisted
// (the M6a start ran) but whose after() wake was silently dropped
// because neither generation cron secret was set — so no queue row
// was ever created and no driver ever ran. This is class C's shape,
// but the earlier class-C case above proves it only with an injected
// recording drive that creates nothing. This case closes the loop
// the task names: the sweep's drive is the REAL ensureTripJob (the
// targeted worker path processGenerationQueue uses), run against a
// FakeDb whose get-or-create RPC implements the migration's steps
// 1–3 (active wins / same-key returns / fresh insert), so the proof
// is that the sweep adopts the trip AND exactly one job is created.

console.log("M5 — wake dropped (secret absent): state persisted, no queue row, sweep drives via ensureTripJob");

{
  const tripId = "44444444-4444-4444-8444-444444444444";
  class M5Db extends FakeDb {
    async rpc(name, args) {
      if (name !== "roamly_get_or_create_generation_job") {
        return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` } };
      }
      const jobs = (this.tables.roamly_trip_generation_jobs = this.tables.roamly_trip_generation_jobs || []);
      const version = args.p_generation_version || "roamly-brain-v1";
      const key = `${args.p_trip_id}:${version}`;
      // Migration step 1: an active job for the trip wins.
      const active = jobs.find((j) => j.trip_id === args.p_trip_id && ["queued", "running", "waiting"].includes(j.status));
      if (active) return { data: [{ ...clone(active), resumed: true }], error: null };
      // Migration step 2: a same-key job is returned untouched.
      const keyed = jobs.find((j) => j.user_id === args.p_user_id && j.idempotency_key === key);
      if (keyed) return { data: [{ ...clone(keyed), resumed: true }], error: null };
      // Migration step 3: fresh insert, status queued, resumed false.
      const row = {
        id: `job-m5-${jobs.length + 1}`,
        trip_id: args.p_trip_id,
        user_id: args.p_user_id,
        status: "queued",
        priority: args.p_priority || 0,
        current_stage: args.p_current_stage || null,
        generation_version: version,
        model_version: args.p_model_version || null,
        retry_count: 0,
        next_attempt_at: iso(NOW_MS),
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        idempotency_key: key,
        last_error_code: null,
        last_error_message: null,
        created_at: iso(NOW_MS),
        started_at: null,
        completed_at: null,
        updated_at: iso(NOW_MS),
        user_plan: args.p_user_plan || "free",
        paid_priority: args.p_paid_priority === true,
        queue_priority_reason: args.p_queue_priority_reason || null,
        duplicate_request_key: args.p_duplicate_request_key || null
      };
      jobs.push(row);
      return { data: [{ ...clone(row), resumed: false }], error: null };
    }
  }
  const db = new M5Db({
    roamly_trips: [tripRow(tripId, makeState(tripId))],
    roamly_trip_generation_jobs: [],
    roamly_trip_generation_layers: [],
    roamly_communication_ledger: []
  });
  eq(db.tables.roamly_trip_generation_jobs.length, 0, "M5 setup: no queue row exists before the sweep (the wake was dropped)");
  const driveCalls = [];
  const m5Drive = async (driveTripId, driveUserId) => {
    driveCalls.push({ tripId: driveTripId, userId: driveUserId });
    return ensureTripJob({ admin: db, tripId: driveTripId, userId: driveUserId });
  };
  const summary = await runStrandedGenerationRecovery(db, { now: NOW, drive: m5Drive });
  eq(summary.candidates.length, 1, "M5: exactly one recovery candidate was acted on");
  eq(summary.candidates[0].class, "no_active_job", "M5: candidate class is no_active_job");
  eq(summary.driven, 1, "M5: the sweep drove the successor-style trip exactly once");
  const driveResult = summary.candidates[0].result;
  ok(driveResult && driveResult.ok === true && driveResult.jobReady === true, "M5: the drive went through ensureTripJob and reported jobReady");
  eq(db.tables.roamly_trip_generation_jobs.length, 1, "M5: exactly one job created by ensureTripJob");
  eq(db.tables.roamly_trip_generation_jobs[0].trip_id, tripId, "M5: the created job belongs to the stranded successor trip");
  eq(db.tables.roamly_trip_generation_jobs[0].status, "queued", "M5: the created job is queued");
  // A second sweep finds the active job and does not drive again.
  const summary2 = await runStrandedGenerationRecovery(db, { now: NOW, drive: m5Drive });
  eq(driveCalls.length, 1, "M5: a second sweep does not drive again once the job exists");
  eq(summary2.driven, 0, "M5: second sweep summary.driven === 0");
  eq(db.tables.roamly_trip_generation_jobs.length, 1, "M5: exactly one job row after the second sweep as well");
}

/* ------------------------------------------------------------------ */
/* RECOVERY EVENTS — kill shapes, failure outcomes, fail-soft         */
/* (RECOVERY-EVENTS ADDENDUM 2026-11-03)                               */
/* ------------------------------------------------------------------ */

console.log("Recovery events — kill-at-outline persists its action");

{
  const tripId = "trip-stranded-outline";
  const db = new FakeDb({
    roamly_trips: [
      tripRow(tripId, makeState(tripId, { status: "generating_outline", currentStage: "generating_outline", completedDayCount: 0 }))
    ],
    roamly_trip_generation_jobs: [jobRow("job-outline", tripId)],
    roamly_communication_ledger: []
  });
  const rec = recorder();
  const summary = await runRecovery(db, rec);
  eq(summary.driven, 1, "outline: a generation killed at the outline stage is driven");
  eq(summary.candidates[0].class, "dead_driver", "outline: candidate class is dead_driver");
  const events = recoveryEvents(db);
  eq(events.length, 1, "outline-events: exactly one generation_recovery event was persisted");
  eq(events[0].metadata.tripId, tripId, "outline-events: metadata.tripId is the outline-stranded trip");
  eq(events[0].metadata.jobId, "job-outline", "outline-events: metadata.jobId is the dead-driver job");
  eq(events[0].metadata.recoveryClass, "dead_driver", "outline-events: metadata.recoveryClass is dead_driver");
  eq(events[0].metadata.action, "drive", "outline-events: metadata.action is drive");
  eq(events[0].metadata.outcome, "driven", "outline-events: metadata.outcome is driven");
  eq(events[0].metadata.stalenessSeconds, 600, "outline-events: metadata.stalenessSeconds is the observed 600 s");
}

console.log("Recovery events — a failed drive persists outcome drive_failed, and the sweep still returns");

{
  const tripId = "trip-stranded-drivefail";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, makeState(tripId))],
    roamly_trip_generation_jobs: [jobRow("job-df", tripId)],
    roamly_communication_ledger: []
  });
  const failingDrive = async () => {
    throw new Error("worker exploded mid-drive");
  };
  const summary = await runStrandedGenerationRecovery(db, { now: NOW, drive: failingDrive });
  eq(summary.driven, 0, "drivefail: summary.driven === 0");
  eq(summary.candidates[0].result, "drive_failed", "drivefail: candidate result is drive_failed");
  const events = recoveryEvents(db);
  eq(events.length, 1, "drivefail-events: the failed action still persisted exactly one event");
  eq(events[0].metadata.outcome, "drive_failed", "drivefail-events: metadata.outcome is drive_failed");
  eq(events[0].metadata.recoveryClass, "dead_driver", "drivefail-events: metadata.recoveryClass is dead_driver");
}

console.log("Recovery events — a missed reopen persists outcome reopen_failed and does not drive");

{
  const tripId = "trip-stranded-reopenfail";
  // The sweep's guarded reopen can miss two ways: the update errors
  // (result "reopen_failed") or it matches zero rows against the
  // live table (result "reopen_race_lost"). Both take the SAME
  // branch and the SAME emission call — only the outcome string
  // differs. The race_lost shape needs PostgREST's
  // update(...).select() row return, which the diet FakeDb does not
  // model (its update executes return data:null), so this case
  // forces the error shape and pins the branch + event; the
  // race_lost string rides the identical code path.
  class ReopenFailQuery extends FakeQuery {
    execute() {
      if (this.table === "roamly_trip_generation_jobs" && this.writeKind === "update") {
        return { data: null, error: { code: "XX000", message: "reopen update failed (harness-forced)" }, count: null };
      }
      return super.execute();
    }
  }
  class ReopenFailDb extends FakeDb {
    from(table) {
      return new ReopenFailQuery(this, table);
    }
  }
  const db = new ReopenFailDb({
    roamly_trips: [tripRow(tripId, makeState(tripId))],
    roamly_trip_generation_jobs: [
      jobRow("job-rf", tripId, { status: "failed", retry_count: 3, lease_expires_at: null })
    ],
    roamly_communication_ledger: []
  });
  const rec = recorder();
  const summary = await runRecovery(db, rec);
  eq(rec.calls.length, 0, "reopenfail: the drive never runs when the reopen misses");
  eq(summary.reopened, 0, "reopenfail: summary.reopened === 0");
  eq(summary.candidates[0].result, "reopen_failed", "reopenfail: candidate result is reopen_failed");
  const events = recoveryEvents(db);
  eq(events.length, 1, "reopenfail-events: exactly one generation_recovery event was persisted for the missed reopen");
  eq(events[0].metadata.action, "reopen_and_drive", "reopenfail-events: metadata.action is reopen_and_drive");
  eq(events[0].metadata.outcome, "reopen_failed", "reopenfail-events: metadata.outcome is reopen_failed");
  eq(events[0].metadata.recoveryClass, "retry_exhausted", "reopenfail-events: metadata.recoveryClass is retry_exhausted");
  eq(events[0].metadata.jobId, "job-rf", "reopenfail-events: metadata.jobId is the unreopened job");
}

console.log("Recovery events — fail-soft: an event-store failure never blocks or alters the recovery");

{
  class ThrowingEventsDb extends FakeDb {
    from(table) {
      if (table !== "roamly_app_events") return super.from(table);
      return {
        insert: () => {
          throw new Error("events store unavailable");
        }
      };
    }
  }
  class ErrorEventsDb extends FakeDb {
    from(table) {
      if (table !== "roamly_app_events") return super.from(table);
      return { insert: async () => ({ data: null, error: { message: "insert denied" } }) };
    }
  }
  for (const [label, DbClass] of [["throwing insert", ThrowingEventsDb], ["error-returning insert", ErrorEventsDb]]) {
    const tripId = `trip-failsoft-${label === "throwing insert" ? "throw" : "error"}`;
    const db = new DbClass({
      roamly_trips: [tripRow(tripId, makeState(tripId))],
      roamly_trip_generation_jobs: [jobRow(`job-fs-${label === "throwing insert" ? "throw" : "error"}`, tripId)],
      roamly_communication_ledger: []
    });
    const rec = recorder();
    const summary = await runRecovery(db, rec);
    eq(rec.calls.length, 1, `fail-soft (${label}): the drive still ran exactly once`);
    eq(summary.driven, 1, `fail-soft (${label}): summary.driven === 1 — the recovery outcome is unchanged`);
    eq(summary.candidates.length, 1, `fail-soft (${label}): the candidate was still recorded in the summary`);
    eq(recoveryEvents(db).length, 0, `fail-soft (${label}): no event row landed (the store failure was swallowed, not hidden)`);
  }
}

console.log("Recovery events — skips persist nothing (events are per candidate ACTION, not per scan)");

{
  const tripId = "trip-skip-events";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, makeState(tripId, { status: "complete", currentStage: "complete", completedAt: STALE }))],
    roamly_trip_generation_jobs: [jobRow("job-se", tripId)],
    roamly_communication_ledger: []
  });
  const rec = recorder();
  await runRecovery(db, rec);
  eq(rec.calls.length, 0, "skip-events: drive never called for a completed generation");
  eq(recoveryEvents(db).length, 0, "skip-events: no generation_recovery event for a skip");
}

console.log(`\nStranded-recovery checks: ${count} assertions passed.`);
