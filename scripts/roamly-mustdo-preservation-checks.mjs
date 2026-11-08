// Roamly must-do preservation checks (2026-10-30, Banff daily test):
// the exact 107-word Banff request asked to "include the gondola
// ride up Sulphur Mountain and an afternoon at the hot springs
// please". The stored production itinerary contained ZERO mentions
// of a gondola, yet scheduled "Sulphur Mountain Cosmic Ray Station"
// — the attraction at the summit the gondola serves. Trace (file/
// line evidence in verification/gondola-results.md): extraction
// found the ask (understand.ts placeItems), deriveMustSees turned
// it into a must-see, but mustSeePatterns derived an OR pattern set
// from the label's place CONTEXT ("sulphur mountain", "sulphur",
// "mountain"), and the solver's best-match counted the summit
// station as satisfying the must-see — so it never surfaced as
// unmet and the named-miss sentence never fired. The gondola was
// silently substituted by a related attraction.
//
// The fix is general (no destination/experience hardcoding): a
// must-do label's lowercase head kind noun(s) ("gondola", "ferry",
// "museum"…) become a solver requirement — a candidate satisfies
// the must-do only when it names that experience/kind itself or
// carries its kind. Otherwise the must-do is honestly UNMET and
// named in the day words via namedMustSeeMiss. These checks pin:
//   1. The exact Banff request: extraction + derivation carry the
//      gondola must-do WITH its head-noun requirement; against a
//      Banff-shaped pack whose data names no gondola (the local /
//      recorded-data reality — the collectors carry no aerialway
//      candidate), the must-do is UNMET with the related-places
//      reason, and the named-miss sentence names the gondola.
//      (Local tests cannot call production AI; this proves the
//      extraction + verification layer, which is where the defect
//      lived — the engine is deterministic, no AI is involved.)
//   2. Same Banff request, pack whose data DOES name the ride:
//      the must-do schedules as the explicit gondola activity.
//   3. A generic non-Banff must-do (invented: a cable car ride in
//      a fictional harbour town pack, and a ferry requirement)
//      is preserved/flagged the same way.
//   4. A substituted related attraction does NOT satisfy the
//      check: the summit station alone leaves the must-do unmet
//      (§1/§3), and the saved production itinerary itself records
//      the substitution — the station is stamped in must_do_items
//      while "gondola" appears nowhere in the document.
//   5. Regression on the saved evidence: earliest start >= 10:00,
//      the day-3 rest block, and the hot-springs outcome against
//      the real saved itinerary.json remain intact, and the
//      hot-springs must-do still schedules against the Banff pack.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractConstraints, mustSeeRequirement, namedMustSeeMiss } from "@/lib/roamly/engine/understand.ts";
import { deriveMustSees } from "@/lib/roamly/engine/generate.ts";
import { solveTrip } from "@/lib/roamly/engine/solver.ts";

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}

const BANFF_REQUEST =
  "We are a couple who love the mountains but not early alarms for a slow four day break. Please keep every day gentle, with no starts before ten and one full rest afternoon in the middle. We need a room with an elevator in the building and gentle paths only, as my knee cannot handle steep hikes. I am dairy free and my partner is vegetarian, so please favor restaurants with clear plant based options. Keep the total budget under one thousand five hundred dollars, avoid long walks between stops, and also include the gondola ride up Sulphur Mountain and an afternoon at the hot springs please.";

