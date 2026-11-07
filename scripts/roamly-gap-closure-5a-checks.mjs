// GAP-CLOSURE WAVE 2, TASK 5a (2026-11-02, LOCAL ONLY) — generation
// state out of trip metadata: migration + dual-write + state-first
// reads, proven at the seams the house precedent uses.
//
//   (i)   trip with state ONLY in metadata, stranded shape -> the
//         recovery sweep detects + drives it (fallback works), both
//         with an empty states table and with the table absent.
//   (ii)  trip with state ONLY in roamly_trip_generation_states
//         (metadata has no generation key), stranded -> detected +
//         driven.
//   (iii) trip in BOTH with disagreeing states -> the sweep uses the
//         NEW TABLE state, in both directions (table-stale/metadata-
//         fresh drives; table-complete/metadata-stale does not).
//   (iv)  dual-write helper: one persist-shaped call produces the
//         states-table upsert with matching status + the identical
//         state object; the three writer funnels are source-pinned
//         to dual-write the SAME state object they persist into
//         metadata, with the metadata write lines byte-identical to
//         baseline (funnel internals have no injection seam — the
//         GAP-B helper-seam + source-pin precedent).
//   (v)   fail-soft: states upsert erroring / throwing -> helper
//         reports false and never throws; states READ erroring ->
//         the sweep falls back to metadata and still drives.
//   (vi)  the generation status route prefers the states-table row
//         (vm-compiled real route + the REAL generationStateStore,
//         diet-checks style) and falls back to metadata with no row.
//   (vii) the migration file's shape is pinned (table, index, RLS
//         with no anon/authenticated policies, inlined backfill on
//         the exact 'generation' metadata key, NOT-YET-APPLIED
//         header).
//
// Run: npm run test:gap-5a (phase-5 register).

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}
delete process.env.OPENAI_API_KEY;

const { runStrandedGenerationRecovery } = await import("@/lib/roamly/generationRecovery.ts");
const { dualWriteGenerationState, readGenerationStateRow } = await import(
  "@/lib/roamly/generationStateStore.ts"
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
  assert.equal(actual, expected, label);
  console.log(`  PASS ${label}`);
}
const clone = (v) => JSON.parse(JSON.stringify(v));

const NOW = new Date("2026-11-02T15:00:00.000Z");
const NOW_MS = NOW.getTime();
const iso = (ms) => new Date(ms).toISOString();
const STALE = iso(NOW_MS - 10 * 60_000);
const FRESH = iso(NOW_MS - 60_000);
const USER = "22222222-2222-4222-8222-222222222222";

