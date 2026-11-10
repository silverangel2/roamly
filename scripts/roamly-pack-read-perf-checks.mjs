// Pack-read perf checks (2026-11-09) — the cost repair for the
// Rome fix (PR #116).
//
// The defect this pins against: PR #116 made
// SupabasePackStore.getVersionCandidates read a pack WHOLE
// (paginated, after the silent 1,000-row cap truncated Rome).
// Correct — and expensive: Rome's 29,479 candidates cost 30
// sequential page selects and ~11.6 MB of fixture-shaped egress
// PER PULL, and staged generation pulls once per stage wake
// (outline, one batch per day, a post-enrichment refresh,
// finalization — eight pulls for a five-day trip), because
// wakes are separate invocations and the memory/disk cache
// tiers only serve wakes landing in a warm process inside the
// TTL. Measured pre-fix on this fixture (instrumented fake):
// a five-day Rome generation, all wakes cold, paid 260
// candidate selects / 235,852 rows / 92.4 MB; all wakes warm,
// 80 selects / 23.1 MB.
//
// The repair (all inside SupabasePackStore): a SOLVER
// PROJECTION TIER — the candidate base layer tuple-encoded in
// the house settings table, hash-validated by the version's
// content_hash (which hashes exactly the base layer,
// enrichment excluded), with enrichment overlaid live from a
// targeted IS NOT NULL read; materialized at publish and
// backfilled after a paginated pull; plus a column-projected,
// wave-parallel paginated fallback. This suite pins:
//   A1  a pack with no projection reads whole via the fallback
//       and backfills its projection;
//   A2  the tier serves a field-for-field identical set in ONE
//       settings read (+ one empty overlay page);
//   A3  the Colosseum still schedules from the tier-served set;
//   A4  enrichment written after the projection exists is
//       served by the overlay, not by a re-pull;
//   A5  a moved content_hash refuses the stale projection,
//       falls back, and re-backfills under the new hash;
//   A6  a malformed projection refuses and falls back;
//   A7  small packs still cost exactly one select, and a
//       candidate_count that lies low cannot truncate the read;
//   A8  publishVersion materializes the projection;
//   B1  the five-day generation read pattern, all wakes cold,
//       now costs single-digit settings reads and ~zero
//       candidate-table egress (was: 260 selects / 92.4 MB).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeDb } from "./roamly-egress-diet-fake.mjs";
import { SupabasePackStore } from "@/lib/roamly/engine/packs/supabaseStore.ts";
import { assembleEnginePack } from "@/lib/roamly/engine/packs/builder.ts";
import { candidateContentHash } from "@/lib/roamly/engine/packs/store.ts";
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

/* PostgREST-shaped fake: a select with NO explicit range is
 * silently capped at 1,000 rows; explicit ranges are honoured —
 * the exact behaviour the paginated read relies on. */
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

/* The shared fake does not model PostgREST's
 * return=representation on writes (update().select() yields no
 * rows), which publishVersion's flip relies on. Model it here,
 * locally to this suite: an update chain that asked for a select
 * returns the matched rows, projected. */
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
      // Capture matches BEFORE the write applies: after an
      // update, the row may no longer match its own filters
      // (the publish flip matches status="building" and writes
      // status="ready") — PostgREST returns the updated rows.
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

const candSelects = (db) => db.log.filter((e) => e.table === "roamly_destination_candidates" && e.kind === "select");
const candRows = (db) => candSelects(db).reduce((s, e) => s + e.rows, 0);
const settingsSelects = (db) => db.log.filter((e) => e.table === "roamly_admin_settings" && e.kind === "select");

