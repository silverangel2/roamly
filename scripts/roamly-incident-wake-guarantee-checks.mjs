// Roamly incident 2026-10-25, stream 2 — wake-guarantee probe.
//
// Fixture jobs through the REAL runStuckGenerationDetector() against a
// fake Supabase client (no network, no production data, no secrets):
//   - an overdue waiting job IS requeued (next_attempt_at reset to now,
//     locks cleared) AND its incident is still recorded;
//   - a healthy queued job, a non-overdue waiting job, an expired-lease
//     running job, and both failed flavours are NOT requeued, even
//     though the stuck ones still get their incident recorded.
// Plus pure-function proof for the pack-build visibility module and for
// the guest status packBuild pass-through.
//
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-incident-wake-guarantee-checks.mjs
import assert from "node:assert/strict";

const { runStuckGenerationDetector, requeueOverdueGenerationJob } = await import(
  "../lib/roamly/silentFailureDetectors.ts"
);
const { derivePackBuildStatus, packBuildStatusLines } = await import(
  "../lib/roamly/packBuildStatus.ts"
);
const { buildGuestGenerationStatus } = await import(
  "../lib/roamly/guestGenerationStatus.ts"
);

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();
const iso = (ms) => new Date(ms).toISOString();

// --- Fake Supabase client: chainable query builder over in-memory rows.
function makeFake(jobs, trips) {
  const rows = { jobs: jobs.map((j) => ({ ...j })), trips: trips.map((t) => ({ ...t })) };
  function builder(table, op, patch) {
    const filters = [];
    const q = {
      select() { return q; },
      is(col, val) { filters.push({ kind: "is", col, val }); return q; },
      eq(col, val) { filters.push({ kind: "eq", col, val }); return q; },
      in(col, vals) { filters.push({ kind: "in", col, vals }); return q; },
      lte(col, val) { filters.push({ kind: "lte", col, val }); return q; },
      limit() { return q; },
      async maybeSingle() {
        if (op === "update") {
          const match = rows.jobs.find((row) =>
            filters.every((f) =>
              f.kind === "eq" ? row[f.col] === f.val
              : f.kind === "in" ? f.vals.includes(row[f.col])
              : f.kind === "lte" ? row[f.col] !== null && row[f.col] <= f.val
              : true
            )
          );
          if (!match) return { data: null, error: null };
          Object.assign(match, patch);
          return { data: { id: match.id }, error: null };
        }
        // incidents select: no open incident in fixtures.
        return { data: null, error: null };
      },
      then(resolve) {
        let data = [];
        if (table === "roamly_trip_generation_jobs") {
          data = rows.jobs.filter((row) =>
            filters.every((f) =>
              f.kind === "is" ? row[f.col] === f.val
              : f.kind === "in" ? f.vals.includes(row[f.col])
              : true
            )
          );
        } else if (table === "roamly_trips") {
          data = rows.trips.filter((row) =>
            filters.every((f) => (f.kind === "in" ? f.vals.includes(row[f.col]) : true))
          );
        }
        resolve({ data, error: null });
      }
    };
    return q;
  }
  return {
    rows,
    from(table) {
      return {
        select: () => builder(table, "select"),
        update: (patch) => builder(table, "update", patch)
      };
    }
  };
}

const trip = (id, overrides = {}) => ({
  id,
  user_id: `user-${id}`,
  status: "active",
  itinerary_status: "generating",
  itinerary_generated_at: null,
  itinerary_payment_status: "unpaid",
  itinerary_unlock_source: "free",
  ...overrides
});
const job = (id, tripId, overrides = {}) => ({
  id,
  trip_id: tripId,
  user_id: `user-${tripId}`,
  status: "waiting",
  retry_count: 0,
  next_attempt_at: iso(NOW - 60 * 60 * 1000),
  lease_expires_at: null,
  completed_at: null,
  dead_lettered_at: null,
  updated_at: iso(NOW - 60 * 60 * 1000),
  ...overrides
});

const jobs = [
  job("job-overdue-waiting", "trip-overdue"),
  job("job-healthy", "trip-healthy", { status: "queued", next_attempt_at: iso(NOW - 60 * 1000) }),
  job("job-future", "trip-future", { next_attempt_at: iso(NOW + 30 * 60 * 1000) }),
  job("job-expired-lease", "trip-lease", { status: "running", lease_expires_at: iso(NOW - 60 * 60 * 1000), next_attempt_at: null }),
  job("job-retry-exhausted", "trip-exhausted", { status: "failed", retry_count: 3, dead_lettered_at: iso(NOW - 60 * 1000) }),
  job("job-failed-overdue", "trip-failed-overdue", { status: "failed", retry_count: 1 }),
  job("job-complete-trip", "trip-complete", { next_attempt_at: iso(NOW - 60 * 60 * 1000) })
];
const trips = [
  trip("trip-overdue"),
  trip("trip-healthy"),
  trip("trip-future"),
  trip("trip-lease"),
  trip("trip-exhausted"),
  trip("trip-failed-overdue"),
  trip("trip-complete", { itinerary_status: "generated", itinerary_generated_at: iso(NOW - 60 * 1000) })
];
const fake = makeFake(jobs, trips);
const recorded = [];
const recorder = async (event) => {
  recorded.push(event);
  return { ok: true };
};