function makeState(tripId, overrides = {}) {
  return {
    version: 2,
    tripId,
    status: "generating_day",
    currentStage: "generating_day",
    totalDayCount: 3,
    completedDayCount: 1,
    outline: {
      tripSummary: "Gap-5a harness trip.",
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

function tripRow(tripId, metadata, overrides = {}) {
  return {
    id: tripId,
    user_id: USER,
    metadata,
    status: "generating",
    itinerary_status: "generating",
    updated_at: STALE,
    ...overrides
  };
}

function statesRow(tripId, state) {
  return {
    trip_id: tripId,
    user_id: USER,
    state,
    status: state.status,
    updated_at: state.updatedAt
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

/* ------------------------------------------------------------------ */
/* (i) metadata-only stranded trip -> driven (fallback)               */
/* ------------------------------------------------------------------ */

console.log("(i) state ONLY in metadata — fallback drives the stranded trip");

for (const [label, withTable] of [["states table present but empty", true], ["states table absent", false]]) {
  const tripId = `trip-5a-meta-${withTable ? "empty" : "absent"}`;
  const tables = {
    roamly_trips: [tripRow(tripId, { generation: makeState(tripId) })],
    roamly_trip_generation_jobs: []
  };
  if (withTable) tables.roamly_trip_generation_states = [];
  const db = new FakeDb(tables);
  const rec = recorder();
  const summary = await runStrandedGenerationRecovery(db, { now: NOW, drive: rec.drive });
  eq(rec.calls.length, 1, `(i) ${label}: the stranded metadata-only trip was driven`);
  eq(summary.candidates[0].class, "no_active_job", `(i) ${label}: candidate class is no_active_job`);
}

/* ------------------------------------------------------------------ */
/* (ii) table-only stranded trip -> driven                            */
/* ------------------------------------------------------------------ */

console.log("(ii) state ONLY in roamly_trip_generation_states — sweep detects + drives");

{
  const tripId = "trip-5a-table-only";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, { planning: { note: "no generation key here" } })],
    roamly_trip_generation_jobs: [],
    roamly_trip_generation_states: [statesRow(tripId, makeState(tripId))]
  });
  const rec = recorder();
  const summary = await runStrandedGenerationRecovery(db, { now: NOW, drive: rec.drive });
  eq(rec.calls.length, 1, "(ii) the table-only stranded trip was driven");
  eq(summary.driven, 1, "(ii) summary.driven === 1");
  eq(summary.candidates[0].class, "no_active_job", "(ii) candidate class is no_active_job");
}

/* ------------------------------------------------------------------ */
/* (iii) disagreement — the NEW TABLE wins, both directions           */
/* ------------------------------------------------------------------ */

console.log("(iii) both locations, disagreeing — new table wins");

{
  // Metadata state is FRESH (not stranded); table state is STALE
  // stranded. If metadata drove the decision: no drive. Table wins:
  // driven.
  const tripId = "trip-5a-disagree-drives";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, { generation: makeState(tripId, { updatedAt: FRESH }) })],
    roamly_trip_generation_jobs: [],
    roamly_trip_generation_states: [statesRow(tripId, makeState(tripId))]
  });
  const rec = recorder();
  await runStrandedGenerationRecovery(db, { now: NOW, drive: rec.drive });
  eq(rec.calls.length, 1, "(iii) table-stale + metadata-fresh: driven (the TABLE state drove the decision)");
}
{
  // Metadata state is STALE stranded; table state is COMPLETE. If
  // metadata drove the decision: driven (a resurrection). Table
  // wins: never driven.
  const tripId = "trip-5a-disagree-skips";
  const db = new FakeDb({
    roamly_trips: [tripRow(tripId, { generation: makeState(tripId) })],
    roamly_trip_generation_jobs: [],
    roamly_trip_generation_states: [
      statesRow(tripId, makeState(tripId, { status: "complete", currentStage: "complete", completedAt: STALE }))
    ]
  });
  const rec = recorder();
  const summary = await runStrandedGenerationRecovery(db, { now: NOW, drive: rec.drive });
  eq(rec.calls.length, 0, "(iii) table-complete + metadata-stale: NOT driven (table state wins, no resurrection)");
  eq(summary.driven, 0, "(iii) summary.driven === 0 for the completed-in-table trip");
}

/* ------------------------------------------------------------------ */
/* (iv) dual-write helper + funnel source pins                        */
/* ------------------------------------------------------------------ */

console.log("(iv) dual-write: states upsert matches the persisted state; funnels pinned");

{
  const tripId = "trip-5a-dual-write";
  const state = makeState(tripId, { status: "generating_outline", currentStage: "generating_outline" });
  const db = new FakeDb({ roamly_trip_generation_states: [] });
  const written = await dualWriteGenerationState(db, { tripId, userId: USER, state });
  eq(written, true, "(iv) dual-write reports success against a present table");
  eq(db.tables.roamly_trip_generation_states.length, 1, "(iv) exactly one states row was upserted");
  const row = db.tables.roamly_trip_generation_states[0];
  eq(row.trip_id, tripId, "(iv) upserted row trip_id matches");
  eq(row.user_id, USER, "(iv) upserted row user_id matches");
  eq(row.status, state.status, "(iv) upserted row status mirrors state.status");
  eq(row.updated_at, state.updatedAt, "(iv) upserted row updated_at mirrors state.updatedAt");
  assert.deepEqual(row.state, state, "(iv) upserted state is the identical state object content");
  count += 1;
  console.log("  PASS (iv) upserted state is the identical state object content");
}

