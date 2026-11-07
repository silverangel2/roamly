// Roamly SPEED FIX F8 checks (2026-11-07) — the recovery sweep's
// safety floor (CRAWL-INVESTIGATION-REPORT F8):
//
//   §1 ZOMBIE DEAD-LETTER: seven trips in the report's exact
//      shape (failed job, retry_count 3, stranded resumable
//      state, THREE completed reopen->fail cycles already in the
//      persisted trace) are dead-lettered on sight: named
//      generation_recovery_dead_letter events, zero drive slots
//      consumed — and a genuinely stranded eighth trip is still
//      driven in the SAME run under the default limit of 3.
//   §2 A second sweep over the same store skips the zombies via
//      the ledger (no new dead-letter events, no drives spent).
//   §3 UNDER THRESHOLD: a trip with only TWO prior reopen cycles
//      is reopened and driven exactly as before F8.
//   §4 PACK-WAIT VISIBILITY: a trip in the named waitingOnPack
//      state (waiting job, wait cycles still refreshing its
//      updatedAt) is surfaced in summary.packWaits with a
//      throttled pack_wait_alarm event — and is NEVER driven or
//      reopened by the sweep. A pack-waiting state behind a
//      running job with an expired lease is likewise skipped by
//      phase 1 (the wait is a named owner, not a dead driver).
//   §5 ALARM THROTTLE: a trip alarmed 10 minutes ago is not
//      re-alarmed; a trip alarmed 40 minutes ago is.
//
// Harness: the REAL runStrandedGenerationRecovery over the diet
// FakeDb with an injected recording drive — the stranded suite's
// own pattern (scripts/roamly-stranded-recovery-checks.mjs).
//
// Run: npm run test:speed-f8

import assert from "node:assert/strict";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}
delete process.env.OPENAI_API_KEY;

const { runStrandedGenerationRecovery, DEAD_LETTER_MAX_REOPENS, PACK_WAIT_ALARM_MS } = await import(
  "@/lib/roamly/generationRecovery.ts"
);
const { FakeDb } = await import("./roamly-egress-diet-fake.mjs");

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

const NOW = new Date("2026-11-07T15:00:00.000Z");
const NOW_MS = NOW.getTime();
const iso = (ms) => new Date(ms).toISOString();
const STALE = iso(NOW_MS - 10 * 60_000);
const PAST = iso(NOW_MS - 60_000);
const USER = "22222222-2222-4222-8222-222222222222";

eq(DEAD_LETTER_MAX_REOPENS, 3, "setup: the dead-letter threshold is 3 completed reopen cycles");
eq(PACK_WAIT_ALARM_MS, 600_000, "setup: the pack-wait alarm threshold is 10 minutes");