function cand(key, name, kind, lat, lon) {
  return { key, name, kind, pos: { lat, lon }, hoursRaw: null, tags: {}, url: "", google: null };
}
function banffPack(extraSights = []) {
  const sights = [
    cand("node/201", "Sulphur Mountain Cosmic Ray Station", "viewpoint", 51.1447, -115.5745),
    cand("node/202", "Banff Upper Hot Springs", "springs", 51.151, -115.559),
    cand("node/203", "Bow Falls", "falls", 51.1662, -115.5603),
    cand("node/204", "Luxton Home & Garden Museum", "museum", 51.172, -115.575),
    ...extraSights
  ];
  return {
    destination: "Banff",
    country: "Canada",
    center: { lat: 51.1784, lon: -115.5708 },
    counts: { total: sights.length + 1, sights: sights.length, foods: 0, stays: 1, transport: 0 },
    stays: [cand("node/200", "Banff Park Lodge", "stay", 51.176, -115.572)],
    sights,
    excursions: [],
    foods: [],
    transport: [],
    weather: []
  };
}
function solveBanff(pack, mustSees) {
  return solveTrip(pack, {
    days: 4,
    startIso: "2026-11-01",
    dates: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"],
    earliestMin: 600,
    restSpec: { type: "afternoon", text: "one full rest afternoon in the middle" },
    mustSees,
    basePos: { lat: 51.176, lon: -115.572 },
    baseName: "Banff Park Lodge",
    calendar: null
  });
}

/* §1 — Banff exact request, pack with NO gondola in the data:
 * the must-do is extracted, carries the gondola requirement, and
 * comes back honestly UNMET (flagged), never "scheduled". */
{
  const extracted = extractConstraints(BANFF_REQUEST);
  ok(
    (extracted.placeItems || []).some((p) => /gondola/i.test(p)),
    "§1 extraction finds the gondola ask in the exact Banff request"
  );
  eq(extracted.earliestStart, "10:00", "§1 extraction keeps the 10:00 earliest start");
  const mustSees = deriveMustSees({ specialNotes: BANFF_REQUEST }, extracted, banffPack());
  const gondola = mustSees.find((m) => /gondola/i.test(m.label));
  ok(gondola, "§1 the gondola ask derives into a must-see");
  ok(
    (gondola.requiredPatterns || []).includes("gondola"),
    "§1 the gondola must-see carries the head-noun requirement"
  );
  const result = solveBanff(banffPack(), mustSees);
  const r = result.mustSeeResults.find((x) => x.id === gondola.id);
  eq(r.status, "unmet", "§1 with no gondola in the data the must-do is UNMET, not silently substituted");
  ok(/related places/.test(r.reason || ""), "§1 the unmet reason says honestly that only related places match");
  const miss = namedMustSeeMiss(gondola.label, "Banff");
  ok(/gondola/i.test(miss) && /no verified match/.test(miss), "§1 the named-miss sentence names the gondola as unverified");
  const hotSprings = mustSees.find((m) => /hot springs/i.test(m.label));
  const hs = result.mustSeeResults.find((x) => x.id === hotSprings.id);
  eq(hs.status, "scheduled", "§5 the hot-springs must-do still schedules");
  eq(hs.item, "Banff Upper Hot Springs", "§5 the hot-springs match is the hot springs itself");
}

/* §2 — same request, pack whose data DOES name the ride: the
 * must-do schedules as the explicit gondola activity, preferred
 * over the related summit station. */
{
  const extracted = extractConstraints(BANFF_REQUEST);
  const pack = banffPack([cand("way/301", "Banff Gondola", "gondola", 51.1482, -115.5556)]);
  const mustSees = deriveMustSees({ specialNotes: BANFF_REQUEST }, extracted, pack);
  const gondola = mustSees.find((m) => /gondola/i.test(m.label));
  const result = solveBanff(pack, mustSees);
  const r = result.mustSeeResults.find((x) => x.id === gondola.id);
  eq(r.status, "scheduled", "§2 when the data names the ride, the must-do schedules");
  eq(r.item, "Banff Gondola", "§2 the scheduled item is the gondola itself, not the summit station");
}

