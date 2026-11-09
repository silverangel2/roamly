// Rome landmark checks (2026-11-09, daily test — Rome, Italy).
//
// The production failure: a family asked for "a visit to the
// Colosseum" on a 5-day Rome trip, and the plan named it as an
// honest gap — "the open place data for Rome has no verified
// match for it" — when the Colosseum plainly exists in Roamly's
// own data. Two defects composed into that sentence:
//
//   1. THE TRUNCATED PACK READ (the root cause). Rome's pack is
//      built by the Overture extract lane and holds 29,479
//      candidates. SupabasePackStore.getVersionCandidates read
//      them back with ONE unbounded PostgREST select, which the
//      server silently caps at 1,000 rows. The solver therefore
//      received only the first 1,000 candidates in candidate_key
//      order — for Overture keys ("overture:<uuid>") a
//      lexicographic slice holding 206 of 5,438 sight-pool
//      candidates and NONE of the ten "Colosseum"-named ones.
//      The signature is exact: every candidate key in the
//      production itinerary (trip 539937e2-da36-4893-962a-65877306af97)
//      sits inside that first page. Pinned here: the store read
//      is paginated over the unique candidate_key order, and the
//      Rome-shaped pack below reads back WHOLE.
//
//   2. THE NAME-TRADING TIE. With the full pack visible, the
//      must-see's best-match tied between the candidate named
//      "Colosseum" (the place itself) and "Colosseum Apartments"
//      (a building trading on the name — same requirement, same
//      needle), and pool order (candidate_key) put the apartments
//      first. Pinned here: a candidate whose whole name IS a
//      required pattern outranks one that merely contains it, so
//      the visit lands on the place itself.
//
// The honesty rails are pinned too: an invented place
// ("Zorblaxian Obelisk") in the same request shape stays
// honestly UNMET and named — visibility must never become
// invention.
//
// Fixture honesty: the Rome pack below is Rome-SHAPED, built
// from the real extract lane's output for dst-fb4b6d298e649289
// (Overture release 2026-10-21.0): the real candidate total
// (29,479), the real per-kind mix, the REAL first-1,000
// candidate keys (scripts/fixtures/rome-pack-first-page-keys.json
// — the exact page production was limited to), and the records
// that decide this case embedded VERBATIM from the real
// classification (the ten "Colosseum"-named pool candidates,
// the two walk-needle candidates, and all 18 candidates the
// production itinerary actually used). The remaining rows are
// filler with innocuous names on the remaining real keys /
// synthetic keys beyond the first-page boundary.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeDb } from "./roamly-egress-diet-fake.mjs";
import { SupabasePackStore } from "@/lib/roamly/engine/packs/supabaseStore.ts";
import { assembleEnginePack, candidateRowToDTO } from "@/lib/roamly/engine/packs/builder.ts";
import { extractConstraints, namedMustSeeMiss } from "@/lib/roamly/engine/understand.ts";
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

/* A FakeDb whose candidate-table selects behave like PostgREST:
 * a select with NO explicit range is silently capped at 1,000
 * rows (the server max-rows default). An explicit .range() is
 * honoured — which is exactly the behaviour difference the fix
 * relies on. */
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

function packRow(packVersionId, candidateCount) {
  return {
    id: `row-${packVersionId}`,
    pack_version_id: packVersionId,
    destination_id: "dst-fixture",
    version: 1,
    schema_version: 1,
    classifier_version: "v1",
    status: "ready",
    built_at: "2026-11-09T00:00:00.000Z",
    candidate_count: candidateCount,
    counts_by_kind: {},
    content_hash: `hash-${packVersionId}`,
    supersedes_pack_version_id: null,
    build_job_id: null,
    provenance: {}
  };
}
function candidateRow(packId, i, name, kind) {
  const key = `overture:${i.toString(16).padStart(8, "0")}-0000-4000-8000-${String(i).padStart(12, "0")}`;
  return {
    pack_id: packId,
    candidate_key: key,
    osm_key: key.slice("overture:".length),
    kind,
    name,
    name_en: null,
    lat: 45.5,
    lon: -73.5,
    hours_raw: null,
    tags: {},
    url: key,
    enrichment: null
  };
}