{
  const read = (rel) => fs.readFileSync(rel, "utf8");
  const staged = read("lib/roamly/stagedItineraryGeneration.ts");
  const engine = read("lib/roamly/engine/generate.ts");

  // persistState funnel: metadata write line unchanged, dual-write
  // of the same `state` after it.
  ok(staged.includes("metadata: generationMetadata(metadataBase, state),"), "(iv) persistState: metadata write line unchanged (generationMetadata(metadataBase, state))");
  const persistSlice = staged.slice(staged.indexOf("async function persistState"), staged.indexOf("async function persistItinerary"));
  ok(
    persistSlice.indexOf("generationMetadata(metadataBase, state)") >= 0 &&
      persistSlice.indexOf("dualWriteGenerationState(params.supabase") > persistSlice.indexOf("generationMetadata(metadataBase, state)"),
    "(iv) persistState: dual-write runs after the metadata write, inside the same funnel"
  );
  ok(persistSlice.includes("state\n  });"), "(iv) persistState: dual-write receives the same `state` object");

  // claim funnel: claimedState into metadata, then dual-written.
  const claimSlice = staged.slice(staged.indexOf("async function claimTrip"), staged.indexOf("function releaseLease"));
  ok(claimSlice.includes("metadata: generationMetadata(trip.metadata, claimedState)"), "(iv) claim: metadata claim write unchanged (generationMetadata(trip.metadata, claimedState))");
  ok(
    claimSlice.indexOf("dualWriteGenerationState(supabase") > claimSlice.indexOf("generationMetadata(trip.metadata, claimedState)") &&
      claimSlice.includes("state: claimedState"),
    "(iv) claim: dual-write of claimedState follows the landed claim write"
  );

  // zero-engine funnel: writeState persists nextState via
  // generationMetadata(metadataBase, nextState, run), then dual-writes.
  const writeSlice = engine.slice(engine.indexOf("async function writeState"), engine.indexOf("return {", engine.indexOf("async function writeState")));
  ok(writeSlice.includes("metadata: generationMetadata(metadataBase, nextState, run),"), "(iv) engine writeState: metadata write line unchanged");
  ok(
    writeSlice.indexOf("dualWriteGenerationState(supabase") > writeSlice.indexOf("generationMetadata(metadataBase, nextState, run)") &&
      writeSlice.includes("state: nextState"),
    "(iv) engine writeState: dual-write of nextState follows the metadata write"
  );
}

/* ------------------------------------------------------------------ */
/* (v) fail-soft — errors never break generation or the sweep         */
/* ------------------------------------------------------------------ */

console.log("(v) fail-soft: dual-write + states reads degrade, never throw");

{
  const errResult = { data: null, error: { message: 'relation "public.roamly_trip_generation_states" does not exist' } };
  class ErrQuery {
    select() { return this; }
    eq() { return this; }
    in() { return this; }
    limit() { return this; }
    upsert() { return this; }
    async maybeSingle() { return errResult; }
    then(resolve) { resolve(errResult); }
  }
  class ErrStatesDb extends FakeDb {
    from(table) {
      if (table === "roamly_trip_generation_states") return new ErrQuery();
      return super.from(table);
    }
  }

  const state = makeState("trip-5a-failsoft");
  const db = new ErrStatesDb({ roamly_trip_generation_states: [] });
  eq(
    await dualWriteGenerationState(db, { tripId: state.tripId, userId: USER, state }),
    false,
    "(v) dual-write over an erroring table reports false (the metadata write remains the durable copy)"
  );
  eq(await readGenerationStateRow(db, state.tripId), null, "(v) states read over an erroring table returns null (fallback signal)");

  const throwingClient = { from() { throw new Error("client exploded"); } };
  eq(
    await dualWriteGenerationState(throwingClient, { tripId: state.tripId, userId: USER, state }),
    false,
    "(v) dual-write over a throwing client reports false and does not throw"
  );

  // The sweep over the erroring states table falls back to metadata
  // and still drives a metadata-only stranded trip.
  const tripId = "trip-5a-failsoft-sweep";
  const sweepDb = new ErrStatesDb({
    roamly_trips: [tripRow(tripId, { generation: makeState(tripId) })],
    roamly_trip_generation_jobs: []
  });
  const rec = recorder();
  await runStrandedGenerationRecovery(sweepDb, { now: NOW, drive: rec.drive });
  eq(rec.calls.length, 1, "(v) sweep with an erroring states table falls back to metadata and drives");
}

