// Stage 7 Colosseum tight-run watch (2026-11-11).
//
// The Nov 10 post-ship watch item: a fresh 3-day / same-day-start /
// SHORT-ask Rome generation MISSED the Colosseum, while the exact
// PR #116 parameters (5 days, Nov 13–17, the long ask that NAMES
// the Colosseum) HIT it. This suite discriminates the factor over
// the full Rome-shaped fixture (29,479 candidates, the
// pack-read-perf fixture), driving the same derivation + solver
// the engine drives (deriveMustSees from generate.ts, solveTrip):
//
//   A  control — the PR #116 configuration: long ask naming the
//      Colosseum, 5 days. The Colosseum must-see must schedule.
//   B  the tight run as recorded: a SHORT generic ask naming NO
//      landmark, 3 days. Question: is a Colosseum must-see even
//      derived? Is the Colosseum scheduled as an ordinary sight?
//      What fills the days instead?
//   B' tight days + the Colosseum NAMED please-first ("Please
//      include a visit…"), 3 days.
//   B"' tight days + the Colosseum named include-first ("Include
//      a visit… please"), 3 days.
//   B" the short unnamed ask at 5 days.
//
// VERDICT (Stage 7): DEFECT, found + fixed. Day count does NOT
// discriminate. The discriminator is the ASK's word order against
// the production extractor (understand.ts extractConstraints,
// the same function deriveSolveContext runs over the traveller's
// notes): place items were extracted ONLY from an
// "include … please" clause, so the natural please-first form
// derived no must-see at all — silently (the miss sits in the
// extractor's unresolved list, shown to no traveller). The
// extractor now accepts both orders; B' pins the fix, B"' pins
// the legacy order, B/B" pin that an unnamed landmark is never
// derived at any day count (the scarcity half of the story: no
// ask, no guarantee). The desire-phrased form ("we would love to
// visit…") still derives nothing — logged as a watch observation
// in this suite's output, not asserted, not fixed here.
//
// The production ask text of the tight run is not in the lane
// records; B models it faithfully from the record's own words
// ("3-day, same-day start, short ask"). The factor space — ask vs
// days — is covered either way.
//
// Evidence tier: SIMULATED (fixture solver runs, the tier the
// PR #116 proof itself used).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeDb } from "./roamly-egress-diet-fake.mjs";
import { SupabasePackStore } from "@/lib/roamly/engine/packs/supabaseStore.ts";
import { assembleEnginePack } from "@/lib/roamly/engine/packs/builder.ts";
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