/* ---------------- Part A: the paginated read ---------------- */
{
  // A1: 2,500 candidates — more than two PostgREST pages.
  const rows = Array.from({ length: 2500 }, (_, i) => candidateRow("row-packv-a1", i, `Place ${i}`, "attraction"));
  rows[2499] = { ...candidateRow("row-packv-a1", 2499, "Colosseum", "attraction") };
  const db = new PostgrestDb({
    roamly_destination_packs: [packRow("packv-a1", 2500)],
    roamly_destination_candidates: rows
  });
  const store = new SupabasePackStore(db);
  const all = await store.getVersionCandidates("packv-a1");
  eq(all.length, 2500, "A1: a 2,500-candidate pack reads back whole, not capped at 1,000");
  ok(all.some((c) => c.name === "Colosseum"), "A1: the candidate beyond the old cap is present");
  const selectsAfterFirst = db.log.filter((e) => e.table === "roamly_destination_candidates" && e.kind === "select").length;
  const again = await new SupabasePackStore(db).getVersionCandidates("packv-a1");
  eq(again.length, 2500, "A1: cached second read still returns the whole set");
  eq(
    db.log.filter((e) => e.table === "roamly_destination_candidates" && e.kind === "select").length,
    selectsAfterFirst,
    "A1: cached second read issues no new candidate selects (egress law unchanged)"
  );

  // A2: an exact multiple of the page size — the loop must take
  // the final empty page and still return everything.
  const rows2 = Array.from({ length: 2000 }, (_, i) => candidateRow("row-packv-a2", i, `Place ${i}`, "museum"));
  const db2 = new PostgrestDb({
    roamly_destination_packs: [packRow("packv-a2", 2000)],
    roamly_destination_candidates: rows2
  });
  eq((await new SupabasePackStore(db2).getVersionCandidates("packv-a2")).length, 2000, "A2: exact page multiple (2,000) reads back whole");

  // A3: a small pack — one page, exactly one select, as before.
  const rows3 = Array.from({ length: 3 }, (_, i) => candidateRow("row-packv-a3", i, `Place ${i}`, "museum"));
  const db3 = new PostgrestDb({
    roamly_destination_packs: [packRow("packv-a3", 3)],
    roamly_destination_candidates: rows3
  });
  eq((await new SupabasePackStore(db3).getVersionCandidates("packv-a3")).length, 3, "A3: small pack reads back whole");
  eq(
    db3.log.filter((e) => e.table === "roamly_destination_candidates" && e.kind === "select").length,
    1,
    "A3: small pack still costs exactly one candidate select"
  );
}

/* ---------------- Part B: Rome, end to end ---------------- */

const ROME_REQUEST =
  "We are a couple traveling with our two kids, aged four and nine for a relaxed five day break. Please keep every day gentle, with no starts before ten and one slow morning with nothing booked at all. We need a room on a low floor with an elevator in the building and as few stairs as possible. I cannot eat shellfish and my partner is lactose intolerant, so please favor restaurants with clear allergen labels. Keep the total budget under one thousand eight hundred fifty dollars, avoid long walks between stops, and also include a visit to the Colosseum and a riverside or harbour walk in the morning please.";

// Records embedded VERBATIM from the real Rome classification
// (Overture extract, release 2026-10-21.0): the ten pool
// candidates whose names contain "colosseum", the two pool
// candidates matching the walk ask's needles, and every
// candidate the production itinerary used (the anchor stay
// first). [candidateKey tail, kind, name, lat, lon]
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
  ["0497fffa-1ac4-477d-a8d6-5814f945b00e", "food", "Zucchero e Farina", 41.899003982543945, 12.466676712036133],
  ["0611f98b-ceb4-49b6-a7ef-d2a2321357e5", "museum", "Estancias de Rafael", 41.902462005615234, 12.458354949951172],
  ["029bf1e2-d1e4-4cb2-850f-b20b7739d6a8", "attraction", "神廟遺址聖母堂", 41.898054122924805, 12.47833251953125],
  ["072185d8-4fa6-4669-b786-207f522461a4", "gallery", "Tiber Art", 41.89884376525879, 12.47097396850586],
  ["0135eb1b-1b31-4730-8148-42c07326a04c", "food", "Taverna delle Vacche", 41.899757385253906, 12.47057056427002],
  ["073db8a3-4e1b-479a-9cb1-e442cc45f23e", "attraction", "Auditorium del Tribunale di Sorveglianza", 41.90354919433594, 12.46901798248291],
  ["07648474-628c-489e-8996-ad7db0eb40fd", "food", "Idylio by Apreda", 41.898136138916016, 12.475848197937012],
  ["04425fdc-50bc-4416-b1b3-17b576a524ec", "historic", "Palazzo Mazzetti di Pietralata", 41.89999771118164, 12.476056098937988],
  ["05b44b2c-f6f5-4a66-96fc-60064731726e", "historic", "Curia di Pompeo", 41.89545822143555, 12.476537704467773],
  ["024adaf0-6537-447e-874a-d370ef4c2a85", "food", "La Pizza Di Wowlice", 41.896034240722656, 12.477867126464844],
  ["094b9362-4db4-47b2-94de-5d6e9bd513cb", "attraction", "Hall Doria Pamphili", 41.88728141784668, 12.478519439697266],
  ["03a2d3d2-b320-4b51-bfe7-71f46fa37b43", "park", "Orange Park", 41.88523292541504, 12.480195999145508],
  ["055090e1-ce9a-43e8-93a8-237184c2029e", "food", "Caffè di Rienzo", 41.89883041381836, 12.475727081298828],
  ["02005300-7cff-4469-a615-a53f91ea2670", "gallery", "Canova22", 41.90732955932617, 12.47648811340332],
  ["00f84faa-834f-40e4-afaa-4a2c74d80c49", "park", "Roma, Villa Borghese", 41.910545349121094, 12.479140281677246]
];
const COLOSSEUM_KEYS = REAL.slice(0, 10).map((r) => `overture:${r[0]}`);
const PRODUCTION_KEYS = REAL.slice(12).map((r) => `overture:${r[0]}`);