/* ---------------- Rome fixture (verbatim from the landmark suite) ---------------- */
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
  ["05b44b2c-f6f5-5a66-96fc-60064731726e", "historic", "Curia di Pompeo", 41.89545822143555, 12.476537704467773],
  ["024adaf0-6537-447e-874a-d370ef4c2a85", "food", "La Pizza Di Wowlice", 41.896034240722656, 12.477867126464844],
  ["094b9362-4db4-94de-5d6e9bd513cb", "attraction", "Hall Doria Pamphili", 41.88728141784668, 12.478519439697266],
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
function romePackRow(packVersionId, packId, hash, candidateCount = TOTAL) {
  return {
    id: packId, pack_version_id: packVersionId, destination_id: "dst-fb4b6d298e649289",
    version: 1, schema_version: 1, classifier_version: "v1", status: "ready",
    built_at: "2026-11-09T00:00:00.000Z", candidate_count: candidateCount, counts_by_kind: {},
    content_hash: hash, supersedes_pack_version_id: null, build_job_id: null,
    provenance: { source: "overture-places-extract", sourceRef: "overture-extract:2026-10-21.0", recordedAt: null, label: "Overture Maps Places — prebuilt extract (fixture)" }
  };
}
function romeDb(packVersionId, hash) {
  const packId = `row-${packVersionId}`;
  return new PostgrestDb({
    roamly_destination_packs: [romePackRow(packVersionId, packId, hash)],
    roamly_destination_candidates: romeRows(packId)
  });
}
const T0 = Date.parse("2026-11-09T12:00:00.000Z");
function wakes() {
  let ms = T0;
  return {
    clock: () => new Date(ms),
    advance: () => { ms += 31 * 60_000; }
  };
}

/* ---------------- A1 + A2 + A3 + A4: fallback, backfill, tier identity, overlay ---------------- */
{
  const w = wakes();
  const db = romeDb("packv-perf-a", "hash-perf-a");
  const store = () => new SupabasePackStore(db, w.clock);

  const fallbackSet = await store().getVersionCandidates("packv-perf-a");
  eq(fallbackSet.length, TOTAL, "A1: no projection -> the fallback still reads the pack whole");
  eq(candSelects(db).length, 30, "A1: the fallback pull is 30 page selects (one wave-planned pass)");
  eq(candRows(db), TOTAL, "A1: the fallback pull returns every row");
  const projRows = (db.tables.roamly_admin_settings || []).filter((r) => r.key === "pack_projection:v1:packv-perf-a");
  eq(projRows.length, 1, "A1: the pull backfilled exactly one projection row");
  eq(projRows[0].value.contentHash, "hash-perf-a", "A1: the backfilled projection carries the version's content hash");
  eq(projRows[0].value.rows.length, TOTAL, "A1: the backfilled projection holds every candidate");

  w.advance();
  db.resetLog();
  const tierSet = await store().getVersionCandidates("packv-perf-a");
  eq(tierSet.length, TOTAL, "A2: the tier serves the whole set");
  eq(settingsSelects(db).length, 1, "A2: the tier serve is ONE settings read");
  eq(candSelects(db).length, 1, "A2: the only candidate-table read is the enrichment overlay page");
  eq(candRows(db), 0, "A2: the overlay is empty before any enrichment exists");
  assert.deepStrictEqual(tierSet, fallbackSet);
  count += 1;
  console.log("ok - A2: the tier-served set is field-for-field identical to the fallback set");

  // A3: the Colosseum solves from the tier-served set.
  const destination = {
    destinationId: "dst-fb4b6d298e649289", displayName: "Rome", country: "Italy",
    centre: { lat: 41.8933203, lon: 12.4829321 },
    bbox: { minLat: 41.8383203, minLon: 12.4079321, maxLat: 41.9483203, maxLon: 12.5579321 },
    timeZone: "Europe/Rome", geocodeProvenance: { source: "probe", sourceRef: "probe", recordedAt: null, label: "fixture" }
  };
  const pack = assembleEnginePack(destination, { legMatrix: null, dto: { destinationId: destination.destinationId, builtAt: null } }, tierSet, []);
  const ROME_REQUEST =
    "We are a couple traveling with our two kids, aged four and nine for a relaxed five day break. Please keep every day gentle, with no starts before ten and one slow morning with nothing booked at all. We need a room on a low floor with an elevator in the building and as few stairs as possible. I cannot eat shellfish and my partner is lactose intolerant, so please favor restaurants with clear allergen labels. Keep the total budget under one thousand eight hundred fifty dollars, avoid long walks between stops, and also include a visit to the Colosseum and a riverside or harbour walk in the morning please.";
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
  const ms1 = plan.mustSeeResults.find((r) => r.label === "a visit to the Colosseum");
  eq(ms1.status, "scheduled", "A3: the Colosseum visit is BUILT from the tier-served set");
  eq(ms1.itemKey, "84657dc6-a934-44db-99b0-39f630d957ea", "A3: the visit is the exact-name Colosseum record");

  // A4: enrichment lands after the projection exists -> overlay serves it.
  const colosseumKey = "overture:84657dc6-a934-44db-99b0-39f630d957ea";
  await store().putCandidateEnrichment("packv-perf-a", colosseumKey, { placeId: "g-colosseum", rating: 4.7 });
  w.advance();
  db.resetLog();
  const overlaid = await store().getVersionCandidates("packv-perf-a");
  eq(overlaid.length, TOTAL, "A4: the overlaid set is still whole");
  eq(candSelects(db).length, 1, "A4: one overlay page read, no re-pull");
  eq(candRows(db), 1, "A4: the overlay carries exactly the enriched row");
  const winner = overlaid.find((c) => c.candidateKey === colosseumKey);
  eq(winner.enrichment?.placeId, "g-colosseum", "A4: the enriched record serves its enrichment from the overlay");
  eq(winner.enrichment?.rating, 4.7, "A4: the overlay enrichment is the written record, whole");
  ok(
    overlaid.filter((c) => c.enrichment !== null).length === 1,
    "A4: no other candidate gained enrichment from the overlay"
  );
}

