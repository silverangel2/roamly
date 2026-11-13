// RETRY-CLAIM DEFECT — SAME-TRIP FAILED+WAITING PAIR (2026-11-12, LOCAL ONLY).
//
// PRODUCTION-OBSERVED: Rome proof trip a41343d5 + KL daily-test trip
// 464e9a94 each carry a pair for one trip — a FAILED attempt-1 row
// (retry_count 1, next_attempt_at in the past, claimable via the
// claim RPC's failed branch) AND its WAITING retry row (retry_count 0,
// due, claimable via the waiting branch). Every 5-min cron wake since
// the first pair appeared (2026-11-11 16:10Z) records heartbeat
// ok:false and claims NOTHING: the claim RPC's single UPDATE sets
// both rows to 'running', which violates the production unique partial
// index roamly_trip_generation_jobs_active_trip_idx (UNIQUE (trip_id)
// WHERE status IN ('queued','running','waiting'), 20260715) —
// Postgres aborts the whole statement with 23505, so the wake's
// summary carries the error and zero jobs are claimed. The detector
// then re-arms the waiting row (next_attempt_at = now) and the next
// wake fails the same way: re-arm without claim, forever. Neither
// retry was EVER claimed (started_at null; the claim sets it and
// nothing nulls it). The by-trip claim has the same hazard: its sort
// picks the failed row (priority 200) over its waiting retry
// (priority 1), so a by-trip claim on a paired trip dies the same way.
//
// THIS SUITE ASSERTS THE FIXED BEHAVIOUR, so it is RED on the
// current tree by design: the migration that guards the claim RPCs'
// failed branch (skip a failed job while a live job exists for its
// trip) turns it green. Do NOT weaken these assertions to make it
// pass — a green suite that asserts the bug is worse than a red one.
//   P1: the batch claim on a pair returns the waiting retry only;
//       the superseded failed row is not re-claimed.
//   P2 (control): a lone waiting retry IS claimed — the harness works
//       and the pair, not the claim path, is the cause.
//   P3: the untargeted wake pass claims the retry (summary ok,
//       started_at set, released back to waiting after the pack-wait
//       yield) and leaves the failed row untouched.
//   P4: the stuck-generation detector may re-arm the retry, but the
//       re-arm cannot starve the claim — the next wake still claims it.
//
// Fixture = the Rome production rows, re-based onto the wall clock.
// The retry's generation_version is re-based to zero-engine-v1 so its
// post-claim advance yields deterministically on the pack-wait path
// (kf2 W1 shape); the claim defect is version-independent, and
// production's retry is brain-v1. The failed row keeps brain-v1.
//
// Evidence tier: SIMULATED (real code, emulated PostgREST/RPC layer
// — the GapDb claim emulations enforce the active-trip index, see
// roamly-gap-queue-fake.mjs).
//
// Run: npm run test:retry-claim-pair (gap register).

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
const { processGenerationQueue } = await import("@/lib/roamly/generationWorker.ts");
const { claimGenerationJobs } = await import("@/lib/roamly/generationQueue.ts");
const { runStuckGenerationDetector } = await import("@/lib/roamly/silentFailureDetectors.ts");

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
const TRIP = "a41343d5-2760-4867-9f26-4dea64c1c275"; // the Rome proof trip
const FAILED = "27468688-5815-4299-a6e7-81dce34bd13a"; // attempt-1, failed
const RETRY = "74716dfb-169d-477f-903f-d818777dbcca"; // the waiting retry
const DST = "dst-rome-2026-11-12"; // Rome destination id (fixture-local)

const CLAIM_CONFIG = { workerId: "roamly-worker:retry-claim-pair", batchSize: 5, leaseSeconds: 240, maxRetries: 3 };

