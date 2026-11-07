// GAP-CLOSURE WAVE 2, TASK 5b (2026-11-02, LOCAL ONLY).
//
// Part 1 — DURABLE PACK CACHE (lib/roamly/engine/packs/
// supabaseStore.ts): the F3 module memory cache gains a disk tier
// behind ROAMLY_PACK_CACHE_DIR. Proven with the diet checks' own
// seam: the store module is vm-compiled TWICE — a fresh compile is
// a cold process (empty module-level memory cache) — sharing one
// FakeDb and one cache dir:
//   - cold process 2 = ZERO heavy candidate pulls, exactly one
//     light identity read, candidates served from disk;
//   - content_hash change -> disk entry ignored, fresh heavy pull,
//     disk entry rewritten under the new hash;
//   - putCandidateEnrichment -> disk file gone (both tiers
//     invalidated);
//   - env var unset -> no disk file is ever written (exactly the
//     pre-5b behaviour).
//
// Part 2 — SUCCESSFUL-TRIP-PATTERNS WATERMARK
// (lib/roamly/successfulTripExperiencePatternAggregation.ts): the
// REAL aggregation runs against the diet FakeDb; the cursor lives
// in roamly_app_events via recordAppEvent.
//   - run 1 (no cursor) = full scan; cursor event written carrying
//     position + latest-per-trip snapshot;
//   - run 2 (watermarked) after adding a NEWER row for an existing
//     trip, a row for a NEW trip, an OLDER row for an existing
//     trip (must not displace its latest) and a same-created_at /
//     higher-id row for a third trip: (a) the feedback query
//     carried the cursor .or() predicate and read exactly the 3
//     post-cursor rows, (b) run 2's upserted patterns are deepEqual
//     to a control full re-aggregation over the whole set, (c) the
//     OLDER row did not displace (average pins it);
//   - run 3 (no new feedback) reads ZERO feedback rows and produces
//     identical patterns, and does not rewrite the cursor;
//   - a failed patterns upsert writes NO cursor (the next run must
//     re-read from the old position);
//   - the empty-patterns early return STILL advances the cursor
//     (the deliberate choice recorded in the module header).
//
// In-suite instrumentation, minimal: FakeQuery.prototype.or is
// wrapped to record the predicate strings the aggregation issues
// (the shared fake does not log filter expressions), and cursor
// events' created_at stamps are normalized between runs (the fake
// stamps wall-clock now(); ordering ties would otherwise make the
// "latest cursor event" read nondeterministic inside one test
// millisecond — insertion order IS the true order, so the stamps
// are rewritten to increasing values in that order).
//
// Run: npm run test:gap-5b (phase-5 register).

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}
delete process.env.OPENAI_API_KEY;

const { runSuccessfulTripExperiencePatternAggregation, SUCCESSFUL_TRIP_PATTERNS_CURSOR_EVENT_TYPE } =
  await import("@/lib/roamly/successfulTripExperiencePatternAggregation.ts");
const fakeModule = await import("./roamly-egress-diet-fake.mjs");
const { FakeDb, FakeQuery } = fakeModule;

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
function deepEq(actual, expected, label) {
  count += 1;
  assert.deepEqual(actual, expected, label);
  console.log(`  PASS ${label}`);
}
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ================================================================== */
/* Part 1 — durable pack cache                                        */
/* ================================================================== */

console.log("5b-1 — durable pack cache (disk tier behind ROAMLY_PACK_CACHE_DIR)");

