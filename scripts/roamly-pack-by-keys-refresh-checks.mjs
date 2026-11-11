// Stage 7 pack by-keys refresh (2026-11-11).
//
// The pack-read perf repair (Stage 2 / PR #116) left one floor:
// every cold wake re-serves the whole solver projection — one
// settings read of ~7.7 MB on the Rome-shaped fixture — and the
// batch-1 wake pays it TWICE: once to assemble, once to refresh
// after enrichment, because every putCandidateEnrichment deletes
// the cache entry and the refresh re-assembled the full pack to
// move the handful of finalist rows it had just enriched.
//
// The Stage 7 fix: the refresh re-reads ONLY the finalist keys
// (SupabasePackStore.getVersionCandidatesByKeys) and merges them
// into the candidate set the wake already holds
// (builder.refreshAssembledPackByKeys), falling back to the full
// re-assemble whenever the by-keys route is unavailable.
//
// This suite measures BEFORE (full re-serve refresh) vs AFTER
// (by-keys refresh) on the instrumented Rome fixture from the
// pack-read-perf suite, and proves the merged set is
// field-for-field identical to the full serve — so the solver's
// itinerary output over it is identical (asserted on the plan's
// per-day item keys + must-see results; the solver is a pure
// function of the candidate set).
//
// Evidence tier: SIMULATED (instrumented fake, Rome-shaped
// fixture — the same tier and fixture as the Stage 2 repair).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeDb } from "./roamly-egress-diet-fake.mjs";
import { SupabasePackStore } from "@/lib/roamly/engine/packs/supabaseStore.ts";
import {
  assembleEnginePack,
  mergeRefreshedCandidates,
  refreshAssembledPackByKeys
} from "@/lib/roamly/engine/packs/builder.ts";
import { extractConstraints } from "@/lib/roamly/engine/understand.ts";
import { deriveMustSees } from "@/lib/roamly/engine/generate.ts";
import { solveTrip } from "@/lib/roamly/engine/solver.ts";
import { parseHhmm } from "@/lib/roamly/engine/util.ts";

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}

const POSTGREST_MAX_ROWS = 1000;
class PostgrestDb extends FakeDb {
  from(table) {
    const q = super.from(table);
    if (table !== "roamly_destination_candidates") return q;
    const execute = q.execute.bind(q);
    q.execute = () => {
      const r = execute();
      if (Array.isArray(r.data) && !q.rangeSpec && r.data.length > POSTGREST_MAX_ROWS) {
        return { ...r, data: r.data.slice(0, POSTGREST_MAX_ROWS) };
      }
      return r;
    };
    return q;
  }
}
class PerfDb extends PostgrestDb {
  from(table) {
    const q = super.from(table);
    const select = q.select.bind(q);
    q.select = (cols, opts) => {
      if (q.writeKind) {
        q.returningCols = cols;
        return q;
      }
      return select(cols, opts);
    };
    const execute = q.execute.bind(q);
    q.execute = () => {
      const preMatched = q.writeKind === "update" ? q.matched() : null;
      const r = execute();
      if (preMatched && q.returningCols && r.data == null) {
        q.selectCols = q.returningCols;
        const rows = preMatched.map((row) => q.project(row));
        q.selectCols = null;
        return { ...r, data: rows };
      }
      return r;
    };
    return q;
  }
}

