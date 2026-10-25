// Roamly incident 2026-10-25, stream 2 — OPTIONAL change set probe
// (severable: drop this file + lib/roamly/packWaitTerminalTransition.ts
// + the sweep-route hunks to drop the option entirely).
//
// Proves the sweep-side terminal transition evaluates the SAME condition
// as the engine's wake-gated cap, and only for proven pack-waiters:
//   - cap-past generating_outline job, packVersionId null, waits >= 1
//     => transitioned (job failed, trip state failed, incident recorded);
//   - pack ready (packVersionId set) => untouched, even past the cap;
//   - outline not yet waited (packWaitCount 0) => untouched;
//   - cap not yet reached => untouched;
//   - already-failed job => untouched by this module (not its job).
// Fixture rows only; no network, no production data, no secrets.
//
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-incident-pack-wait-terminal-checks.mjs
import assert from "node:assert/strict";

const { packWaitTerminalDecision, runPackWaitTerminalTransition } = await import(
  "../lib/roamly/packWaitTerminalTransition.ts"
);

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const TWO_HOURS = 7_200_000;
const iso = (ms) => new Date(ms).toISOString();

const base = (overrides = {}) => ({
  jobStatus: "waiting",
  tripStatus: "active",
  itineraryStatus: "generating",
  itineraryGeneratedAt: null,
  currentStage: "generating_outline",
  zeroEngine: { startedAt: iso(NOW - TWO_HOURS - 60_000), packVersionId: null, packWaitCount: 71 },
  nowMs: NOW,
  maxPackWaitMs: TWO_HOURS,
  ...overrides
});

assert.equal(packWaitTerminalDecision(base()), true, "cap-past pack-waiter transitions");
assert.equal(packWaitTerminalDecision(base({ zeroEngine: { startedAt: iso(NOW - TWO_HOURS - 60_000), packVersionId: "pv-1", packWaitCount: 71 } })), false, "pack ready => never transitioned");
assert.equal(packWaitTerminalDecision(base({ zeroEngine: { startedAt: iso(NOW - TWO_HOURS - 60_000), packVersionId: null, packWaitCount: 0 } })), false, "no waits yet => not a proven pack-waiter");
assert.equal(packWaitTerminalDecision(base({ zeroEngine: { startedAt: iso(NOW - 30 * 60 * 1000), packVersionId: null, packWaitCount: 3 } })), false, "cap not reached => untouched");
assert.equal(packWaitTerminalDecision(base({ jobStatus: "failed" })), false, "already failed => not this module's job");
assert.equal(packWaitTerminalDecision(base({ jobStatus: "running" })), false, "running => untouched");
assert.equal(packWaitTerminalDecision(base({ currentStage: "generating_day" })), false, "past outline => untouched");
assert.equal(packWaitTerminalDecision(base({ tripStatus: "completed" })), false, "terminal trip => untouched");
assert.equal(packWaitTerminalDecision(base({ zeroEngine: null })), false, "no zero-engine record => untouched");

// --- End-to-end through runPackWaitTerminalTransition, fake client only.
function makeFake(jobs, trips) {
  const rows = { jobs: jobs.map((j) => ({ ...j })), trips: trips.map((t) => ({ ...t, metadata: structuredClone(t.metadata) })) };
  function builder(table, op, patch) {
    const filters = [];
    const q = {
      select() { return q; },
      is(col, val) { filters.push({ kind: "is", col, val }); return q; },
      eq(col, val) { filters.push({ kind: "eq", col, val }); return q; },
      in(col, vals) { filters.push({ kind: "in", col, vals }); return q; },
      limit() { return q; },
      async maybeSingle() {
        if (op !== "update") return { data: null, error: null };
        const match = rows.jobs.find((row) =>
          filters.every((f) =>
            f.kind === "eq" ? row[f.col] === f.val
            : f.kind === "in" ? f.vals.includes(row[f.col])
            : true
          )
        );
        if (!match) return { data: null, error: null };
        Object.assign(match, patch);
        return { data: { id: match.id }, error: null };
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
    // Trip metadata update is awaited directly (no maybeSingle in the module).
    q.then = ((origThen) => (resolve) => {
      if (op === "trip-update") {
        const match = rows.trips.find((row) =>
          filters.every((f) => (f.kind === "eq" ? row[f.col] === f.val : true))
        );
        if (match) Object.assign(match, patch);
        resolve({ data: null, error: null });
        return;
      }
      return origThen(resolve);
    })(q.then);
    return q;
  }
  return {
    rows,
    from(table) {
      return {
        select: () => builder(table, "select"),
        update: (patch) => (table === "roamly_trips" ? builder(table, "trip-update", patch) : builder(table, "update", patch))
      };
    }
  };
}

const tripMeta = (startedAt, packVersionId, packWaitCount, currentStage = "generating_outline") => ({
  generation: { version: 2, tripId: "t", status: currentStage, currentStage, totalDayCount: 4, completedDayCount: 0 },
  zeroEngine: { generationVersion: "zero-engine-v1", destinationId: "dst-x", packVersionId, packWaitCount, startedAt }
});
const fake = makeFake(
  [
    { id: "job-cap-past", trip_id: "trip-cap-past", user_id: "user-cap-past", status: "waiting", completed_at: null },
    { id: "job-pack-ready", trip_id: "trip-pack-ready", user_id: "user-pack-ready", status: "waiting", completed_at: null }
  ],
  [
    { id: "trip-cap-past", user_id: "user-cap-past", status: "active", itinerary_status: "generating", itinerary_generated_at: null, metadata: tripMeta(iso(NOW - TWO_HOURS - 60_000), null, 71) },
    { id: "trip-pack-ready", user_id: "user-pack-ready", status: "active", itinerary_status: "generating", itinerary_generated_at: null, metadata: tripMeta(iso(NOW - TWO_HOURS - 60_000), "pv-9", 71) }
  ]
);
const recorded = [];
const result = await runPackWaitTerminalTransition({
  supabase: fake,
  now: NOW,
  recorder: async (event) => {
    recorded.push(event);
    return { ok: true };
  }
});
assert.equal(result.ok, true);
assert.equal(result.transitioned, 1, "only the cap-past pack-waiter transitions");
assert.equal(result.skipped, 1);
const moved = fake.rows.jobs.find((j) => j.id === "job-cap-past");
assert.equal(moved.status, "failed");
assert.equal(moved.last_error_code, "ZERO_ENGINE_PACK_WAIT_TIMEOUT");
assert.equal(moved.retry_count, undefined, "retry history is not rewritten by the transition");
const movedTrip = fake.rows.trips.find((t) => t.id === "trip-cap-past");
assert.equal(movedTrip.metadata.generation.status, "failed");
assert.equal(movedTrip.metadata.generation.currentStage, "failed");
assert.equal(movedTrip.metadata.generation.lastErrorCode, "ZERO_ENGINE_PACK_WAIT_TIMEOUT");
assert.equal(movedTrip.metadata.zeroEngine.packWaitCount, 71, "zero-engine record preserved for diagnosis");
const readyJob = fake.rows.jobs.find((j) => j.id === "job-pack-ready");
assert.equal(readyJob.status, "waiting", "pack-ready job untouched");
assert.ok(recorded.some((e) => e.eventCode === "generation_pack_wait_timeout"), "transition incident recorded");

console.log("Roamly incident pack-wait terminal checks passed (same condition as the engine cap; only proven pack-waiters transition; pack-ready / early / failed jobs untouched).");