{
  const require = createRequire(import.meta.url);
  const ts = require("typescript");
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const readFile = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  function compileStore() {
    const compiled = ts.transpileModule(readFile("lib/roamly/engine/packs/supabaseStore.ts"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const packTypes = (() => {
      const c = ts.transpileModule(readFile("lib/roamly/engine/packs/types.ts"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText;
      const s = {
        exports: {}, module: { exports: {} }, console, Intl, Date, Math, Number, String, Boolean, RegExp, Set, Map, structuredClone, process,
        require: (id) => require(id)
      };
      s.exports = s.module.exports;
      vm.runInNewContext(c, s, { filename: "types.ts" });
      return s.module.exports;
    })();
    const sandbox = {
      exports: {}, module: { exports: {} }, console, Intl, Date, Math, Number, String, Boolean, RegExp, Set, Map, structuredClone, process,
      require: (id) => {
        const stubs = {
          "@/lib/roamly/engine/ids": { contentId: (...parts) => `id-${parts.join("-")}` },
          "@/lib/roamly/engine/packs/store": { candidateContentHash: () => "unused" },
          "@/lib/roamly/engine/packs/destinations": { PRODUCTION_DESTINATION_SEEDS: [] },
          "@/lib/roamly/engine/packs/types": packTypes
        };
        if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
        return require(id);
      }
    };
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: "supabaseStore.ts" });
    return sandbox.module.exports;
  }

  const NOW = new Date("2026-11-02T15:00:00.000Z");
  const iso = (d) => d.toISOString();
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "roamly-pack-cache-5b-"));
  const packRow = {
    id: "pack-row-1", pack_version_id: "packv-test", destination_id: "montreal", version: 1, schema_version: 1,
    classifier_version: "v1", status: "ready", built_at: iso(NOW), candidate_count: 3, counts_by_kind: {},
    content_hash: "hash-1", supersedes_pack_version_id: null, build_job_id: null, provenance: {}
  };
  const packRow2 = { ...packRow, id: "pack-row-2", pack_version_id: "packv-test-2" };
  const candidateRows = Array.from({ length: 3 }, (_, i) => ({
    candidate_key: `cand-${i}`, osm_key: `node/${i}`, kind: "see", name: `Place ${i}`, name_en: null,
    lat: 45.5, lon: -73.5, hours_raw: null, tags: {}, url: null, enrichment: null, pack_id: "pack-row-1"
  }));
  const candidateRows2 = candidateRows.map((r) => ({ ...r, pack_id: "pack-row-2" }));
  const db = new FakeDb({
    roamly_destination_packs: [packRow, packRow2],
    roamly_destination_candidates: [...candidateRows, ...candidateRows2]
  });
  const candidatePulls = () =>
    db.log.filter((e) => e.table === "roamly_destination_candidates" && e.kind === "select" && e.rows >= 3).length;
  const diskFile = (id) => path.join(cacheDir, `${id}.json`);

  process.env.ROAMLY_PACK_CACHE_DIR = cacheDir;
  try {
    // Process 1: cold memory, cold disk -> one heavy pull + disk write.
    const modA = compileStore();
    const first = await new modA.SupabasePackStore(db).getVersionCandidates("packv-test");
    eq(first.length, 3, "5b-1: first load (process 1) returns the candidates");
    eq(candidatePulls(), 1, "5b-1: first load = one heavy pull");
    ok(fs.existsSync(diskFile("packv-test")), "5b-1: the heavy pull wrote the disk entry");
    const diskEntry = JSON.parse(fs.readFileSync(diskFile("packv-test"), "utf8"));
    eq(diskEntry.contentHash, "hash-1", "5b-1: disk entry carries the version content hash");
    eq(diskEntry.candidates.length, 3, "5b-1: disk entry carries the candidate set");

    // Process 2: fresh module compile = cold process, warm disk.
    const modB = compileStore();
    db.resetLog();
    const second = await new modB.SupabasePackStore(db).getVersionCandidates("packv-test");
    eq(second.length, 3, "5b-1: second load (cold process) returns the candidates");
    eq(candidatePulls(), 0, "5b-1: second load = ZERO heavy pulls (disk tier served it)");
    const identityReads = db.log.filter((e) => e.table === "roamly_destination_packs" && e.kind === "select" && e.select === "id,content_hash");
    eq(identityReads.length, 1, "5b-1: second load = exactly one light identity read");
    ok(second !== first && second[0] !== first[0], "5b-1: disk return is a fresh copy, not a shared reference");

    // Hash change: disk entry must be ignored, fresh pull, rewrite.
    db.tables.roamly_destination_packs[0].content_hash = "hash-2";
    const modC = compileStore();
    db.resetLog();
    const third = await new modC.SupabasePackStore(db).getVersionCandidates("packv-test");
    eq(third.length, 3, "5b-1: hash-change load returns the candidates");
    eq(candidatePulls(), 1, "5b-1: changed hash -> disk entry ignored + fresh heavy pull");
    eq(JSON.parse(fs.readFileSync(diskFile("packv-test"), "utf8")).contentHash, "hash-2", "5b-1: disk entry rewritten under the new hash");

    // Enrichment invalidates BOTH tiers: file gone immediately.
    await new modC.SupabasePackStore(db).putCandidateEnrichment("packv-test", "cand-0", { note: "enriched" });
    ok(!fs.existsSync(diskFile("packv-test")), "5b-1: enrichment write -> disk file gone");
  } finally {
    delete process.env.ROAMLY_PACK_CACHE_DIR;
  }

  // Env unset: exactly today's behaviour — no disk writes at all.
  const modD = compileStore();
  await new modD.SupabasePackStore(db).getVersionCandidates("packv-test-2");
  ok(!fs.existsSync(diskFile("packv-test-2")), "5b-1: env unset -> no disk entry written (durable tier disabled)");
  fs.rmSync(cacheDir, { recursive: true, force: true });
}