/* §3 — generic non-Banff must-dos behave the same way. */
// §3a: an invented destination ("Port Halloway") and an invented
// ask (a funicular ride) with only the summit station in the data.
{
  const req = mustSeeRequirement("the funicular ride up Halloway Head");
  ok(req.patterns.includes("funicular"), "§3 the funicular ask yields a funicular requirement");
  const pack = banffPack();
  pack.destination = "Port Halloway";
  pack.sights = [cand("node/401", "Halloway Head Signal Station", "viewpoint", 51.1447, -115.5745)];
  const result = solveBanff(pack, [
    { id: "ms-1", label: "the funicular ride up Halloway Head", patterns: ["funicular ride", "halloway head", "halloway", "head"], requiredPatterns: req.patterns, requiredKinds: req.kinds }
  ]);
  eq(result.mustSeeResults[0].status, "unmet", "§3 the summit signal station does not satisfy the funicular must-do");
}
// §3b: a kind-typed candidate satisfies by kind even when its name
// differs (the ferry pattern the engine already speaks).
{
  const req = mustSeeRequirement("the ferry ride across to Levis");
  ok(req.kinds.includes("ferry"), "§3 the ferry ask yields the ferry kind requirement");
  const pack = banffPack();
  pack.sights = [];
  pack.transport = [cand("node/402", "Traverse Québec-Lévis", "ferry", 51.15, -115.56)];
  const result = solveBanff(pack, [
    { id: "ms-1", label: "the ferry ride across to Levis", patterns: ["ferry ride", "levis", "ferry"], requiredPatterns: req.patterns, requiredKinds: req.kinds }
  ]);
  eq(result.mustSeeResults[0].status, "scheduled", "§3 a ferry-kind candidate satisfies the ferry must-do");
  eq(result.mustSeeResults[0].item, "Traverse Québec-Lévis", "§3 the ferry match is the ferry");
}
// §3c: proper-noun must-dos carry NO head-noun requirement — the
// proper name is the ask and the historical ladder governs.
{
  const req = mustSeeRequirement("a trip out to Montmorency Falls");
  eq(req.kinds.length, 0, "§3 a capitalized kind noun never becomes a KIND requirement");
  eq(
    req.patterns.join(","),
    "montmorency,falls",
    "§3 a pure named-place ask anchors on the place's own name (Paris law, 2026-11-08: no requirement let 'plan' satisfy Versailles against a plant museum)"
  );
}

/* §4 + §5 — the saved production itinerary.json (customer shape:
 * daily_itinerary days, each with a live_timeline of timed items,
 * rest_windows, and must_do_items). §4 pins the substitution as
 * recorded: the summit station is stamped a must-do while the word
 * "gondola" appears nowhere. §5 pins the outcomes that must remain
 * intact: earliest start, day-3 rest block, hot-springs visit. */
{
  const saved = JSON.parse(
    readFileSync(
      `${process.env.HOME}/workspace/goals/roamly-october-4-repair/hidden_files/daily-test-runs/2026-10-30/itinerary.json`,
      "utf8"
    )
  );
  const days = saved.daily_itinerary || [];
  eq(days.length, 4, "§5 the saved itinerary has four days");
  ok(!/gondola/i.test(JSON.stringify(saved)), "§4 the saved production itinerary contains zero 'gondola'");
  const mustDoItems = days.flatMap((d) => d.must_do_items || []);
  ok(
    mustDoItems.includes("Sulphur Mountain Cosmic Ray Station"),
    "§4 the saved itinerary stamps the related summit station as a must-do (the substitution, recorded)"
  );
  ok(
    !mustDoItems.some((m) => /gondola/i.test(m)),
    "§4 no must-do item in the saved itinerary names the gondola"
  );
  const timed = days.flatMap((d) => (d.live_timeline || []).filter((a) => a.startTime));
  eq(timed.length, 35, "§5 the saved itinerary carries its 35 timed activities");
  ok(
    timed.every((a) => a.startTime >= "10:00"),
    `§5 every timed activity starts at or after 10:00 (earliest: ${timed.map((a) => a.startTime).sort()[0]})`
  );
  ok(
    (days[2].rest_windows || []).some((w) => /Rest afternoon/.test(w)),
    "§5 day 3 keeps its explicit rest block"
  );
  const hotSprings = timed.find((a) => a.title === "Banff Upper Hot Springs" && a.item_type === "activity");
  ok(hotSprings, "§5 the hot springs are in the saved itinerary");
  eq(hotSprings.startTime, "17:38", "§5 the hot-springs visit keeps its saved 17:38 start");
}

console.log(`MUSTDO-PRESERVATION CHECKS: ${count}/${count} PASS`);