/* ---------------- Rome fixture (from the pack-read-perf suite) ---- */
const REAL = [
  ["84657dc6-a934-44db-99b0-39f630d957ea", "attraction", "Colosseum", 41.89939880371094, 12.476815223693848],
  ["fc36ed3f-c3ba-496e-9db6-0be818dad9ba", "historic", "Colosseum", 41.894575119018555, 12.480901718139648],
  ["fda9d253-c738-4c53-b1f9-74e4dda4eb1e", "venue", "Colosseum", 41.890193939208984, 12.492244720458984],
  ["758acc19-c516-42ab-9907-108389975c4e", "historic", "Colosseum Apartments", 41.89181900024414, 12.499799728393555],
  ["c9e68c99-b28c-48a5-9335-c4e4754f4727", "historic", "Colosseum tour meeting place", 41.892826080322266, 12.488265991210938],
  ["ecf5025a-a61e-4108-8df6-c8a2626e7d98", "attraction", "Rome Pub Crawl - COLOSSEUM", 41.90006637573242, 12.499894142150879],
  ["e9ed365d-16cb-4751-9858-4104901ab804", "historic", "Apartment In Front Of Colosseum Roma", 41.89251708984375, 12.492730140686035],
  ["e7d873ee-0de9-4988-9c0c-d0ec3b50b8af", "attraction", "Tickets & Tours Colosseum", 41.88945007324219, 12.500778198242188],
  ["7f8af5d4-0139-4f57-8036-38a1278a7434", "venue", "Colosseum Style", 41.88869094848633, 12.495464324951172],
  ["b2839c0e-dd27-4f6e-98b2-bc6fe7d45f07", "historic", "Pierecci's Underground Colosseum Tour", 41.90765190124512, 12.452929496765137],
  ["91613e90-b4b0-49ee-be09-d04d31952d76", "attraction", "About Rome - Best walking tours with Micaela", 41.891130447387695, 12.49137020111084],
  ["bd469c11-2f54-4044-a50b-a4ba639b6c35", "venue", "Riverside", 41.93400192260742, 12.53580379486084],
  ["06aa459c-5660-4d1a-a8ca-42dc5cb6a52b", "stay", "Salvo Pennisi  Pantheon selfies page", 41.89699745178223, 12.47525691986084],
  ["00aca326-702b-4f36-9ca5-8df684f46c73", "museum", "Dante Ferretti - Con i miei occhi", 41.90078163146973, 12.469250679016113],
  ["03e8e211-baa5-4012-9e3b-93de67138d31", "gallery", "Guildenstern Original Poster Gallery", 41.89950370788574, 12.467644691467285],
  ["0497fffa-1ac4-477d-a8d6-5814f945b00e", "food", "Zucchero e Farina", 41.899003982543945, 12.466676712036049],
  ["0611f98b-ceb4-4b6-a7ef-d2a2321357e5", "museum", "Estancias de Rafael", 41.902462005615234, 12.458354949951172],
  ["029bf1e2-d1e4-4cb2-850f-b20b7739d6a8", "attraction", "神廟遺址聖母堂", 41.898054122924805, 12.47833251953125],
  ["072185d8-4fa6-4669-b786-207f522461a4", "gallery", "Tiber Art", 41.89884376525879, 12.47097396850586],
  ["0135eb1b-1b31-4730-8148-42c07326a04c", "food", "Taverna delle Vacche", 41.899757385253906, 12.47057056427002],
  ["073db8a3-4e1b-479a-9cb1-e442cc45f23e", "attraction", "Auditorium del Tribunale di Sorveglianza", 41.90354919433594, 12.469017982482691],
  ["07648474-628c-489e-8996-ad7db0eb40fd", "food", "Idylio by Apreda", 41.898136138916016, 12.475848197937848],
  ["04425fdc-50bc-4416-b1b3-17b576a524ec", "historic", "Palazzo Mazzetti di Pietralata", 41.89999771118164, 12.476056098937988],
  ["05b44b2c-f6f5-5a66-96fc-96fc-96fc26e7d45f", "historic", "Curia di Pompeo", 41.89545822143555, 12.476537704467773],
  ["024adaf0-6537-447e-874a-d370ef4c2a85", "food", "La Pizza Di Wowlice", 41.896034240722656, 12.477867126464049],
  ["094b9362-4db4-94de-5d6e-98b2-bc6fe7d45f07", "attraction", "Hall Doria Pamphili", 41.88728141784668, 12.478519439697266],
  ["03a2d3d2-b320-4b51-bfe7-71f46fa37b43", "park", "Orange Park", 41.88523292541504, 12.480195999145508],
  ["055090e1-ce9a-43e8-93a8-237184c2029e", "food", "Caffè di Rienzo", 41.89883041381836, 12.475727081298828],
  ["02005300-7cff-4469-a615-a53f91ea2670", "gallery", "Canova22", 41.90732955932617, 12.47648811340332],
  ["00f84faa-834f-40e4-afaa-4a2c74d80c49", "park", "Roma, Villa Borghese", 41.910545349121094, 12.479140281677246]
];
const KIND_TOTALS = {
  market: 43, lighthouse: 2, museum: 326, gallery: 429, attraction: 1669,
  stay: 12314, park: 398, ferry: 1, station: 193, venue: 1522, food: 11534, historic: 1048
};
const TOTAL = Object.values(KIND_TOTALS).reduce((a, b) => a + b, 0);
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const firstPageKeys = JSON.parse(
  readFileSync(new URL("./fixtures/rome-pack-first-page-keys.json", import.meta.url), "utf8")
);
function romeRows(packId) {
  const rows = [];
  const usedKeys = new Set();
  const realByKind = {};
  for (const [tail, kind, name, lat, lon] of REAL) {
    const key = `overture:${tail}`;
    usedKeys.add(key);
    realByKind[kind] = (realByKind[kind] || 0) + 1;
    rows.push({
      pack_id: packId, candidate_key: key, osm_key: tail, kind, name, name_en: null,
      lat, lon, hours_raw: null, tags: { source_dataset: "overture-places-extract" }, url: key, enrichment: null
    });
  }
  const rand = mulberry32(20261109);
  const freePageKeys = firstPageKeys.filter((k) => !usedKeys.has(k));
  let pageIdx = 0;
  const nextKey = () => {
    if (pageIdx < freePageKeys.length) return freePageKeys[pageIdx++];
    for (;;) {
      const h = () => Math.floor(rand() * 0xffff).toString(16).padStart(4, "0");
      const key = `overture:${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
      if (key > firstPageKeys[999] && !usedKeys.has(key)) return key;
    }
  };
  let n = 0;
  for (const [kind, total] of Object.entries(KIND_TOTALS)) {
    const fillers = total - (realByKind[kind] || 0);
    for (let i = 0; i < fillers; i++) {
      const key = nextKey();
      usedKeys.add(key);
      rows.push({
        pack_id: packId, candidate_key: key, osm_key: key.slice("overture:".length), kind,
        name: `Rome ${kind} stop ${n}`, name_en: null,
        lat: 41.85 + rand() * 0.09, lon: 12.42 + rand() * 0.13,
        hours_raw: null, tags: { source_dataset: "overture-places-extract" }, url: key, enrichment: null
      });
      n += 1;
    }
  }
  return rows;
}
const DESTINATION = {
  destinationId: "dst-fb4b6d298e649289", displayName: "Rome", country: "Italy",
  centre: { lat: 41.8933203, lon: 12.4829321 },
  bbox: { minLat: 41.8383203, minLon: 12.4079321, maxLat: 41.9483203, maxLon: 12.5579321 },
  timeZone: "Europe/Rome", geocodeProvenance: { source: "probe", sourceRef: "probe", recordedAt: null, label: "fixture" }
};
const T0 = Date.parse("2026-11-09T12:00:00.000Z");

/* ---------------- the measured scenario --------------------------- */
const packVersionId = "packv-bykeys-1";
const packId = `row-${packVersionId}`;
const db = new PerfDb({
  roamly_destination_packs: [{
    id: packId, pack_version_id: packVersionId, destination_id: DESTINATION.destinationId,
    version: 1, schema_version: 1, classifier_version: "v1", status: "ready",
    built_at: "2026-11-09T00:00:00.000Z", candidate_count: TOTAL, counts_by_kind: {},
    content_hash: "hash-bykeys-1", supersedes_pack_version_id: null, build_job_id: null,
    provenance: { source: "overture-places-extract", sourceRef: "overture-extract:2026-10-21.0", recordedAt: null, label: "fixture" }
  }],
  roamly_destination_candidates: romeRows(packId),
  roamly_admin_settings: []
});
let clockMs = T0;
const clock = () => new Date(clockMs);
const store = () => new SupabasePackStore(db, clock);

// Wake 1 (uncounted): fallback pull + projection backfill.
await store().readPinned(packVersionId);

// The batch-1 wake: assemble (tier serve), then enrichment writes.
clockMs += 31 * 60_000;
db.resetLog();
const assembledPinned = await store().readPinned(packVersionId);
const heldCandidates = assembledPinned.candidates;
eq(heldCandidates.length, TOTAL, "assemble serves the whole pack");
const assembleBytes = db.totalBytes();

const finalistKeys = [
  "overture:84657dc6-a934-44db-99b0-39f630d957ea", // the Colosseum winner
  ...db.tables.roamly_destination_candidates.slice(40, 59).map((r) => r.candidate_key)
];
eq(finalistKeys.length, 20, "the batch enriched 20 finalists");
for (const key of finalistKeys) {
  await store().putCandidateEnrichment(packVersionId, key, { placeId: `g-${key.slice(-4)}`, rating: 4.5 });
}

// BEFORE: the pre-Stage-7 refresh — a full re-serve of the pack.
db.resetLog();
const beforeServe = await store().readPinned(packVersionId);
const beforeBytes = db.totalBytes();
const beforeQueries = db.log.length;
const beforeSettingsReads = db.log.filter((e) => e.table === "roamly_admin_settings" && e.kind === "select").length;

// AFTER: the Stage 7 refresh — by-keys re-read merged into the held set.
const parts = {
  pack: assembleEnginePack(DESTINATION, assembledPinned.version, heldCandidates, []),
  version: assembledPinned.version,
  destination: DESTINATION,
  candidates: heldCandidates,
  weatherDays: []
};
db.resetLog();
const refreshedParts = await refreshAssembledPackByKeys(store(), parts, finalistKeys);
const afterBytes = db.totalBytes();
const afterQueries = db.log.length;
ok(refreshedParts, "AFTER: the by-keys refresh returns a rebuilt pack");

console.log(`    assemble (tier serve): ${assembleBytes} bytes`);
console.log(`    BEFORE refresh (full re-serve): ${beforeBytes} bytes across ${beforeQueries} queries (${beforeSettingsReads} settings reads)`);
console.log(`    AFTER refresh (by-keys): ${afterBytes} bytes across ${afterQueries} queries`);
console.log(`    refresh delta: ${(beforeBytes / Math.max(1, afterBytes)).toFixed(1)}x fewer bytes`);

eq(beforeServe.candidates.length, TOTAL, "BEFORE: the full re-serve returns the whole pack");
ok(beforeBytes > 5_000_000, `BEFORE: the full re-serve costs the projection floor (${beforeBytes} bytes > 5 MB)`);
ok(afterBytes < 100_000, `AFTER: the by-keys refresh costs ${(afterBytes / 1024).toFixed(1)} KB (< 100 KB)`);
ok(afterBytes * 50 < beforeBytes, "AFTER: the refresh is at least 50x cheaper than the full re-serve");

/* ---------------- identity: merged set == full serve -------------- */
assert.deepStrictEqual(refreshedParts.candidates, beforeServe.candidates);
count += 1;
console.log("ok - the by-keys merged set is field-for-field identical to the full re-serve");
const winner = refreshedParts.candidates.find((c) => c.candidateKey === finalistKeys[0]);
eq(winner.enrichment?.placeId, "g-57ea", "the enriched Colosseum row carries its enrichment after the merge");
eq(
  refreshedParts.candidates.filter((c) => c.enrichment).length,
  20,
  "exactly the 20 finalists carry enrichment after the merge"
);

/* ---------------- itinerary output identity ------------------------ */
const ROME_REQUEST =
  "We are a couple traveling with our two kids, aged four and nine for a relaxed five day break. Please keep every day gentle, with no starts before ten and one slow morning with nothing booked at all. We need a room on a low floor with an elevator in the building and as few stairs as possible. I cannot eat shellfish and my partner is lactose intolerant, so please favor restaurants with clear allergen labels. Keep the total budget under one thousand eight hundred fifty dollars, avoid long walks between stops, and also include a visit to the Colosseum and a riverside or harbour walk in the morning please.";
function planOver(candidates) {
  const pack = assembleEnginePack(DESTINATION, assembledPinned.version, candidates, []);
  const extracted = extractConstraints(ROME_REQUEST);
  const mustSees = deriveMustSees({ specialNotes: ROME_REQUEST }, extracted, pack);
  const anchor = REAL[12];
  const plan = solveTrip(pack, {
    days: 5, startIso: "2026-11-12",
    dates: ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"],
    earliestMin: parseHhmm(extracted.earliestStart || "10:00") ?? 600,
    restSpec: extracted.rest ? { type: extracted.rest.type, text: extracted.rest.text } : null,
    mustSees, basePos: { lat: anchor[3], lon: anchor[4] }, baseName: anchor[2]
  });
  return {
    mustSeeResults: plan.mustSeeResults,
    days: (plan.daysOut || []).map((d) => (d.items || []).map((i) => [i.key, i.start, i.end, i.name || i.title || ""]))
  };
}
const planBefore = planOver(beforeServe.candidates);
const planAfter = planOver(refreshedParts.candidates);
assert.deepStrictEqual(planAfter, planBefore);
count += 1;
console.log("ok - the solver plan (must-sees + every day's items) is identical over the by-keys set");
eq(
  planAfter.mustSeeResults.find((r) => r.label === "a visit to the Colosseum")?.status,
  "scheduled",
  "the Colosseum still schedules from the refreshed set"
);

/* ---------------- unit pins ---------------------------------------- */
{
  const held = [
    { candidateKey: "k1", enrichment: null },
    { candidateKey: "k2", enrichment: null }
  ];
  const merged = mergeRefreshedCandidates(held, [{ candidateKey: "k2", enrichment: { rating: 5 } }]);
  eq(merged.length, 2, "merge never drops a held row");
  eq(merged[0].enrichment, null, "merge leaves unrefreshed rows untouched");
  eq(merged[1].enrichment.rating, 5, "merge replaces the refreshed row");
  const noop = mergeRefreshedCandidates(held, []);
  assert.deepStrictEqual(noop, held);
  count += 1;
  console.log("ok - an empty refresh is an identity merge");
}
{
  // Chunking + unknown keys + unknown version.
  const keys = db.tables.roamly_destination_candidates.slice(0, 250).map((r) => r.candidate_key);
  db.resetLog();
  const rows = await store().getVersionCandidatesByKeys(packVersionId, [...keys, "overture:does-not-exist"]);
  eq(rows.length, 250, "by-keys returns exactly the existing keys asked for");
  const candSelects = db.log.filter((e) => e.table === "roamly_destination_candidates" && e.kind === "select").length;
  eq(candSelects, 2, "251 keys are read in two chunked selects (200 + 51)");
  await assert.rejects(() => store().getVersionCandidatesByKeys("packv-nope", ["k"]), /no pack version/);
  count += 1;
  console.log("ok - an unknown version fails loudly (VERSION_NOT_FOUND)");
  const bare = await refreshAssembledPackByKeys({}, parts, finalistKeys);
  eq(bare, null, "a store without a by-keys read makes the refresh decline (caller falls back to full serve)");
  const empty = await refreshAssembledPackByKeys(store(), parts, []);
  eq(empty, null, "an empty key set declines the by-keys refresh");
}

/* ---------------- wiring pin --------------------------------------- */
{
  const source = readFileSync(new URL("../lib/roamly/engine/generate.ts", import.meta.url), "utf8");
  const enrichAt = source.indexOf("enrichPackFinalists");
  const byKeysAt = source.indexOf("refreshAssembledPackByKeys", enrichAt);
  const fallbackAt = source.indexOf("assemblePinnedPackForTrip(deps, state.tripId, state.payload, run)", byKeysAt);
  ok(enrichAt > 0 && byKeysAt > enrichAt && fallbackAt > byKeysAt,
    "generate.ts: the day-batch refresh tries by-keys first, full re-assemble as fallback");
}

console.log(`\npack-by-keys-refresh: ${count} checks passed.`);
console.log("PASS roamly-pack-by-keys-refresh-checks");
process.exit(0);