// The real pack's per-kind totals (extract classification
// evidence) — the fixture reproduces the mix exactly.
const KIND_TOTALS = {
  market: 43, lighthouse: 2, museum: 326, gallery: 429, attraction: 1669,
  stay: 12314, park: 398, ferry: 1, station: 193, venue: 1522, food: 11534, historic: 1048
};
const TOTAL = Object.values(KIND_TOTALS).reduce((a, b) => a + b, 0);
eq(TOTAL, 29479, "B0: fixture kind mix sums to the real Rome candidate total");

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
eq(firstPageKeys.length, 1000, "B0: the real first page holds exactly 1,000 keys");
eq(firstPageKeys[999], "overture:095b57e9-823f-4034-836f-9740cf05539d", "B0: the real first page ends where production's slice ended");
// The production signature, on the fixture's real key material:
// every candidate the production itinerary used is inside the
// page it was limited to; none of the Colosseum candidates is.
{
  const pageSet = new Set(firstPageKeys);
  ok(PRODUCTION_KEYS.every((k) => pageSet.has(k)), "B0: all 18 production candidate keys sit inside the real first page");
  ok(COLOSSEUM_KEYS.every((k) => !pageSet.has(k)), "B0: none of the 10 Colosseum candidate keys sits inside the real first page");
}

const PACK_ID = "row-packv-rome";
const rows = [];
const usedKeys = new Set();
const realByKind = {};
for (const [tail, kind, name, lat, lon] of REAL) {
  const key = `overture:${tail}`;
  usedKeys.add(key);
  realByKind[kind] = (realByKind[kind] || 0) + 1;
  rows.push({
    pack_id: PACK_ID,
    candidate_key: key,
    osm_key: tail,
    kind,
    name,
    name_en: null,
    lat,
    lon,
    hours_raw: null,
    tags: { source_dataset: "overture-places-extract" },
    url: key,
    enrichment: null
  });
}
{
  // Fillers: the remaining real first-page keys first (so the
  // page's key composition is the real one), then synthetic keys
  // strictly beyond the first-page boundary.
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
        pack_id: PACK_ID,
        candidate_key: key,
        osm_key: key.slice("overture:".length),
        kind,
        name: `Rome ${kind} stop ${n}`,
        name_en: null,
        lat: 41.85 + rand() * 0.09,
        lon: 12.42 + rand() * 0.13,
        hours_raw: null,
        tags: { source_dataset: "overture-places-extract" },
        url: key,
        enrichment: null
      });
      n += 1;
    }
  }
}
eq(rows.length, TOTAL, "B0: fixture pack holds the real candidate total");

const romePackRow = {
  ...packRow("packv-rome-2026-11-09", TOTAL),
  id: PACK_ID,
  destination_id: "dst-fb4b6d298e649289",
  provenance: {
    source: "overture-places-extract",
    sourceRef: "overture-extract:2026-10-21.0",
    recordedAt: null,
    label: "Overture Maps Places — prebuilt extract (fixture)"
  }
};
const db = new PostgrestDb({
  roamly_destination_packs: [romePackRow],
  roamly_destination_candidates: rows
});
const pinned = await new SupabasePackStore(db).readPinned("packv-rome-2026-11-09");
ok(pinned !== null, "B1: the pinned Rome pack reads back");
eq(pinned.candidates.length, TOTAL, "B1: readPinned returns ALL 29,479 candidates (pre-fix: 1,000)");
ok(
  COLOSSEUM_KEYS.every((k) => pinned.candidates.some((c) => c.candidateKey === k)),
  "B1: all ten Colosseum-named candidates are visible to the solver now"
);