/* ---------------- A5: a moved hash refuses, falls back, re-backfills ---------------- */
{
  const w = wakes();
  const db = romeDb("packv-perf-b", "hash-perf-b1");
  const store = () => new SupabasePackStore(db, w.clock);
  await store().getVersionCandidates("packv-perf-b"); // fallback + backfill under hash-b1
  db.tables.roamly_destination_packs[0].content_hash = "hash-perf-b2";
  w.advance();
  db.resetLog();
  const afterMove = await store().getVersionCandidates("packv-perf-b");
  eq(afterMove.length, TOTAL, "A5: a moved hash still serves the whole set");
  eq(candSelects(db).length, 30, "A5: the stale projection was refused — the paginated fallback served");
  // The fake's upsert appends; production's replaces. Model
  // production: keep only the newest projection row for the key.
  const key = "pack_projection:v1:packv-perf-b";
  const all = db.tables.roamly_admin_settings.filter((r) => r.key === key);
  eq(all.length, 2, "A5: the fallback re-backfilled under the new hash");
  eq(all[all.length - 1].value.contentHash, "hash-perf-b2", "A5: the new projection carries the new hash");
  db.tables.roamly_admin_settings = db.tables.roamly_admin_settings.filter((r) => r.key !== key);
  db.tables.roamly_admin_settings.push(all[all.length - 1]);
  w.advance();
  db.resetLog();
  const served = await store().getVersionCandidates("packv-perf-b");
  eq(served.length, TOTAL, "A5: the re-backfilled projection serves the whole set");
  eq(candSelects(db).length, 1, "A5: after re-backfill the tier serves again (overlay page only)");
}

/* ---------------- A6: a malformed projection refuses ---------------- */
{
  const w = wakes();
  const db = romeDb("packv-perf-c", "hash-perf-c");
  db.tables.roamly_admin_settings = [
    { key: "pack_projection:v1:packv-perf-c", value: { v: 1, contentHash: "hash-perf-c", rows: "not-an-array" } }
  ];
  const store = () => new SupabasePackStore(db, w.clock);
  const set = await store().getVersionCandidates("packv-perf-c");
  eq(set.length, TOTAL, "A6: a malformed projection still serves the whole set");
  eq(candSelects(db).length, 30, "A6: the malformed projection was refused — the fallback served");
}