const result = await runStuckGenerationDetector({ supabase: fake, now: NOW, recorder });
assert.equal(result.ok, true);
assert.equal(result.requeued, 1, "exactly the overdue waiting job is requeued");
assert.equal(result.requeueErrors, 0);
assert.ok(result.detected >= 4, `stuck jobs still recorded, got detected=${result.detected}`);

const overdue = fake.rows.jobs.find((j) => j.id === "job-overdue-waiting");
assert.equal(overdue.status, "waiting");
assert.equal(overdue.next_attempt_at, NOW_ISO, "requeue resets next_attempt_at to now (claimable on next sweep)");
assert.equal(overdue.locked_at, null);
assert.equal(overdue.lease_expires_at, null);
assert.equal(overdue.retry_count, 0, "requeue must not launder retry history (untouched here, still counted)");

const overdueIncident = recorded.find(
  (e) => e.eventCode === "generation_stuck" && e.safeMetadata?.stage === "overdue_retry"
);
assert.ok(overdueIncident, "incident still recorded for the requeued job");

for (const id of ["job-healthy", "job-future", "job-expired-lease", "job-retry-exhausted", "job-failed-overdue"]) {
  const row = fake.rows.jobs.find((j) => j.id === id);
  const original = jobs.find((j) => j.id === id);
  assert.equal(row.next_attempt_at, original.next_attempt_at, `${id} must not be requeued`);
  assert.equal(row.status, original.status, `${id} status untouched`);
}
assert.ok(
  recorded.some((e) => e.safeMetadata?.stage === "expired_lease"),
  "expired-lease job still gets its incident, without a requeue"
);
assert.ok(
  recorded.some((e) => e.safeMetadata?.stage === "retry_exhausted"),
  "retry-exhausted job still gets its incident, without a requeue"
);

// Direct guard proof: a second requeue in the same instant is a no-op
// (next_attempt_at is now, so it is no longer past the cadence) —
// this is the no-tight-loop property, independent of sweep cadence.
const again = await requeueOverdueGenerationJob({ supabase: fake, job: overdue, nowMs: NOW });
assert.equal(again.requeued, false, "requeue must not fire twice within one cadence window");

// --- Pack-build visibility: pure derivation from existing rows only.
assert.equal(derivePackBuildStatus({ destinationId: "dst-x" }).state, "not_built");
assert.equal(
  derivePackBuildStatus({ destinationId: "dst-x", buildJobs: [] }).state,
  "not_built",
  "no pack row at all is said plainly"
);
assert.equal(
  derivePackBuildStatus({
    destinationId: "dst-x",
    buildJobs: [{ status: "queued", requestedAt: iso(NOW - 60000), startedAt: null, finishedAt: null, error: null }]
  }).state,
  "building"
);
const failedPack = derivePackBuildStatus({
  destinationId: "dst-x",
  buildJobs: [{ status: "failed", requestedAt: iso(NOW - 3600000), startedAt: iso(NOW - 3500000), finishedAt: iso(NOW - 3400000), error: "Overpass collection failed (timeout)" }]
});
assert.equal(failedPack.state, "failed");
assert.equal(failedPack.lastError, "Overpass collection failed (timeout)");
assert.equal(
  derivePackBuildStatus({
    destinationId: "dst-x",
    readyVersion: { packVersionId: "pv-1", builtAt: iso(NOW - 1000), candidateCount: 42 }
  }).state,
  "ready"
);
assert.equal(derivePackBuildStatus({ destinationId: "dst-x", readFailed: true }).state, "unknown");
assert.equal(packBuildStatusLines(derivePackBuildStatus({ destinationId: "dst-x" })).headline,
  "No map pack has been built for this destination yet.");
assert.equal(packBuildStatusLines(failedPack, "Rocky Harbour").headline,
  "The last map build for Rocky Harbour failed.");

// Guest status pass-through: the derived pack state survives the builder.
const guest = buildGuestGenerationStatus({
  viewStatus: "building",
  progress: { status: "queued", currentStage: "generating_outline", completedDayCount: 0, totalDayCount: 4, days: [], stageRuns: [], startedAt: iso(NOW - 30 * 60 * 1000) },
  waitingForPack: true,
  failedTimeout: false,
  destination: "Rocky Harbour",
  tripStartedAt: iso(NOW - 30 * 60 * 1000),
  nowMs: NOW,
  maxPackWaitMs: 7_200_000,
  packBuild: derivePackBuildStatus({ destinationId: "dst-x" })
});
assert.equal(guest.packBuild.state, "not_built");
assert.equal(guest.phase, "pack_wait");

console.log("Roamly incident wake-guarantee checks passed (overdue waiting job requeued + incident kept; healthy/future/running/failed jobs untouched; no double requeue inside one cadence; pack-build states derived honestly).");