function makeState(tripId, overrides = {}) {
  return {
    version: 2,
    tripId,
    status: "generating_day",
    currentStage: "generating_day",
    totalDayCount: 3,
    completedDayCount: 1,
    outline: {
      tripSummary: "F8 harness trip.",
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
    batches: {},
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
    status: "failed",
    retry_count: 3,
    lease_expires_at: null,
    completed_at: null,
    next_attempt_at: PAST,
    locked_at: PAST,
    locked_by: "dead-worker",
    last_error_code: "GENERATION_JOB_NOT_FOUND",
    last_error_message: "state missing",
    updated_at: STALE,
    ...overrides
  };
}

function reopenEvent(tripId, jobId, minutesAgo) {
  return {
    user_id: USER,
    event_type: "generation_recovery",
    metadata: {
      tripId,
      jobId,
      recoveryClass: "retry_exhausted",
      action: "reopen_and_drive",
      outcome: "driven",
      reopened: true,
      stalenessSeconds: 600
    },
    created_at: iso(NOW_MS - minutesAgo * 60_000)
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

const deadLetterEvents = (db) => (db.tables.roamly_app_events || []).filter((r) => r.event_type === "generation_recovery_dead_letter");
const alarmEvents = (db) =>
  (db.tables.roamly_app_events || []).filter((r) => r.event_type === "generation_recovery" && r.metadata?.action === "pack_wait_alarm");

/* ---------------- §1+§2 — the seven zombies ---------------- */
{
  const trips = [];
  const jobs = [];
  const events = [];
  for (let i = 1; i <= 7; i += 1) {
    const tripId = `trip-zombie-${i}`;
    trips.push(tripRow(tripId, makeState(tripId)));
    jobs.push(jobRow(`job-zombie-${i}`, tripId));
    for (let c = 0; c < DEAD_LETTER_MAX_REOPENS; c += 1) {
      events.push(reopenEvent(tripId, `job-zombie-${i}`, 60 + c * 30));
    }
  }
  // The genuinely stranded eighth trip: class A shape, no history.
  trips.push(tripRow("trip-stranded-real", makeState("trip-stranded-real")));
  jobs.push(
    jobRow("job-real", "trip-stranded-real", {
      status: "running",
      retry_count: 0,
      lease_expires_at: PAST,
      last_error_code: null,
      last_error_message: null
    })
  );
  const db = new FakeDb({
    roamly_trips: trips,
    roamly_trip_generation_jobs: jobs,
    roamly_app_events: events,
    roamly_communication_ledger: []
  });
  const rec = recorder();
  const summary = await runStrandedGenerationRecovery(db, { now: NOW, drive: rec.drive, limit: 3 });
  eq(summary.deadLettered, 7, "§1 all seven zombie trips are dead-lettered on sight");
  eq(summary.zombies.length, 7, "§1 the summary names all seven zombies");
  ok(summary.zombies.every((z) => z.reopenCycles === DEAD_LETTER_MAX_REOPENS), "§1 each zombie carries its reopen-cycle count");
  eq(rec.calls.length, 1, "§1 exactly ONE drive happened — the genuinely stranded trip's");
  eq(rec.calls[0].tripId, "trip-stranded-real", "§1 the drive went to the real stranded trip, not a zombie");
  eq(summary.driven, 1, "§1 summary.driven === 1 despite 8 candidates and a limit of 3 (zombies consume no slots)");
  eq(summary.reopened, 0, "§1 no zombie was reopened again");
  const letters = deadLetterEvents(db);
  eq(letters.length, 7, "§1 seven generation_recovery_dead_letter events were persisted");
  ok(
    letters.every((r) => r.metadata.action === "dead_letter" && r.metadata.outcome === "zombie_dead_lettered"),
    "§1 the dead-letter events name the outcome (zombie_dead_lettered)"
  );
  ok(
    jobs.filter((j) => j.id.startsWith("job-zombie")).every((j) => j.status === "failed" && j.retry_count === 3),
    "§1 the zombie job rows are untouched (dead-lettering changes the sweep's behaviour, not the data)"
  );

  // §2 — second sweep: the ledger now carries the dead-letters.
  const rec2 = recorder();
  const summary2 = await runStrandedGenerationRecovery(db, { now: NOW, drive: rec2.drive, limit: 3 });
  eq(summary2.deadLettered, 0, "§2 no NEW dead-letters on the second sweep");
  eq(summary2.skippedDeadLettered, 7, "§2 all seven zombies are skipped via the ledger");
  eq(deadLetterEvents(db).length, 7, "§2 no duplicate dead-letter events are written");
  ok(rec2.calls.every((c) => !c.tripId.startsWith("trip-zombie")), "§2 no drive is ever spent on a zombie again");
}

/* ---------------- §3 — under threshold still recovers ---------------- */
{
  const tripId = "trip-almost-zombie";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, makeState(tripId))],
    roamly_trip_generation_jobs: [jobRow("job-almost", tripId)],
    roamly_app_events: [reopenEvent(tripId, "job-almost", 90), reopenEvent(tripId, "job-almost", 45)],
    roamly_communication_ledger: []
  });
  const rec = recorder();
  const summary = await runStrandedGenerationRecovery(db, { now: NOW, drive: rec.drive });
  eq(summary.deadLettered, 0, "§3 two prior cycles do NOT dead-letter (the threshold is three)");
  eq(summary.reopened, 1, "§3 the job is reopened as before");
  eq(summary.driven, 1, "§3 the trip is driven as before");
  eq(rec.calls.length, 1, "§3 the drive ran");
  eq(deadLetterEvents(db).length, 0, "§3 no dead-letter event was written");
}

