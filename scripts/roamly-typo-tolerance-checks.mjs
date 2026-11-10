// Typo tolerance checks (2026-11-09, owner requirement:
// "there should be a consideration in typo errors and still land
// on the nearest place to it. the app is not super intelligent
// enough.").
//
// The named-place requirement path demanded the traveller's
// EXACT spelling: "Coloseum", "Versaills", "Eifel Towr" produced
// the honest gap even when the real place sat in the
// destination's own data. The fix is ONE fuzzy tier
// (lib/roamly/engine/placeNameMatch.ts) consulted by all three
// name-matching consumers — the solver's grounding match, the
// staged verification pass, the annotation reconciliation — only
// after every exact tier has failed, and only for pure
// named-place anchors (requiredNameAnchor). Its law, pinned
// here: high similarity (length-scaled Damerau budget on
// normText-folded names) + a UNIQUE clear winner (whole-name
// preference breaks ties) + a GENUINE place (a name-trading shell
// — "Colosseum Apartments" — never receives the ask). Anything
// less certain keeps the honest gap: a wrong landing is worse
// than no landing.
//
// Fixtures: the Rome cases reuse the REAL deciding records from
// the Rome landmark fixture (the ten "Colosseum"-named pool
// candidates, the walking-tours record, the "Riverside" venue —
// Overture extract, release 2026-10-21.0) in a Rome-shaped pack;
// the Paris cases reuse the Europe-findings fixture shape.
import assert from "node:assert/strict";
import { extractConstraints, mustSeeRequirement } from "@/lib/roamly/engine/understand.ts";
import { deriveMustSees } from "@/lib/roamly/engine/generate.ts";
import { solveTrip } from "@/lib/roamly/engine/solver.ts";
import { parseHhmm } from "@/lib/roamly/engine/util.ts";
import { damerauDistance, fuzzyMaxDistance, fuzzyPlaceWinner, placeNameKey } from "@/lib/roamly/engine/placeNameMatch.ts";
import { verifyStagedMustDos } from "@/lib/roamly/stagedMustDoVerification.ts";
import { evaluateMustDoVerdicts } from "@/lib/roamly/mustDoReconciliation.ts";

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}

function cand(key, name, kind, lat, lon) {
  return { key, name, kind, pos: { lat, lon }, hoursRaw: null, tags: {}, url: "", google: null };
}

/* ---------------- Part A: the distance + the budget ------------ */
{
  eq(damerauDistance("coloseum", "colosseum"), 1, "A1 one missing letter costs 1");
  eq(damerauDistance("versaills", "versailles"), 1, "A2 one missing letter in a long name costs 1");
  eq(damerauDistance("colosseumm", "colosseum"), 1, "A3 one doubled letter costs 1");
  eq(damerauDistance("versialles", "versailles"), 1, "A4 one adjacent transposition costs 1 (Damerau)");
  eq(damerauDistance("eifel", "eiffel"), 1, "A5 one inserted letter costs 1");
  ok(damerauDistance("zorblaxian", "colosseum") > 2, "A6 an invented name is far from every real one");
  eq(fuzzyMaxDistance("rom"), 0, "A7 a 3-letter needle gets NO fuzzy tier");
  eq(fuzzyMaxDistance("castl"), 1, "A8 a 5-letter needle allows 1 edit");
  eq(fuzzyMaxDistance("abcdef"), 1, "A9 a 6-letter needle allows 1 edit");
  eq(fuzzyMaxDistance("versaills"), 2, "A10 a long needle allows 2 edits");
  eq(placeNameKey("Café de Flore"), "cafe de flore", "A11 folding: case + accents + punctuation, as the exact tier folds");
}