/* ------------------------------------------------------------------ */
/* (vi) status route prefers the states row (real route + real store) */
/* ------------------------------------------------------------------ */

console.log("(vi) generation status route — table state wins, metadata fallback intact");

{
  const require = createRequire(import.meta.url);
  const ts = require("typescript");
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const readFile = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  function compileTs(rel, stubs) {
    const compiled = ts.transpileModule(readFile(rel), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const sandbox = {
      exports: {}, module: { exports: {} }, console, Intl, Date, Math, Number, String, Boolean, RegExp, Set, Map, structuredClone,
      require: (id) => {
        if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
        return require(id);
      }
    };
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: rel });
    return sandbox.module.exports;
  }

  const realStore = compileTs("lib/roamly/generationStateStore.ts", {
    "@/lib/roamly/generationDiagnostics": { logGenerationDiagnostic: () => {} }
  });
  const statusRoute = compileTs("app/api/trips/[id]/generation/status/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    "@/lib/roamly/auth": { requireUser: async () => ({ ok: true, supabase: globalThis.__gap5aFake, user: { id: USER } }) },
    "@/lib/roamly/stagedItineraryGeneration": {
      publicStagedGenerationProgress: (metadata, tripId) => {
        const state = metadata?.generation;
        if (!state) return null;
        return { tripId, status: state.status, currentStage: state.status, completedDayCount: state.completedDayCount, totalDayCount: state.totalDayCount, percent: 25, completedAt: null, days: [], batches: [] };
      }
    },
    "@/lib/roamly/generationFinalization": {
      finalizeCompletedStagedGeneration: async () => ({ ok: false, error: "not-run-in-5a" }),
      hasFinalStoredItineraryInMetadata: () => false,
      isFinalStoredItinerary: () => false
    },
    "@/lib/roamly/generationQueue": {
      getGenerationQueueForTrip: async () => ({ job: null, layers: [], error: null }),
      publicQueueProgress: (queue) => ({ status: queue.job?.status || "queued", totalLayerCount: 8, completedLayerCount: 2, job: { status: queue.job?.status || "queued", completed_at: null }, layers: queue.layers || [] }),
      queueTableMissing: () => false
    },
    "@/lib/roamly/itineraryGenerationEmail": {
      getGenerationEmailStatus: () => ({ email_me_when_ready: false, completion_email_sent_at: null, completion_email_status: null, delivery_status: null })
    },
    "@/lib/roamly/generationStatus": compileTs("lib/roamly/generationStatus.ts", {}),
    "@/lib/roamly/engine/generate": {
      ZERO_ENGINE_GENERATION_NOTE: "Generated by Roamly's deterministic zero-engine from recorded place data — no AI model calls were used.",
      ZERO_ENGINE_SOURCE: "zero-engine"
    },
    "@/lib/supabase/admin": { createSupabaseAdminClient: () => globalThis.__gap5aFake },
    "@/lib/roamly/generationStateStore": realStore
  });

  const tripId = "trip-5a-status";
  const metadataState = { tripId, status: "generating_day", completedDayCount: 1, totalDayCount: 4 };
  const tableState = { tripId, status: "generating_day", completedDayCount: 3, totalDayCount: 4 };
  const baseTables = () => ({
    roamly_trips: [{
      id: tripId, user_id: USER, itinerary_status: "generating", status: "generating", itinerary_locked: false,
      metadata: { generation: clone(metadataState) }
    }],
    roamly_trip_generation_jobs: [{ id: "job-5a", trip_id: tripId, user_id: USER, status: "running", error_message: null, completed_at: null, updated_at: iso(NOW_MS), created_at: iso(NOW_MS) }],
    roamly_trip_generation_layers: [],
    roamly_itineraries: []
  });

  // No states row -> metadata progress (completedDayCount 1).
  globalThis.__gap5aFake = new FakeDb({ ...baseTables(), roamly_trip_generation_states: [] });
  const resFallback = await statusRoute.GET(new Request(`http://local/api/trips/${tripId}/generation/status`), { params: Promise.resolve({ id: tripId }) });
  eq(resFallback.body.progress.completedDayCount, 1, "(vi) no states row: progress comes from trip metadata (1 day)");

  // States row present with a different progress -> table wins (3).
  globalThis.__gap5aFake = new FakeDb({
    ...baseTables(),
    roamly_trip_generation_states: [statesRow(tripId, clone(tableState))]
  });
  const resTable = await statusRoute.GET(new Request(`http://local/api/trips/${tripId}/generation/status`), { params: Promise.resolve({ id: tripId }) });
  eq(resTable.body.progress.completedDayCount, 3, "(vi) states row present: progress comes from the TABLE state (3 days), metadata disagrees and loses");
  const stateReads = globalThis.__gap5aFake.log.filter((e) => e.table === "roamly_trip_generation_states" && e.kind === "select");
  eq(stateReads.length, 1, "(vi) exactly one light states read per poll");
}