/* ================================================================== */
/* Part 2 — successful-trip-patterns watermark                        */
/* ================================================================== */

console.log("5b-2 — successful-trip-patterns watermark (exact output equivalence)");

// Record every .or() predicate issued against the fake (see header).
const orExpressions = [];
const originalOr = FakeQuery.prototype.or;
FakeQuery.prototype.or = function (expr) {
  orExpressions.push(expr);
  return originalOr.call(this, expr);
};

function ctx(satisfaction) {
  return {
    schemaVersion: 1,
    destinationKey: "montreal,canada",
    durationDays: 4,
    travelersCount: 2,
    travelStyle: "relaxed",
    accommodationPreference: "hotel",
    transportationPreference: "transit",
    dayCount: 4,
    plannedItemCount: 12,
    flexibleItemCount: 2,
    estimatedBudgetCategoryCount: 4,
    feedbackSignals: {
      overallSatisfaction: satisfaction,
      itineraryPace: "balanced",
      scheduleRealism: 5,
      budgetAccuracy: 4,
      hotelLocationSatisfaction: 5,
      hotelQualitySatisfaction: 4,
      transportationSatisfaction: 5,
      wouldUseRoamlyAgain: true
    }
  };
}
const fb = (n, tripId, createdAt, satisfaction) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  trip_id: tripId,
  feedback_type: "post_trip",
  created_at: createdAt,
  experience_context_json: ctx(satisfaction)
});
const TRIP_A = "11111111-1111-4111-8111-111111111111";
const TRIP_B = "22222222-2222-4222-8222-222222222222";
const TRIP_C = "33333333-3333-4333-8333-333333333333";
const TRIP_D = "44444444-4444-4444-8444-444444444444";

// Run-1 set: three trips, one publishable group (sample + trips >= 3).
const f1 = fb(1, TRIP_A, "2026-10-01T00:00:00.000Z", 5);
const f2 = fb(2, TRIP_B, "2026-10-02T00:00:00.000Z", 4);
const f3 = fb(3, TRIP_C, "2026-10-03T00:00:00.000Z", 5);
// Added before run 2:
const f0 = fb(0, TRIP_B, "2026-09-01T00:00:00.000Z", 5); // OLDER row for B — must NOT displace f2
const f4 = fb(4, TRIP_A, "2026-10-05T00:00:00.000Z", 4); // NEWER row for A — displaces f1
const f5 = fb(5, TRIP_D, "2026-10-06T00:00:00.000Z", 5); // NEW trip D
const f6 = fb(6, TRIP_C, "2026-10-03T00:00:00.000Z", 4); // same created_at as cursor, higher id — displaces f3 via the and() branch

