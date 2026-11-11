// STAGE 7 / KF-2 — WAKE-CHAIN REPRODUCTION + PIN (2026-11-11, LOCAL ONLY).
//
// The round-2 diagnosis acceptance probe (kf2-round2-diagnosis.md),
// run against TODAY'S sweep composition with the REAL modules in the
// cron route's own order:
//   work gate -> stranded recovery -> queue worker -> pack-wait
//   terminal transition
// over the GapDb queue fake (RPC emulations transcribed from the
// final migration versions), with the admin client redirected to the
// fake via the gap loader (globalThis.__roamlyFakeSupabase).
//
// Fixture = the Rocky Harbour record (2026-10-25, trip
// f2c82eb7-e931-414b-88dd-4b3ae8002ad0), re-based onto the wall clock:
// a zero-engine job `waiting`, next_attempt_at past, lease null,
// retry 0; the trip `generating`; the state at generating_outline
// with 71 pack waits recorded, packVersionId null; the destination
// registered; its pack build claimed by another driver under a live
// lease and never finishing (no ready version ever appears).
//
// Scenarios:
//   W1 (wake lands) — run record started 85 min ago (the round-2
//     re-read moment: 80 min of silence already elapsed, cap not yet
//     reached). ONE sweep pass must claim the job, advance the
//     outline once (packWaitCount 71 -> 72), and leave the job
//     `waiting` and immediately claimable — never silent, never
//     failed early.
//   W2 (cap fires) — the same fixture with the run started 2 h 05 min
//     ago. ONE sweep pass must end the wait LOUDLY: state failed
//     with ZERO_ENGINE_PACK_WAIT_TIMEOUT, job failed with the same
//     code on record, and a keeper-visible trace (failure email
//     captured by the stub, or a pack-wait-timeout incident row).
//   W3 (legacy shape) — the pre-F8 record shape (no waitingOnPack
//     stamp on the state; the wait lives only in the zeroEngine run
//     record), already past the cap. One pass must still fail it
//     loudly — the sweep-side transition reads the run record, not
//     the F8 stamp.
//   W0 (gate) — the work gate sees the W1 fixture as work (the GET
//     sweeper must not exit before any of the above can run).
//
// Evidence tier: SIMULATED (real code, emulated PostgREST/RPC layer).
//
// Run: npm run test:kf2-wake-chain (gap register).

import assert from "node:assert/strict";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}
delete process.env.OPENAI_API_KEY;
process.env.ROAMLY_ZERO_ENGINE_ENABLED = "1";
process.env.ROAMLY_PACK_STORE = "supabase";

const { GapDb, emptyGapTables } = await import("./roamly-gap-queue-fake.mjs");

let db;
globalThis.__roamlyFakeSupabase = null; // set per scenario before the pass
globalThis.__capturedGenerationEmails = [];

const { generationSweeperHasWork } = await import("@/lib/roamly/generationWorkGate.ts");
const { runStrandedGenerationRecovery } = await import("@/lib/roamly/generationRecovery.ts");
const { processGenerationQueue } = await import("@/lib/roamly/generationWorker.ts");
const { runPackWaitTerminalTransition } = await import("@/lib/roamly/packWaitTerminalTransition.ts");

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
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
const isoAhead = (ms) => new Date(Date.now() + ms).toISOString();

const USER = "2d199836-53a4-4210-b9f4-334d01efdfb2"; // the daily tester
const TRIP = "f2c82eb7-e931-414b-88dd-4b3ae8002ad0"; // the Rocky Harbour trip id
const JOB = "job-kf2-rocky";
const DST = "dst-e1047b8c5ac1cf13"; // the round-2 record's destination id

function engineState(tripId, t0, { withPackStamp = true } = {}) {
  const days = {};
  const batches = {};
  for (let n = 1; n <= 4; n += 1) {
    days[String(n)] = { dayNumber: n, date: "", status: "queued", attemptCount: 0, lastError: null, updatedAt: t0 };
    batches[`batch-${n}`] = { id: `batch-${n}`, dayNumbers: [n], status: "queued", attemptCount: 0, lastError: null, updatedAt: t0 };
  }
  return {
    version: 2,
    tripId,
    status: "queued",
    currentStage: "generating_outline",
    totalDayCount: 4,
    completedDayCount: 0,
    outline: null,
    days,
    batches,
    generatedDays: {},
    payload: {
      destination: "Rocky Harbour",
      destinationCity: "Rocky Harbour",
      destinationCountry: "Canada",
      daysCount: 4,
      startDate: "2026-10-28",
      endDate: "2026-10-31"
    },
    personalization: { enabled: false, accepted: {}, inferred: {}, aggregateGuidance: [] },
    stageRuns: [],
    aiCallCount: 0,
    provider: "zero-engine",
    model: null,
    outlineAttemptCount: 0,
    startedAt: t0,
    updatedAt: t0,
    completedAt: null,
    worker: null,
    ...(withPackStamp ? { waitingOnPack: { destinationId: DST, since: t0, waits: 71 } } : {})
  };
}