// Provenance of the winning record: a verified place record —
// name, real coordinates, source named (the extract lane).
const winner = pinned.candidates.find((c) => c.osmKey === "84657dc6-a934-44db-99b0-39f630d957ea");
ok(winner !== undefined, "B2: the exact-name Colosseum record is in the read set");
const winnerDto = candidateRowToDTO(winner, null);
eq(winnerDto.provenance.source, "overture", "B2: the record's source is Overture");
ok(
  winnerDto.provenance.label.includes("prebuilt Overture Places extract"),
  "B2: the record's provenance names the prebuilt Overture Places extract"
);
eq(winnerDto.pos.lat, 41.89939880371094, "B2: the record carries its real latitude");
eq(winnerDto.pos.lon, 12.476815223693848, "B2: the record carries its real longitude");

const destination = {
  destinationId: "dst-fb4b6d298e649289",
  displayName: "Rome",
  country: "Italy",
  centre: { lat: 41.8933203, lon: 12.4829321 },
  bbox: { minLat: 41.8383203, minLon: 12.4079321, maxLat: 41.9483203, maxLon: 12.5579321 },
  timeZone: "Europe/Rome",
  geocodeProvenance: { source: "probe", sourceRef: "probe", recordedAt: null, label: "fixture" }
};
const pack = assembleEnginePack(destination, { legMatrix: null, dto: { destinationId: destination.destinationId, builtAt: null } }, pinned.candidates, []);
const anchor = REAL[12];
function solve(request) {
  const extracted = extractConstraints(request);
  const mustSees = deriveMustSees({ specialNotes: request }, extracted, pack);
  const plan = solveTrip(pack, {
    days: 5,
    startIso: "2026-11-12",
    dates: ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"],
    earliestMin: parseHhmm(extracted.earliestStart || "10:00") ?? 600,
    restSpec: extracted.rest ? { type: extracted.rest.type, text: extracted.rest.text } : null,
    mustSees,
    basePos: { lat: anchor[3], lon: anchor[4] },
    baseName: anchor[2]
  });
  return { mustSees, plan };
}

{
  const { plan } = solve(ROME_REQUEST);
  const ms1 = plan.mustSeeResults.find((r) => r.label === "a visit to the Colosseum");
  ok(ms1 !== undefined, "B3: the Colosseum must-see was derived from the request");
  eq(ms1.status, "scheduled", "B3: the Colosseum visit is BUILT, not named as a gap");
  eq(ms1.item, "Colosseum", "B3: the visit is the place itself, not a name-trading namesake");
  eq(ms1.itemKey, "84657dc6-a934-44db-99b0-39f630d957ea", "B3: the visit is the exact-name Colosseum record");
  ok(
    plan.days.some((d) => d.items.some((i) => i.key === ms1.itemKey)),
    "B3: the Colosseum record is scheduled into a day of the plan"
  );
  // The walk ask: Rome is inland — no harbour exists in its
  // data, and the only "Riverside" record is a music venue whose
  // name is a word-match the requirement gate refuses. What the
  // full pack restores is the engine's standing kind semantics:
  // a real walking-tours record names the asked kind ("walk")
  // and satisfies it. (The harbour/riverside qualifier itself
  // matches no Rome place — reported as such in the fix report;
  // this suite pins only that the satisfaction is a real,
  // requirement-passing record, never an invented place.)
  const ms2 = plan.mustSeeResults.find((r) => r.label === "a riverside or harbour walk in the morning");
  ok(ms2 !== undefined, "B4: the walk must-see was derived from the request");
  eq(ms2.status, "scheduled", "B4: the walk ask is satisfied by a real record once the pack is whole");
  eq(ms2.item, "About Rome - Best walking tours with Micaela", "B4: the walk lands on the real walking-tours record");
}

{
  // Honesty: an invented place in the same request shape stays
  // unmet and named — full visibility is not invention.
  const invented = ROME_REQUEST.replace("a visit to the Colosseum", "a visit to the Zorblaxian Obelisk");
  const { plan } = solve(invented);
  const ms = plan.mustSeeResults.find((r) => r.label === "a visit to the Zorblaxian Obelisk");
  ok(ms !== undefined, "B5: the invented-place must-see was derived");
  eq(ms.status, "unmet", "B5: the invented place stays honestly unmet");
  ok(
    namedMustSeeMiss(ms.label, "Rome").includes("Zorblaxian Obelisk"),
    "B5: the honest-gap sentence names the invented place"
  );
  ok(
    !plan.days.some((d) => d.items.some((i) => /zorblaxian/i.test(i.name || ""))),
    "B5: no invented place appears anywhere in the plan"
  );
}

console.log(`ROME LANDMARK CHECKS: ${count} passed`);