/* ---------------- Rome fixture (from the pack-read-perf suite) ---- */
const REAL = [
  ["84657dc6-a934-44db-99b0-39f630d957ea", "attraction", "Colosseum", 41.89939880371094, 12.476815223693848],
  ["fc36ed3f-c3ba-496e-9db6-0be818dad9ba", "historic", "Colosseum", 41.894575119018555, 12.480901718139648],
  ["fda9d253-c738-4c53-b1f9-74e4dda4eb1e", "venue", "Colosseum", 41.890193939208984, 12.492244720458984],
  ["758acc19-c516-42ab-9907-108389975c4e", "historic", "Colosseum Apartments", 41.89181900024414, 12.499799728393555],
  ["06aa459c-5660-4d1a-a8ca-42dc5cb6a52b", "stay", "Salvo Pennisi  Pantheon selfies page", 41.89699745178223, 12.47525691986084]
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
const packVersionId = "packv-colosseum-watch";
const packId = `row-${packVersionId}`;
const db = new PostgrestDb({
  roamly_destination_packs: [{
    id: packId, pack_version_id: packVersionId, destination_id: DESTINATION.destinationId,
    version: 1, schema_version: 1, classifier_version: "v1", status: "ready",
    built_at: "2026-11-09T00:00:00.000Z", candidate_count: TOTAL, counts_by_kind: {},
    content_hash: "hash-colosseum-watch", supersedes_pack_version_id: null, build_job_id: null,
    provenance: { source: "overture-places-extract", sourceRef: "overture-extract:2026-10-21.0", recordedAt: null, label: "fixture" }
  }],
  roamly_destination_candidates: romeRows(packId),
  roamly_admin_settings: []
});
const store = new SupabasePackStore(db, () => new Date("2026-11-10T12:00:00.000Z"));
const pinned = await store.readPinned(packVersionId);
eq(pinned.candidates.length, TOTAL, "the fixture pack serves whole (29,479 candidates)");
const pack = assembleEnginePack(DESTINATION, pinned.version, pinned.candidates, []);

/* ---------------- the four configurations -------------------------- */
const LONG_ASK =
  "We are a couple traveling with our two kids, aged four and nine for a relaxed five day break. Please keep every day gentle, with no starts before ten and one slow morning with nothing booked at all. We need a room on a low floor with an elevator in the building and as few stairs as possible. I cannot eat shellfish and my partner is lactose intolerant, so please favor restaurants with clear allergen labels. Keep the total budget under one thousand eight hundred fifty dollars, avoid long walks between stops, and also include a visit to the Colosseum and a riverside or harbour walk in the morning please.";
const SHORT_ASK =
  "A relaxed three day break in Rome for two. Keep it gentle, no early starts, mid-range budget.";
const SHORT_ASK_NAMED =
  "A relaxed three day break in Rome for two. Keep it gentle, no early starts, mid-range budget. Please include a visit to the Colosseum.";
const SHORT_ASK_NAMED_LEGACY_ORDER =
  "A relaxed three day break in Rome for two. Keep it gentle, no early starts, mid-range budget. Include a visit to the Colosseum please.";

function dates(startIso, n) {
  const out = [];
  const base = new Date(`${startIso}T12:00:00Z`);
  for (let i = 0; i < n; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
function runConfig(label, ask, startIso, days) {
  const extracted = extractConstraints(ask);
  const mustSees = deriveMustSees({ specialNotes: ask }, extracted, pack);
  const anchor = REAL[4];
  const plan = solveTrip(pack, {
    days, startIso,
    dates: dates(startIso, days),
    earliestMin: parseHhmm(extracted.earliestStart || "10:00") ?? 600,
    restSpec: extracted.rest ? { type: extracted.rest.type, text: extracted.rest.text } : null,
    mustSees, basePos: { lat: anchor[3], lon: anchor[4] }, baseName: anchor[2]
  });
  const colosseumMustSee = plan.mustSeeResults.find((r) => /colosseum/i.test(r.label));
  const scheduledNames = (plan.days || []).flatMap((d) => (d.items || []).map((i) => i.name || i.title || ""));
  const colosseumScheduled = scheduledNames.filter((n) => n === "Colosseum");
  const summary = {
    label,
    mustSeesDerived: plan.mustSeeResults.map((r) => `${r.label} -> ${r.status}`),
    colosseumMustSee: colosseumMustSee ? colosseumMustSee.status : "(not derived)",
    colosseumScheduledCount: colosseumScheduled.length,
    scheduledCount: scheduledNames.length,
    scheduledNames
  };
  console.log(`\n--- ${label}`);
  console.log(`    must-sees: ${JSON.stringify(summary.mustSeesDerived)}`);
  console.log(`    colosseum must-see: ${summary.colosseumMustSee}; scheduled as sight x${summary.colosseumScheduledCount}; total items ${summary.scheduledCount}`);
  console.log(`    scheduled: ${JSON.stringify(scheduledNames)}`);
  return summary;
}

const A = runConfig("A control: long ask naming the Colosseum, 5 days, Nov 13-17", LONG_ASK, "2026-11-13", 5);
eq(A.colosseumMustSee, "scheduled", "A: the PR #116 configuration schedules the Colosseum must-see (control holds)");

const B = runConfig("B tight run: short ask, no landmark named, 3 days, same-day start", SHORT_ASK, "2026-11-10", 3);
eq(B.colosseumMustSee, "(not derived)", "B: the short ask derives NO Colosseum must-see — there was nothing to miss");

const Bp = runConfig("B' tight days + Colosseum named PLEASE-FIRST, 3 days", SHORT_ASK_NAMED, "2026-11-10", 3);
eq(Bp.colosseumMustSee, "scheduled", "B': at the SAME 3 days, the please-first ask now derives + schedules the Colosseum (Stage 7 extractor fix)");

const Bppp = runConfig("B''' tight days + Colosseum named include-first, 3 days", SHORT_ASK_NAMED_LEGACY_ORDER, "2026-11-10", 3);
eq(Bppp.colosseumMustSee, "scheduled", "B''': the original include…please order still derives + schedules (no regression)");

/* Extractor pins: the word-order rule itself. */
{
  const named = extractConstraints(SHORT_ASK_NAMED);
  ok((named.placeItems || []).some((i) => /colosseum/i.test(i)), "extractor: please-first derives the Colosseum place item");
  const legacy = extractConstraints(SHORT_ASK_NAMED_LEGACY_ORDER);
  ok((legacy.placeItems || []).some((i) => /colosseum/i.test(i)), "extractor: include…please order derives the Colosseum place item");
  const unnamed = extractConstraints(SHORT_ASK);
  eq((unnamed.placeItems || []).length, 0, "extractor: an ask naming nothing derives no place items");
  const loveTo = extractConstraints("A relaxed three day break in Rome for two. We would love to visit the Colosseum.");
  console.log(`    note: desire-phrased named place ("we would love to visit…") derives ${JSON.stringify(loveTo.placeItems || [])} / ${JSON.stringify(loveTo.mustSeeDesires || [])} — recorded as a watch observation, not asserted`);
}

const Bpp = runConfig("B\" short unnamed ask, 5 days", SHORT_ASK, "2026-11-13", 5);
eq(Bpp.colosseumMustSee, "(not derived)", "B\": more days do not derive a must-see the ask never stated");
console.log(`\nB\" colosseum as ordinary sight: x${Bpp.colosseumScheduledCount} (3-day B: x${B.colosseumScheduledCount}) — without a must-see nothing guarantees the landmark at any day count`);

console.log(`\ncolosseum-tight-run: ${count} checks passed.`);
console.log("PASS roamly-colosseum-tight-run-checks");
process.exit(0);