const stripPatternRow = (row) => {
  const { id, created_at, updated_at, ...rest } = row;
  return rest;
};
const patternRowsOf = (db) =>
  (db.tables.successful_trip_experience_patterns || []).map(stripPatternRow)
    .sort((a, b) => String(a.pattern_key).localeCompare(String(b.pattern_key)));
const cursorEventsOf = (db) =>
  (db.tables.roamly_app_events || []).filter((e) => e.event_type === SUCCESSFUL_TRIP_PATTERNS_CURSOR_EVENT_TYPE);
const feedbackRowsReadIn = (db) =>
  db.log.filter((e) => e.table === "trip_feedback" && e.kind === "select").reduce((sum, e) => sum + e.rows, 0);
function normalizeEventStamps(db) {
  // See header: insertion order is the true order; give the events
  // strictly increasing created_at stamps in that order.
  (db.tables.roamly_app_events || []).forEach((event, i) => {
    event.created_at = `2026-11-02T00:00:${String(i).padStart(2, "0")}.000Z`;
  });
}

/* ---------------- run 1: full scan + cursor write ---------------- */
const db = new FakeDb({
  trip_feedback: [clone(f1), clone(f2), clone(f3)],
  roamly_app_events: [],
  successful_trip_experience_patterns: []
});
const run1 = await runSuccessfulTripExperiencePatternAggregation(db);
eq(run1.ok, true, "5b-2 run 1: full-scan run succeeds");
eq(run1.patternsWritten, 1, "5b-2 run 1: one publishable pattern written");
eq(feedbackRowsReadIn(db), 3, "5b-2 run 1: the full scan read all 3 feedback rows");
eq(orExpressions.length, 0, "5b-2 run 1: no cursor predicate on the first run (full scan)");
const run1Patterns = patternRowsOf(db);
eq(run1Patterns.length, 1, "5b-2 run 1: exactly one pattern row upserted");
eq(run1Patterns[0].average_satisfaction, (5 + 4 + 5) / 3, "5b-2 run 1: pattern averages the three latest-per-trip contexts");
eq(cursorEventsOf(db).length, 1, "5b-2 run 1: exactly one cursor event written");
const cursor1 = cursorEventsOf(db)[0].metadata;
eq(cursor1.cursorCreatedAt, f3.created_at, "5b-2 run 1: cursor position = last row read (created_at)");
eq(cursor1.cursorId, f3.id, "5b-2 run 1: cursor position = last row read (id)");
deepEq(Object.keys(cursor1.latestByTrip).sort(), [TRIP_A, TRIP_B, TRIP_C].sort(), "5b-2 run 1: cursor snapshot holds the latest context per trip");
normalizeEventStamps(db);

/* ---------------- run 2: watermarked, equivalence ---------------- */
db.tables.trip_feedback.push(clone(f0), clone(f4), clone(f5), clone(f6));
db.tables.successful_trip_experience_patterns = [];
db.resetLog();
orExpressions.length = 0;
const run2 = await runSuccessfulTripExperiencePatternAggregation(db);
eq(run2.ok, true, "5b-2 run 2: watermarked run succeeds");
eq(feedbackRowsReadIn(db), 3, "5b-2 run 2 (a): the watermarked scan read ONLY the 3 post-cursor rows");
eq(orExpressions.length, 1, "5b-2 run 2 (a): exactly one cursor predicate was issued");
eq(
  orExpressions[0],
  `created_at.gt.${f3.created_at},and(created_at.eq.${f3.created_at},id.gt.${f3.id})`,
  "5b-2 run 2 (a): the predicate is strictly-after the cursor in (created_at, id) order"
);
const run2Patterns = patternRowsOf(db);
eq(run2Patterns.length, 1, "5b-2 run 2: exactly one pattern row upserted");
eq(run2Patterns[0].source_trip_count, 4, "5b-2 run 2: the new trip joined the pattern (4 source trips)");
eq(
  run2Patterns[0].average_satisfaction,
  (4 + 4 + 4 + 5) / 4,
  "5b-2 run 2 (c): averages use A=f4(4), B=f2(4) — the OLDER f0(5) did NOT displace — C=f6(4), D=f5(5)"
);
normalizeEventStamps(db);