/* ---------------- A7: small packs + a lying candidate_count ---------------- */
{
  const w = wakes();
  const smallRow = (packVersionId, packId, n, countClaim) => ({
    id: packId, pack_version_id: packVersionId, destination_id: "dst-small", version: 1,
    schema_version: 1, classifier_version: "v1", status: "ready", built_at: "2026-11-09T00:00:00.000Z",
    candidate_count: countClaim, counts_by_kind: {}, content_hash: `hash-${packVersionId}`,
    supersedes_pack_version_id: null, build_job_id: null, provenance: {}
  });
  const smallCandidates = (packId, n) =>
    Array.from({ length: n }, (_, i) => ({
      pack_id: packId, candidate_key: `osm:node/${1000 + i}`, osm_key: `node/${1000 + i}`, kind: "museum",
      name: `Small place ${i}`, name_en: null, lat: 45.5, lon: -73.5, hours_raw: null, tags: {}, url: "", enrichment: null
    }));
  const dbSmall = new PostgrestDb({
    roamly_destination_packs: [smallRow("packv-perf-small", "row-small", 3, 3)],
    roamly_destination_candidates: smallCandidates("row-small", 3)
  });
  const small = await new SupabasePackStore(dbSmall, w.clock).getVersionCandidates("packv-perf-small");
  eq(small.length, 3, "A7: a small pack reads back whole");
  eq(candSelects(dbSmall).length, 1, "A7: a small pack still costs exactly one candidate select");

  const dbLie = new PostgrestDb({
    roamly_destination_packs: [smallRow("packv-perf-lie", "row-lie", 2500, 3)],
    roamly_destination_candidates: smallCandidates("row-lie", 2500)
  });
  const lie = await new SupabasePackStore(dbLie, w.clock).getVersionCandidates("packv-perf-lie");
  eq(lie.length, 2500, "A7: a candidate_count that lies low cannot truncate the read (termination is proven by the data)");
}

/* ---------------- A8: publishVersion materializes the projection ---------------- */
{
  const w = wakes();
  const buildingRow = {
    id: "row-pub", pack_version_id: "packv-perf-pub", destination_id: "dst-perf-publish",
    version: 1, schema_version: 1, classifier_version: "v1", status: "building",
    built_at: null, candidate_count: 0, counts_by_kind: {}, content_hash: null,
    supersedes_pack_version_id: null, build_job_id: "job-perf",
    provenance: { source: "fixture", sourceRef: "fixture", recordedAt: null, label: "fixture" }
  };
  const jobRow = {
    job_id: "job-perf", destination_id: "dst-perf-publish", status: "building",
    lease_id: "lease-perf", lease_expires_at: "2027-01-01T00:00:00.000Z",
    requested_by: "perf-checks", reason: "pack-read-perf", created_at: "2026-11-09T00:00:00.000Z",
    updated_at: "2026-11-09T00:00:00.000Z", started_at: "2026-11-09T00:00:00.000Z",
    finished_at: null, error: null, pack_version_id: "packv-perf-pub"
  };
  const db = new PerfDb({
    roamly_destination_packs: [buildingRow], roamly_destination_candidates: [],
    roamly_destination_pack_builds: [jobRow], roamly_admin_settings: []
  });
  const store = new SupabasePackStore(db, w.clock);
  const candidates = Array.from({ length: 5 }, (_, i) => ({
    candidateKey: `osm:node/${2000 + i}`, osmKey: `node/${2000 + i}`, kind: "museum",
    name: `Published place ${i}`, nameEn: null, pos: { lat: 45.5, lon: -73.5 },
    hoursRaw: null, tags: {}, url: "", enrichment: null
  }));
  const published = await store.publishVersion("packv-perf-pub", "job-perf", "lease-perf", candidates, {
    source: "fixture", sourceRef: "pack-read-perf", recordedAt: null, label: "fixture collection"
  });
  eq(published.dto.status, "ready", "A8: the publish completes");
  const key = "pack_projection:v1:packv-perf-pub";
  const proj = (db.tables.roamly_admin_settings || []).filter((r) => r.key === key);
  eq(proj.length, 1, "A8: publish materialized exactly one projection row");
  eq(proj[0].value.contentHash, candidateContentHash(candidates), "A8: the projection carries the published set's content hash");
  eq(proj[0].value.rows.length, 5, "A8: the projection holds every published candidate");
  w.advance();
  db.resetLog();
  const served = await new SupabasePackStore(db, w.clock).getVersionCandidates("packv-perf-pub");
  eq(served.length, 5, "A8: the published pack serves whole from its projection");
  eq(candRows(db), 0, "A8: the tier serve reads zero candidate rows (empty overlay page only)");
}