/* ---------------- Part B: the winner rules, unit level --------- */
{
  const named = (...names) => names.map((name) => ({ name }));
  eq(fuzzyPlaceWinner(["coloseum"], named("Colosseum"))?.name, "Colosseum", "B1 a lone near name lands");
  eq(
    fuzzyPlaceWinner(["coloseum"], named("Colosseum Apartments", "Colosseum"))?.name,
    "Colosseum",
    "B2 typo'd or not, the place itself beats the building trading on its name"
  );
  eq(
    fuzzyPlaceWinner(["coloseum"], named("Colosseum Apartments")),
    null,
    "B3 the name-trading building ALONE never receives the ask — honest gap instead"
  );
  eq(
    fuzzyPlaceWinner(["versaills"], named("Palace of Versailles"))?.name,
    "Palace of Versailles",
    "B4 a part-name landing on the genuine record (the ask's word is the place's own last word)"
  );
  eq(
    fuzzyPlaceWinner(["versaills"], named("Palace of Versailles", "Versailles"))?.name,
    "Versailles",
    "B5 among near names, the WHOLE-name record wins over the longer containing name"
  );
  eq(
    fuzzyPlaceWinner(["castl"], named("Castel Nuovo", "Castel Gandolfo")),
    null,
    "B6 a typo sitting between two real places refuses — the word identifies neither"
  );
  eq(
    fuzzyPlaceWinner(["castl"], named("Castel Nuovo"))?.name,
    "Castel Nuovo",
    "B7 the same typo lands when only one real place carries the word"
  );
  eq(
    fuzzyPlaceWinner(["zorblaxian", "obelisk"], named("Colosseum", "Palace of Versailles")),
    null,
    "B8 an invented place stays unmet — similarity to nothing is nothing"
  );
  eq(
    fuzzyPlaceWinner(["micael"], named("About Rome - Best walking tours with Micaela")),
    null,
    "B9 one word buried in a long junk name cannot capture the ask (coverage guard)"
  );
  eq(
    fuzzyPlaceWinner(["eifel", "louvre"], named("Eiffel Tower", "Louvre Museum")),
    null,
    "B10 two needles crowning two different places is ambiguity — refuse"
  );
  eq(fuzzyPlaceWinner(["rom"], named("Rome")), null, "B11 short needles never fuzz");
}

/* ---------------- Part C: Rome, end to end through the solver -- */

// The REAL deciding records (verbatim from the Rome landmark
// fixture; Overture extract 2026-10-21.0).
const ROME_REAL = [
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
  ["bd469c11-2f54-4044-a50b-a4ba639b6c35", "venue", "Riverside", 41.93400192260742, 12.53580379486084]
];
function romePack({ withColosseum = true } = {}) {
  const sights = ROME_REAL.filter((r) => withColosseum || !/^Colosseum$/.test(r[2])).map(([key, kind, name, lat, lon]) =>
    cand(key, name, kind, lat, lon)
  );
  return {
    destination: "Rome",
    country: "Italy",
    center: { lat: 41.8933203, lon: 12.4829321 },
    counts: { total: sights.length + 1, sights: sights.length, foods: 0, stays: 1, transport: 0 },
    stays: [cand("06aa459c-5660-4d1a-a8ca-42dc5cb6a52b", "Salvo Pennisi  Pantheon selfies page", "stay", 41.89699745178223, 12.47525691986084)],
    sights,
    excursions: [],
    foods: [],
    transport: [],
    weather: []
  };
}
const ROME_REQUEST =
  "We are a couple traveling with our two kids, aged four and nine for a relaxed five day break. Please keep every day gentle, with no starts before ten and one slow morning with nothing booked at all. We need a room on a low floor with an elevator in the building and as few stairs as possible. I cannot eat shellfish and my partner is lactose intolerant, so please favor restaurants with clear allergen labels. Keep the total budget under one thousand eight hundred fifty dollars, avoid long walks between stops, and also include a visit to the Colosseum and a riverside or harbour walk in the morning please.";
const ROME_TYPO_REQUEST = ROME_REQUEST.replace("the Colosseum", "the Coloseum");
function solveRome(pack, request) {
  const extracted = extractConstraints(request);
  const mustSees = deriveMustSees({ specialNotes: request }, extracted, pack);
  const plan = solveTrip(pack, {
    days: 5,
    startIso: "2026-11-12",
    dates: ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"],
    earliestMin: parseHhmm(extracted.earliestStart || "10:00") ?? 600,
    restSpec: extracted.rest ? { type: extracted.rest.type, text: extracted.rest.text } : null,
    mustSees,
    basePos: { lat: 41.89699745178223, lon: 12.47525691986084 },
    baseName: "Salvo Pennisi  Pantheon selfies page"
  });
  return { mustSees, plan };
}