// Control: a fresh full re-aggregation over the WHOLE set (no
// cursor anywhere) must produce byte-identical pattern rows.
const controlDb = new FakeDb({
  trip_feedback: [clone(f0), clone(f1), clone(f2), clone(f3), clone(f4), clone(f5), clone(f6)],
  roamly_app_events: [],
  successful_trip_experience_patterns: []
});
const control = await runSuccessfulTripExperiencePatternAggregation(controlDb);
eq(control.ok, true, "5b-2 control: full re-aggregation succeeds");
deepEq(run2Patterns, patternRowsOf(controlDb), "5b-2 run 2 (b): watermarked upserts deepEqual the control full re-aggregation");

/* ---------------- run 3: no new feedback ---------------- */
db.tables.successful_trip_experience_patterns = [];
db.resetLog();
const eventsBefore = cursorEventsOf(db).length;
const run3 = await runSuccessfulTripExperiencePatternAggregation(db);
eq(run3.ok, true, "5b-2 run 3: no-new-feedback run succeeds");
eq(feedbackRowsReadIn(db), 0, "5b-2 run 3: ZERO feedback rows read");
deepEq(patternRowsOf(db), run2Patterns, "5b-2 run 3: patterns identical to run 2 (snapshot-driven)");
eq(cursorEventsOf(db).length, eventsBefore, "5b-2 run 3: cursor not rewritten when nothing advanced (position + snapshot unchanged)");

/* ---------------- failure: no cursor advance ---------------- */
console.log("5b-2 — failure handling + empty-patterns advance");
{
  class FlakyDb extends FakeDb {
    from(table) {
      const query = super.from(table);
      if (table === "successful_trip_experience_patterns" && this.failPatterns) {
        query.execute = () => ({ data: null, error: { message: "patterns upsert boom" }, count: null });
      }
      return query;
    }
  }
  const failDb = new FlakyDb({
    trip_feedback: [clone(f1), clone(f2), clone(f3)],
    roamly_app_events: [],
    successful_trip_experience_patterns: []
  });
  failDb.failPatterns = true;
  const failed = await runSuccessfulTripExperiencePatternAggregation(failDb);
  eq(failed.ok, false, "5b-2 failure: a failed patterns upsert fails the run");
  eq(cursorEventsOf(failDb).length, 0, "5b-2 failure: NO cursor written — the next run re-reads from the old position");
  failDb.failPatterns = false;
  const recovered = await runSuccessfulTripExperiencePatternAggregation(failDb);
  eq(recovered.ok, true, "5b-2 failure: the retry succeeds as a full scan");
  eq(cursorEventsOf(failDb).length, 1, "5b-2 failure: the cursor is written only after the successful retry");
}
{
  // Empty-patterns early return: one non-qualifying feedback row ->
  // no publishable pattern, but the scan succeeded, so the cursor
  // still advances past the row it read.
  const emptyDb = new FakeDb({
    trip_feedback: [fb(9, TRIP_A, "2026-10-01T00:00:00.000Z", 2)],
    roamly_app_events: [],
    successful_trip_experience_patterns: []
  });
  const emptyRun = await runSuccessfulTripExperiencePatternAggregation(emptyDb);
  eq(emptyRun.ok, true, "5b-2 empty: non-qualifying feedback run succeeds");
  eq(emptyRun.qualifyingPatterns, 0, "5b-2 empty: no pattern qualifies (early return path)");
  eq(cursorEventsOf(emptyDb).length, 1, "5b-2 empty: the cursor STILL advances on the empty-patterns early return");
  eq(cursorEventsOf(emptyDb)[0].metadata.cursorId, "00000000-0000-4000-8000-000000000009", "5b-2 empty: the advanced cursor sits at the row that was read");
}

console.log(`\nGAP-CLOSURE 5b checks: ${count} assertions passed.`);