/* ---------------- B1: the five-day generation pattern, all wakes cold ---------------- */
{
  const w = wakes();
  const db = romeDb("packv-perf-gen", "hash-perf-gen");
  const store = () => new SupabasePackStore(db, w.clock);
  await store().readPinned("packv-perf-gen"); // first-ever read: fallback + backfill (not counted)
  w.advance(); // the outline wake is a separate, cold invocation
  db.resetLog();
  // The engine's per-wake pattern (advanceEngineGeneration): one
  // assemble per wake; batch 1 adds the enrich service's read
  // (same wake — memory-cache hit), twenty enrichment writes
  // (each invalidates the cache), and the refresh re-assemble.
  await store().readPinned("packv-perf-gen"); // outline
  w.advance();
  await store().readPinned("packv-perf-gen"); // batch 1 assemble
  await store().getVersionCandidates("packv-perf-gen"); // enrich read (same wake)
  const finalistKeys = db.tables.roamly_destination_candidates.slice(0, 20).map((r) => r.candidate_key);
  for (const k of finalistKeys) {
    await store().putCandidateEnrichment("packv-perf-gen", k, { placeId: "g-1", rating: 4.5 });
  }
  const refreshed = await store().readPinned("packv-perf-gen"); // batch 1 refresh
  for (let i = 0; i < 4; i++) { w.advance(); await store().readPinned("packv-perf-gen"); } // batches 2-5
  w.advance();
  const fin = await store().readPinned("packv-perf-gen"); // finalization
  eq(refreshed.candidates.length, TOTAL, "B1: the batch-1 refresh still assembles the whole pack");
  eq(fin.candidates.length, TOTAL, "B1: finalization still assembles the whole pack");
  eq(settingsSelects(db).length, 8, "B1: eight tier serves — one settings read per cold wake");
  eq(candSelects(db).length, 28, "B1: candidate selects collapse from 260 to 28 (8 overlay pages + 20 enrichment reads)");
  eq(candRows(db), 140, "B1: candidate rows collapse from 235,852 to 140 (the enriched finalists only)");
  const candBytes = candSelects(db).reduce((s, e) => s + (e.bytes || 0), 0);
  ok(candBytes < 1_000_000, `B1: candidate-table egress collapses from ~92.4 MB to ${(candBytes / 1e6).toFixed(2)} MB`);
  ok(db.totalBytes() < 70_000_000, `B1: total generation read egress ${Math.round(db.totalBytes() / 1e6)} MB < 70 MB (was 92.4 MB fixture / ~112 MB production-shaped)`);
  console.log(`    B1 totals: queries=${db.log.length} bytes=${db.totalBytes()} (settings serves carry the projection; candidate lane ~zero)`);
}

console.log(`PACK-READ PERF CHECKS: ${count} passed`);