{
  // The precondition that made the typo fatal: no record's name
  // contains the traveller's spelling — every exact tier misses.
  ok(
    ROME_REAL.every((r) => !r[2].toLowerCase().includes("coloseum")),
    "C0 precondition: the typo'd spelling appears in NO record name (the exact tiers cannot see it)"
  );
  const { mustSees, plan } = solveRome(romePack(), ROME_TYPO_REQUEST);
  const spec = mustSees.find((m) => /Coloseum/.test(m.label));
  ok(spec, "C1 the typo'd ask derives into a must-see");
  eq(spec.requiredNameAnchor, true, "C1 the typo'd ask carries the named-place anchor (the fuzzy tier's gate)");
  const ms = plan.mustSeeResults.find((r) => r.id === spec.id);
  eq(ms.status, "scheduled", "C2 'Coloseum' now LANDS — scheduled, not the honest gap");
  eq(ms.item, "Colosseum", "C2 the plan carries the record's TRUE name, never the traveller's typo");
  eq(ms.itemKey, "84657dc6-a934-44db-99b0-39f630d957ea", "C2 the landing is the exact-name Colosseum record itself");
  ok(
    plan.days.some((d) => d.items.some((i) => i.key === ms.itemKey)),
    "C2 the Colosseum record is scheduled into a day of the plan"
  );
  const walk = plan.mustSeeResults.find((r) => /harbour walk/.test(r.label));
  eq(walk.status, "scheduled", "C3 the walk ask is untouched by the fuzzy tier — kind semantics as before");
  eq(walk.item, "About Rome - Best walking tours with Micaela", "C3 the walk still lands on the real walking-tours record");
}

{
  // The name-trading trap, end to end: remove the place itself
  // and the typo'd ask must go honestly unmet — never onto the
  // apartments building that trades on the name.
  const { mustSees, plan } = solveRome(romePack({ withColosseum: false }), ROME_TYPO_REQUEST);
  const spec = mustSees.find((m) => /Coloseum/.test(m.label));
  const ms = plan.mustSeeResults.find((r) => r.id === spec.id);
  eq(ms.status, "unmet", "C4 with the Colosseum itself absent, the typo'd ask stays UNMET");
  ok(ms.item === undefined, "C4 'Colosseum Apartments' does NOT receive the ask");
}

/* ---------------- Part D: Paris — Versailles + the tower ------- */
function parisPack(withVersailles) {
  const sights = [
    cand("node/101", "Louvre Museum", "museum", 48.8611, 2.3364),
    cand("node/103", "Histoire des Plantes", "museum", 48.8439, 2.3596),
    cand("node/104", "Eiffel Tower", "tower", 48.8584, 2.2945),
    cand("node/105", "Jardin du Luxembourg", "park", 48.8462, 2.3372),
    cand("node/109", "Café de Flore", "attraction", 48.854, 2.339)
  ];
  const excursions = withVersailles ? [cand("way/900", "Palace of Versailles", "palace", 48.8049, 2.1204)] : [];
  return {
    destination: "Paris",
    country: "France",
    center: { lat: 48.8566, lon: 2.3522 },
    counts: { total: sights.length + excursions.length + 1, sights: sights.length, foods: 0, stays: 1, transport: 0 },
    stays: [cand("node/100", "Hôtel des Nations Saint-Germain", "stay", 48.849, 2.344)],
    sights,
    excursions,
    foods: [],
    transport: [],
    weather: []
  };
}
function solveParis(pack, request) {
  const extracted = extractConstraints(request);
  const mustSees = deriveMustSees({ specialNotes: request }, extracted, pack);
  const plan = solveTrip(pack, {
    days: 4,
    startIso: "2026-11-09",
    dates: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"],
    earliestMin: 510,
    restSpec: { type: "morning", text: "one slow morning with nothing booked" },
    mustSees,
    basePos: { lat: 48.849, lon: 2.344 },
    baseName: "Hôtel des Nations Saint-Germain",
    calendar: null
  });
  return { mustSees, plan };
}
const PARIS_REQUEST =
  "We are a couple on our first ever trip to Paris for a relaxed four day break. Please keep every day gentle, with no starts before eight thirty and one slow morning with nothing booked at all. We need a building with an elevator and quiet streets at night. I am vegetarian, so please favor restaurants with clear vegetarian menus. Keep the total budget under two thousand eight hundred dollars, avoid long walks between stops, and also include one full museum day at the Louvre and a day trip to Versailles if it fits the plan please.";