function engineState(tripId, t0) {
  const days = {};
  const batches = {};
  for (let n = 1; n <= 5; n += 1) {
    days[String(n)] = { dayNumber: n, date: "", status: "queued", attemptCount: 0, lastError: null, updatedAt: t0 };
    batches[`batch-${n}`] = { id: `batch-${n}`, dayNumbers: [n], status: "queued", attemptCount: 0, lastError: null, updatedAt: t0 };
  }
  return {
    version: 2,
    tripId,
    status: "queued",
    currentStage: "generating_outline",
    totalDayCount: 5,
    completedDayCount: 0,
    outline: null,
    days,
    batches,
    generatedDays: {},
    payload: {
      destination: "Rome",
      destinationCity: "Rome",
      destinationCountry: "Italy",
      daysCount: 5,
      startDate: "2026-11-20",
      endDate: "2026-11-24"
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
    waitingOnPack: { destinationId: DST, since: t0, waits: 71 }
  };
}

function runRecord(t0) {
  return {
    generationVersion: "zero-engine-v1",
    provider: "zero-engine",
    destinationId: DST,
    destinationName: "Rome",
    packVersionId: null,
    anchor: null,
    packWaitCount: 71,
    enrichment: null,
    startedAt: t0,
    completedAt: null
  };
}

function failedRow(t0, attemptStartedAt) {
  return {
    id: FAILED,
    trip_id: TRIP,
    user_id: USER,
    status: "failed",
    priority: 200,
    current_stage: "staged_finalization",
    generation_version: "roamly-brain-v1",
    model_version: null,
    retry_count: 1,
    next_attempt_at: t0, // due (the staged-finalization path schedules with maxRetries 0 -> now())
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    idempotency_key: `${TRIP}:roamly-brain-v1`,
    last_error_code: "FINAL_VALIDATION_FAILED",
    last_error_message: "final validation failed",
    created_at: attemptStartedAt,
    started_at: attemptStartedAt, // claimed once, by the in-request drive
    completed_at: null,
    updated_at: t0,
    user_plan: "free",
    paid_priority: true,
    queue_priority_reason: "worker_trip_target",
    duplicate_request_key: null
  };
}

function retryRow(t0, { nextAttemptAt = t0, generationVersion = "zero-engine-v1" } = {}) {
  return {
    id: RETRY,
    trip_id: TRIP,
    user_id: USER,
    status: "waiting",
    priority: 1,
    current_stage: "staged_outline",
    generation_version: generationVersion,
    model_version: null,
    retry_count: 0,
    next_attempt_at: nextAttemptAt,
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    idempotency_key: `${TRIP}:${generationVersion}`,
    last_error_code: null,
    last_error_message: null,
    created_at: t0,
    started_at: null, // NEVER claimed in production — the defect's fingerprint
    completed_at: null,
    updated_at: t0,
    user_plan: "free",
    paid_priority: false,
    queue_priority_reason: "worker_trip_target",
    duplicate_request_key: null
  };
}

function seedPair({ withGenerationState = false, retryNextAttemptAt = null } = {}) {
  const t0 = isoAgo(60_000);
  const attemptStartedAt = isoAgo(3_600_000);
  const tables = emptyGapTables();
  tables.roamly_trips = [
    {
      id: TRIP,
      user_id: USER,
      metadata: withGenerationState
        ? { generation: engineState(TRIP, t0), zeroEngine: runRecord(t0) }
        : {},
      status: "draft",
      itinerary_status: "draft",
      itinerary_locked: false,
      itinerary_generated_at: null,
      updated_at: t0
    }
  ];
  tables.roamly_trip_generation_jobs = [
    failedRow(t0, attemptStartedAt),
    retryRow(t0, { nextAttemptAt: retryNextAttemptAt || t0 })
  ];
  tables.roamly_admin_settings = [
    {
      key: `pack_destination:v1:${DST}`,
      value: {
        destinationId: DST,
        displayName: "Rome",
        country: "Italy",
        centre: { lat: 41.9028, lon: 12.4964 },
        timeZone: "Europe/Rome",
        bbox: { minLat: 41.8, minLon: 12.4, maxLat: 42.0, maxLon: 12.6 }
      }
    }
  ];
  // The pack build: claimed by another driver under a LIVE lease,
  // never finishing inside the window. No ready pack version exists.
  tables.roamly_destination_pack_builds = [
    {
      job_id: "build-rome-1",
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

const tripRow = () => db.tables.roamly_trips.find((t) => t.id === TRIP);
const failedJobRow = () => db.tables.roamly_trip_generation_jobs.find((j) => j.id === FAILED);
const retryJobRow = () => db.tables.roamly_trip_generation_jobs.find((j) => j.id === RETRY);

/* ---------------- P1: the batch claim on a pair ------------------ */
console.log("RETRY-CLAIM PAIR — P1: batch claim on the failed+waiting pair");
seedPair();
const p1 = await claimGenerationJobs({ supabase: db, config: CLAIM_CONFIG });
console.log(`  claim result: ok=${p1.ok} error=${p1.error || "(none)"} jobs=${p1.jobs.length}`);
ok(p1.ok, "P1: the batch claim succeeds on a same-trip pair");
eq(p1.jobs.length, 1, "P1: exactly one job is claimed");
eq(p1.jobs[0]?.id, RETRY, "P1: the claimed job is the waiting retry");
ok(p1.jobs.every((j) => j.id !== FAILED), "P1: the superseded failed row is not re-claimed");

/* ---------------- P2 (control): lone retry ----------------------- */
console.log("RETRY-CLAIM PAIR — P2 (control): lone waiting retry, no failed sibling");
seedPair();
db.tables.roamly_trip_generation_jobs = db.tables.roamly_trip_generation_jobs.filter((j) => j.id === RETRY);
const p2 = await claimGenerationJobs({ supabase: db, config: CLAIM_CONFIG });
console.log(`  claim result: ok=${p2.ok} error=${p2.error || "(none)"} jobs=${p2.jobs.length}`);
ok(p2.ok, "P2: the batch claim succeeds on a lone waiting retry");
eq(p2.jobs.length, 1, "P2: exactly one job is claimed");
eq(p2.jobs[0]?.id, RETRY, "P2: the claimed job is the retry");

/* ---------------- P3: the untargeted wake pass ------------------- */
console.log("RETRY-CLAIM PAIR — P3: untargeted wake pass on the pair");
seedPair({ withGenerationState: true });
const failedBefore = clone(failedJobRow());
eq(await generationSweeperHasWork(db), true, "P3: the work gate sees the due retry as work");
const p3 = await processGenerationQueue({
  requestId: `retry-claim-pair-${count}`,
  reason: "vercel_cron_wake",
  executionDeadlineMs: Date.now() + 270_000
});
console.log(`  wake summary: ok=${p3.ok} claimed=${p3.claimed} processed=${p3.processed} error=${p3.error || "(none)"}`);
ok(p3.ok, "P3: the wake summary is ok on a same-trip pair");
eq(p3.claimed, 1, "P3: exactly one job is claimed");
ok(retryJobRow().started_at != null, "P3: the retry was claimed (started_at set — never null again)");
eq(retryJobRow().status, "waiting", "P3: the retry is released back to waiting after the pack-wait yield");
eq(failedJobRow().status, "failed", "P3: the failed row stays failed");
eq(failedJobRow().retry_count, 1, "P3: the failed row's retry_count is untouched");
eq(failedJobRow().started_at, failedBefore.started_at, "P3: the failed row's started_at is untouched");
eq(failedJobRow().updated_at, failedBefore.updated_at, "P3: the failed row's updated_at is untouched");

/* ------- P4: detector re-arm must not starve the claim ----------- */
console.log("RETRY-CLAIM PAIR — P4: detector re-arms the retry, the next wake still claims it");
seedPair({ withGenerationState: true, retryNextAttemptAt: isoAgo(10 * 60_000) });
const detector = await runStuckGenerationDetector();
console.log(`  detector: ok=${detector.ok} requeued=${JSON.stringify(detector.requeued ?? detector)}`);
ok(new Date(retryJobRow().next_attempt_at).getTime() > Date.now() - 60_000, "P4: the detector re-armed the retry (next_attempt_at is now)");
eq(retryJobRow().locked_at, null, "P4: the re-armed retry carries no lock");
const p4 = await processGenerationQueue({
  requestId: `retry-claim-pair-detector-${count}`,
  reason: "vercel_cron_wake",
  executionDeadlineMs: Date.now() + 270_000
});
console.log(`  wake summary: ok=${p4.ok} claimed=${p4.claimed} error=${p4.error || "(none)"}`);
ok(p4.ok, "P4: the wake after the re-arm is ok");
eq(p4.claimed, 1, "P4: the re-armed retry is claimed, not re-armed past its due time");
ok(retryJobRow().started_at != null, "P4: the re-armed retry was claimed (started_at set)");

console.log(`\nRETRY-CLAIM PAIR: ${count} checks passed`);