/* ------------------------------------------------------------------ */
/* (vii) migration shape pins                                         */
/* ------------------------------------------------------------------ */

console.log("(vii) migration 20261102000100 — shape pins");

{
  const sqlPath = "supabase/migrations/20261102000100_roamly_trip_generation_states.sql";
  ok(fs.existsSync(sqlPath), "(vii) migration file exists in the tree's migration sequence");
  const sql = fs.readFileSync(sqlPath, "utf8");
  ok(/NOT YET APPLIED/.test(sql) && /post-Nov-5 diet package/.test(sql), "(vii) header states post-Nov-5 diet package + NOT YET APPLIED");
  ok(sql.includes("create table if not exists public.roamly_trip_generation_states"), "(vii) creates roamly_trip_generation_states");
  ok(sql.includes("trip_id uuid primary key references public.roamly_trips(id) on delete cascade"), "(vii) trip_id PK FK roamly_trips on delete cascade");
  ok(sql.includes("state jsonb not null") && sql.includes("status text not null") && sql.includes("updated_at timestamptz not null default now()"), "(vii) state jsonb + status text + updated_at timestamptz columns");
  ok(sql.includes("on public.roamly_trip_generation_states (status, updated_at)"), "(vii) (status, updated_at) index present");
  ok(sql.includes("alter table public.roamly_trip_generation_states enable row level security"), "(vii) RLS enabled");
  ok(!/create policy/i.test(sql), "(vii) NO anon/authenticated policies (service-role only)");
  ok(sql.includes("insert into public.roamly_trip_generation_states"), "(vii) backfill inlined as insert-select");
  ok(sql.includes("t.metadata -> 'generation'"), "(vii) backfill extracts the exact 'generation' metadata key (the getStagedGenerationState shape)");
  ok(sql.includes("t.metadata ? 'generation'"), "(vii) backfill only touches trips that carry a generation state");
  ok(sql.includes("on conflict (trip_id) do nothing"), "(vii) backfill is on conflict do nothing");
  ok(sql.includes("->> 'status'") && sql.includes("->> 'updatedAt'"), "(vii) backfill mirrors status + updatedAt from the state object's own camelCase fields");
}

console.log(`\nGAP-CLOSURE 5a checks: ${count} assertions passed.`);