{
  const typo = PARIS_REQUEST.replace("Versailles", "Versaills");
  const { mustSees, plan } = solveParis(parisPack(true), typo);
  const spec = mustSees.find((m) => /Versaills/.test(m.label));
  ok(spec, "D1 the typo'd Versailles ask derives into a must-see");
  const r = plan.mustSeeResults.find((x) => x.id === spec.id);
  eq(r.status, "scheduled", "D1 'Versaills' LANDS when the place is in the data");
  eq(r.item, "Palace of Versailles", "D1 the landing is Versailles itself, under its true name");
  const louvre = plan.mustSeeResults.find((x) => /Louvre/.test(x.label));
  eq(louvre.status, "scheduled", "D1 the exact-spelled Louvre ask is unaffected");
  eq(louvre.item, "Louvre Museum", "D1 the Louvre match is the Louvre itself");

  const noData = solveParis(parisPack(false), typo);
  const spec2 = noData.mustSees.find((m) => /Versaills/.test(m.label));
  const r2 = noData.plan.mustSeeResults.find((x) => x.id === spec2.id);
  eq(r2.status, "unmet", "D2 'Versaills' with no Versailles in the data stays honestly UNMET");
  ok(r2.item === undefined, "D2 the plant museum does not receive the typo'd ask either");
}

{
  // Both tower words mistyped: no exact needle survives, so this
  // landing is the fuzzy tier's alone (phrase + token agreement).
  const label = "a visit to the Eifel Towr";
  const req = mustSeeRequirement(label);
  eq(req.patterns.join(","), "eifel,towr", "D3 the double-typo ask anchors on its own (misspelled) name");
  eq(req.nameAnchor, true, "D3 the anchor flag is set");
  const pack = parisPack(false);
  const result = solveTrip(pack, {
    days: 4,
    startIso: "2026-11-09",
    dates: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"],
    earliestMin: 510,
    restSpec: null,
    mustSees: [{ id: "ms-x", label, patterns: [label, "eifel towr", "eifel", "towr"], requiredPatterns: req.patterns, requiredKinds: req.kinds, requiredNameAnchor: true }],
    basePos: { lat: 48.849, lon: 2.344 },
    baseName: "Hôtel des Nations Saint-Germain",
    calendar: null
  });
  eq(result.mustSeeResults[0].status, "scheduled", "D3 'Eifel Towr' LANDS through the fuzzy tier");
  eq(result.mustSeeResults[0].item, "Eiffel Tower", "D3 the landing is the Eiffel Tower under its true name");
}

{
  // The single-typo tower ask, through the full request path:
  // the surviving exact word may serve it — either way the
  // traveller lands on the real tower, never a namesake.
  const typoTower = PARIS_REQUEST.replace(
    "a day trip to Versailles if it fits the plan",
    "a visit to the Eifel Tower"
  );
  const { mustSees, plan } = solveParis(parisPack(true), typoTower);
  const spec = mustSees.find((m) => /Eifel/.test(m.label));
  ok(spec, "D4 the 'Eifel Tower' ask derives into a must-see");
  const r = plan.mustSeeResults.find((x) => x.id === spec.id);
  eq(r.status, "scheduled", "D4 'Eifel Tower' lands on a real tower");
  eq(r.item, "Eiffel Tower", "D4 the landing is the Eiffel Tower itself");
}

{
  // Accent/case variants belong to the EXACT tier (normText
  // folds both sides): the unaccented ask lands on the accented
  // record without the fuzzy tier ever being consulted.
  const cafeReq = PARIS_REQUEST.replace(
    "a day trip to Versailles if it fits the plan",
    "a visit to the Cafe de Flore"
  );
  const { mustSees, plan } = solveParis(parisPack(false), cafeReq);
  const spec = mustSees.find((m) => /Cafe de Flore/.test(m.label));
  ok(spec, "D5 the unaccented café ask derives into a must-see");
  const r = plan.mustSeeResults.find((x) => x.id === spec.id);
  eq(r.status, "scheduled", "D5 the unaccented spelling lands through the exact tier's folding");
  eq(r.item, "Café de Flore", "D5 the landing carries the record's true (accented) name");
}