function runRecord(t0) {
  return {
    generationVersion: "zero-engine-v1",
    provider: "zero-engine",
    destinationId: DST,
    destinationName: "Rocky Harbour",
    packVersionId: null,
    anchor: null,
    packWaitCount: 71,
    enrichment: null,
    startedAt: t0,
    completedAt: null
  };
}

function seedFixture({ startedAgoMs, withPackStamp = true }) {
  const t0 = isoAgo(startedAgoMs);
  const tables = emptyGapTables();
  tables.roamly_trips = [
    {
      id: TRIP,
      user_id: USER,
      metadata: { generation: engineState(TRIP, t0, { withPackStamp }), zeroEngine: runRecord(t0) },
      status: "generating",
      itinerary_status: "generating",
      itinerary_generated_at: null,
      updated_at: t0
    }
  ];
  tables.roamly_trip_generation_jobs = [
    {
      id: JOB,
      trip_id: TRIP,
      user_id: USER,
      status: "waiting",
      priority: 200,
      current_stage: "staged_outline",
      generation_version: "zero-engine-v1",
      model_version: null,
      retry_count: 0,
      next_attempt_at: t0,
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      idempotency_key: `${TRIP}:zero-engine-v1`,
      last_error_code: null,
      last_error_message: null,
      created_at: t0,
      started_at: t0,
      completed_at: null,
      updated_at: t0,
      user_plan: "free",
      paid_priority: false,
      queue_priority_reason: null,
      duplicate_request_key: null
    }
  ];
  // The destination registry row (durable form: settings KV).
  tables.roamly_admin_settings = [
    {
      key: `pack_destination:v1:${DST}`,
      value: {
        destinationId: DST,
        displayName: "Rocky Harbour",
        country: "Canada",
        centre: { lat: 49.6833, lon: -57.9167 },
        timeZone: "America/St_Johns",
        bbox: { minLat: 49.6, minLon: -58.05, maxLat: 49.77, maxLon: -57.78 }
      }
    }
  ];
  // The pack build: claimed by another driver under a LIVE lease,
  // never finishing inside the window. No ready pack version exists.
  tables.roamly_destination_pack_builds = [
    {
      job_id: "build-rocky-1",
      destination_id: DST,
      reason: "cold-read",
      status: "building",
      requested_at: t0,
      started_at: t0,
      finished_at: null,
      lease_id: "lease-other-driver",
      lease_worker_id: "other-worker",
      lease_expires_at: isoAhead(3_600_000),
      lease_epoch: 1,
      coalesced_requests: 3,
      result_pack_id: null,
      error: null,
      updated_at: t0
    }
  ];
  tables.roamly_operational_incidents = [];
  tables.roamly_app_events = [];
  db = new GapDb(tables);
  globalThis.__roamlyFakeSupabase = db;
  globalThis.__capturedGenerationEmails = [];
  return db;
}

/** One cron GET pass, in the route's own order (heartbeat aside). */
async function sweepPass() {
  const hasWork = await generationSweeperHasWork(db);
  const strandedRecovery = await runStrandedGenerationRecovery(db);
  const summary = await processGenerationQueue({
    requestId: `kf2-wake-chain-${count}`,
    reason: "vercel_cron_wake",
    executionDeadlineMs: Date.now() + 270_000
  });
  const packWaitTerminal = await runPackWaitTerminalTransition({ supabase: db });
  return { hasWork, strandedRecovery, summary, packWaitTerminal };
}

const tripRow = () => db.tables.roamly_trips.find((t) => t.id === TRIP);
const jobRow = () => db.tables.roamly_trip_generation_jobs.find((j) => j.id === JOB);
const genState = () => tripRow().metadata.generation;
const runRec = () => tripRow().metadata.zeroEngine;