/* ---------------- §4 — pack-wait visibility ---------------- */
{
  const waitSince = iso(NOW_MS - 45 * 60_000);
  const waitingState = makeState("trip-pack-wait", {
    status: "queued",
    currentStage: "generating_outline",
    completedDayCount: 0,
    days: {},
    outline: null,
    updatedAt: iso(NOW_MS - 30_000), // a wait cycle persisted 30 s ago
    waitingOnPack: { destinationId: "dst-fukuoka", since: waitSince, waits: 12 }
  });
  const runningWaitState = makeState("trip-pack-wait-running", {
    status: "queued",
    currentStage: "generating_outline",
    completedDayCount: 0,
    days: {},
    outline: null,
    updatedAt: iso(NOW_MS - 30_000),
    waitingOnPack: { destinationId: "dst-fukuoka", since: waitSince, waits: 4 }
  });
  const db = new FakeDb({
    roamly_trips: [tripRow("trip-pack-wait", waitingState), tripRow("trip-pack-wait-running", runningWaitState)],
    roamly_trip_generation_jobs: [
      jobRow("job-wait", "trip-pack-wait", { status: "waiting", retry_count: 0, lease_expires_at: null, updated_at: iso(NOW_MS - 30_000) }),
      jobRow("job-wait-running", "trip-pack-wait-running", { status: "running", retry_count: 0, lease_expires_at: PAST, updated_at: STALE })
    ],
    roamly_app_events: [],
    roamly_communication_ledger: []
  });
  const rec = recorder();
  const summary = await runStrandedGenerationRecovery(db, { now: NOW, drive: rec.drive });
  eq(rec.calls.length, 0, "§4 the sweep never drives a pack-waiting trip");
  eq(summary.candidates.length, 0, "§4 no pack-waiting trip becomes a recovery candidate");
  eq(summary.packWaits.length, 1, "§4 the waiting-job pack wait is surfaced in summary.packWaits");
  eq(summary.packWaits[0].tripId, "trip-pack-wait", "§4 packWaits names the trip");
  eq(summary.packWaits[0].destinationId, "dst-fukuoka", "§4 packWaits names the destination it waits on");
  eq(summary.packWaits[0].ageSeconds, 2700, "§4 packWaits reports the wait's true age (45 min), not the refreshed updatedAt");
  eq(summary.packWaitAlarms, 1, "§4 one pack_wait_alarm event is emitted for the aged wait");
  const alarms = alarmEvents(db);
  eq(alarms.length, 1, "§4 exactly one alarm event persisted");
  eq(alarms[0].metadata.recoveryClass, "waiting_on_pack", "§4 the alarm carries the named waiting_on_pack class");
  eq(alarms[0].metadata.tripId, "trip-pack-wait", "§4 the alarm names the trip");
}

/* ---------------- §5 — alarm throttle ---------------- */
{
  const waitSince = iso(NOW_MS - 45 * 60_000);
  const mkWaitTrip = (tripId) =>
    tripRow(
      tripId,
      makeState(tripId, {
        status: "queued",
        currentStage: "generating_outline",
        completedDayCount: 0,
        days: {},
        outline: null,
        updatedAt: iso(NOW_MS - 30_000),
        waitingOnPack: { destinationId: "dst-fukuoka", since: waitSince, waits: 9 }
      })
    );
  const alarmRow = (tripId, minutesAgo) => ({
    user_id: USER,
    event_type: "generation_recovery",
    metadata: { tripId, jobId: `job-${tripId}`, recoveryClass: "waiting_on_pack", action: "pack_wait_alarm", outcome: "waiting_on_pack", stalenessSeconds: 2700 },
    created_at: iso(NOW_MS - minutesAgo * 60_000)
  });
  const db = new FakeDb({
    roamly_trips: [mkWaitTrip("trip-alarmed-recent"), mkWaitTrip("trip-alarmed-old")],
    roamly_trip_generation_jobs: [
      jobRow("job-trip-alarmed-recent", "trip-alarmed-recent", { status: "waiting", retry_count: 0, lease_expires_at: null, updated_at: iso(NOW_MS - 30_000) }),
      jobRow("job-trip-alarmed-old", "trip-alarmed-old", { status: "waiting", retry_count: 0, lease_expires_at: null, updated_at: iso(NOW_MS - 30_000) })
    ],
    roamly_app_events: [alarmRow("trip-alarmed-recent", 10), alarmRow("trip-alarmed-old", 40)],
    roamly_communication_ledger: []
  });
  const rec = recorder();
  const summary = await runStrandedGenerationRecovery(db, { now: NOW, drive: rec.drive });
  eq(summary.packWaits.length, 2, "§5 both aged waits are surfaced");
  eq(summary.packWaitAlarms, 1, "§5 only ONE new alarm: the 10-minute-old alarm throttles, the 40-minute-old re-alarms");
  const alarms = alarmEvents(db);
  eq(alarms.length, 3, "§5 the events table gains exactly one alarm");
  eq(alarms[alarms.length - 1].metadata.tripId, "trip-alarmed-old", "§5 the new alarm is the stale-alarmed trip's");
}

console.log(`SPEED-F8 CHECKS: ${count}/${count} PASS`);