/* ---------------- Part E: ambiguity + the gate, solver level --- */
function naplesPack(withGandolfo) {
  const sights = [
    cand("node/201", "Castel Nuovo", "castle", 40.838, 14.253),
    ...(withGandolfo ? [cand("node/202", "Castel Gandolfo", "castle", 41.747, 12.65)] : []),
    cand("node/203", "Spring Creek", "park", 40.85, 14.27)
  ];
  return {
    destination: "Naples",
    country: "Italy",
    center: { lat: 40.8522, lon: 14.2681 },
    counts: { total: sights.length + 1, sights: sights.length, foods: 0, stays: 1, transport: 0 },
    stays: [cand("node/200", "Naples Stay", "stay", 40.852, 14.268)],
    sights,
    excursions: [],
    foods: [],
    transport: [],
    weather: []
  };
}
function solveSpec(pack, spec) {
  return solveTrip(pack, {
    days: 3,
    startIso: "2026-11-09",
    dates: ["2026-11-09", "2026-11-10", "2026-11-11"],
    earliestMin: 540,
    restSpec: null,
    mustSees: [spec],
    basePos: { lat: 40.852, lon: 14.268 },
    baseName: "Naples Stay",
    calendar: null
  });
}
{
  const label = "a visit to Castl";
  const req = mustSeeRequirement(label);
  const spec = { id: "ms-c", label, patterns: [label, "castl"], requiredPatterns: req.patterns, requiredKinds: req.kinds, requiredNameAnchor: true };
  const two = solveSpec(naplesPack(true), spec);
  eq(two.mustSeeResults[0].status, "unmet", "E1 a typo between two real places stays UNMET at solver level");
  const one = solveSpec(naplesPack(false), spec);
  eq(one.mustSeeResults[0].status, "scheduled", "E2 the same typo lands when one real place carries the word");
  eq(one.mustSeeResults[0].item, "Castel Nuovo", "E2 the landing is Castel Nuovo itself");

  // The gate: a head-noun-shaped requirement (no name anchor)
  // NEVER fuzzes — "springs" must not drift onto "Spring Creek".
  const springsSpec = { id: "ms-s", label: "one hot springs soak", patterns: ["springs"], requiredPatterns: ["springs"], requiredKinds: [] };
  const springs = solveSpec(naplesPack(false), springsSpec);
  eq(springs.mustSeeResults[0].status, "unmet", "E3 a head-noun requirement never fuzzes onto a near-named creek");
}

/* ---------------- Part F: the staged + reconciliation paths ---- */
function stagedItinerary(activityTitle, locationName) {
  return {
    daily_itinerary: [
      {
        primary_plan: "Day one in Rome.",
        live_timeline: [
          {
            title: activityTitle,
            location_name: locationName,
            description: "",
            estimated_cost: null,
            category: "Attraction",
            map_query: activityTitle,
            item_type: "activity",
            time_label: "10:00"
          }
        ],
        must_do_items: []
      }
    ]
  };
}
{
  const payload = { destination: "Rome", specialNotes: ROME_TYPO_REQUEST, interests: [] };
  const results = verifyStagedMustDos(stagedItinerary("Colosseum", "Colosseum, Rome"), payload);
  const v = results.find((r) => /Coloseum/.test(r.label));
  ok(v, "F1 the typo'd ask derives a staged must-do");
  eq(v.status, "satisfied", "F1 the staged path satisfies the typo'd ask from the real activity (fuzzy tier)");
  eq(v.item, "Colosseum", "F1 the satisfying activity is the Colosseum under its true name");

  const trap = verifyStagedMustDos(stagedItinerary("Colosseum Apartments", "Via del Colosseo"), payload);
  const tv = trap.find((r) => /Coloseum/.test(r.label));
  eq(tv.status, "unmet", "F2 the staged path refuses the name-trading building for the typo'd ask");

  const emptyPack = {
    destination: "Rome", country: "", center: { lat: 0, lon: 0 },
    counts: { total: 0, sights: 0, foods: 0, stays: 0, transport: 0 },
    stays: [], sights: [], excursions: [], foods: [], transport: [], weather: []
  };
  const extracted = extractConstraints(ROME_TYPO_REQUEST);
  const specs = deriveMustSees(payload, extracted, emptyPack);
  const verdicts = evaluateMustDoVerdicts(stagedItinerary("Colosseum", "Colosseum, Rome"), specs);
  const rv = verdicts.find((r) => /Coloseum/.test(r.label));
  eq(rv.status, "satisfied", "F3 the reconciliation evaluation satisfies the typo'd ask from the real activity");
  eq(rv.item, "Colosseum", "F3 the satisfying activity is the Colosseum itself");
}

console.log(`TYPO-TOLERANCE CHECKS: ${count}/${count} PASS`);