/* ---------------- W0 + W1: the wake lands ------------------------ */
console.log("KF-2 wake chain — W1: 85 minutes in, cap not reached");
seedFixture({ startedAgoMs: 85 * 60_000 });
eq(await generationSweeperHasWork(db), true, "W0: work gate sees the stranded pack-wait job as work");
const w1 = await sweepPass();
eq(w1.hasWork, true, "W1: gate passes inside the pass");
ok(
  w1.strandedRecovery.packWaits.some((w) => w.tripId === TRIP),
  "W1: recovery Phase 3 names the pack wait (visibility, no drive spent)"
);
ok(
  db.rpcCalls.some((c) => c.name === "roamly_claim_generation_jobs"),
  "W1: the sweep's claim RPC ran"
);
ok(jobRow().updated_at > isoAgo(80 * 60_000), "W1: the job was claimed (updated_at moved off the frozen value)");
eq(runRec().packWaitCount, 72, "W1: the outline advance ran exactly once (packWaitCount 71 -> 72)");
eq(genState().currentStage, "generating_outline", "W1: still honestly at the outline stage");
eq(genState().status, "queued", "W1: state is the named pack-wait (queued), not a failure");
eq(jobRow().status, "waiting", "W1: job released back to waiting");
ok(new Date(jobRow().next_attempt_at).getTime() <= Date.now(), "W1: job is immediately claimable for the next tick");
eq(jobRow().last_error_code, null, "W1: no error recorded — a wait is not an error");

/* ---------------- W2: the cap fires loudly ----------------------- */
console.log("KF-2 wake chain — W2: 2 h 05 min in, cap passed");
seedFixture({ startedAgoMs: 125 * 60_000 });
const w2 = await sweepPass();
eq(genState().status, "failed", "W2: the generation state failed — the wait ended");
eq(genState().lastErrorCode, "ZERO_ENGINE_PACK_WAIT_TIMEOUT", "W2: failure carries the pack-wait timeout code");
eq(jobRow().status, "failed", "W2: the job failed with it (not left waiting)");
eq(jobRow().last_error_code, "ZERO_ENGINE_PACK_WAIT_TIMEOUT", "W2: the job row names the reason");
ok(
  (globalThis.__capturedGenerationEmails || []).some((e) => e.kind === "failure" || e.tripId === TRIP) ||
    (db.tables.roamly_operational_incidents || []).length > 0,
  "W2: keeper-visible trace (failure email captured and/or incident recorded)"
);

/* ---------------- W3: the pre-F8 record shape -------------------- */
console.log("KF-2 wake chain — W3: legacy record shape, cap passed");
seedFixture({ startedAgoMs: 125 * 60_000, withPackStamp: false });
const w3 = await sweepPass();
eq(genState().status, "failed", "W3: legacy-shape wait also ends in a loud failure");
eq(
  genState().lastErrorCode || jobRow().last_error_code,
  "ZERO_ENGINE_PACK_WAIT_TIMEOUT",
  "W3: the timeout code is on record for the legacy shape too"
);
ok(jobRow().status !== "waiting" && jobRow().status !== "queued", "W3: the job is not left claimable-silent");

/* ---------------- W4: cap-past and NEVER claimable --------------- */
console.log("KF-2 wake chain — W4: cap passed, job not due (backoff) — transition alone must act");
seedFixture({ startedAgoMs: 125 * 60_000 });
// A retry backoff (or any future next_attempt_at) makes the job
// invisible to BOTH claim RPCs. This is the exact hole PR #79 left:
// wake-gated cap + no wake = nothing fires, ever.
db.tables.roamly_trip_generation_jobs[0].next_attempt_at = isoAhead(3_600_000);
const w4 = await sweepPass();
eq(w4.packWaitTerminal.transitioned, 1, "W4: the sweep-side terminal transition fired on the unclaimable job");
eq(genState().status, "failed", "W4: the generation state failed loudly");
eq(genState().lastErrorCode, "ZERO_ENGINE_PACK_WAIT_TIMEOUT", "W4: failure carries the pack-wait timeout code");
eq(jobRow().status, "failed", "W4: the job failed (not left waiting on a future attempt)");
eq(tripRow().status, "draft", "W4: the trip row stops saying generating (list surfaces agree)");
ok(
  db.rpcCalls.some(
    (c) => c.name === "roamly_record_operational_event" && c.args?.p_event_code === "generation_pack_wait_timeout"
  ),
  "W4: the transition called the operational-incident recorder with the pack-wait event (keeper-visible; the RPC itself is production-proven, Stage 3 census)"
);

console.log(`\nKF-2 WAKE-CHAIN: ${count} checks passed`);
