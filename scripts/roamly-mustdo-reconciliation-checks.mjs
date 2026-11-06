// Roamly must-do ANNOTATION RECONCILIATION checks (2026-10-31,
// Roamly release-blocker closure, Workstream 2):
// The must-do fixes (test:mustdo-preservation on the zero-engine,
// test:mustdo-staged on the staged-AI path) made an unmet must-do
// HONEST: it is flagged unmet and named in day 1's words via
// namedMustSeeMiss. But the day document's must-do ANNOTATIONS
// were never reconciled with that verdict: on the real saved Banff
// run, day 1's must_do_items still lists "Sulphur Mountain Cosmic
// Ray Station" and its live_timeline item still carries
// plan_role "must_do" / must_do true — presenting the related
// summit station as satisfying the gondola request the gap
// sentence calls unmet.
//
// The fix (lib/roamly/mustDoReconciliation.ts, applied by BOTH
// paths — stagedMustDoVerification.applyStagedMustDoVerification
// and the zero-engine's assembleEngineItinerary): when a must-do
// is UNMET, an annotation naming only a RELATED place for it is
// stripped (must_do_items / protected_anchors entry removed,
// timeline must-do flag downgraded — the activity itself stays);
// when a must-do is SATISFIED its annotation stays. Precision is
// per must-do: a mixed day keeps the satisfied annotation and
// loses only the unmet one. These checks pin:
//   §1 staged Banff fixture: station annotation stripped in all
//      three presentations, hot springs annotation kept, gap
//      sentence present, activity itself retained;
//   §2 staged explicit-gondola fixture: satisfied -> kept;
//   §3 zero-engine: (a) a full engine run on the Banff pack
//      converts + assembles with the station never annotated and
//      the gap sentence present exactly once; (b) the zero-engine
//      ASSEMBLY checkpoint fed the real saved day shape strips
//      the station annotation the same way (the pristine assembly
//      passed it through untouched — the contradiction);
//   §4 a mixed day (one satisfied + one unmet must-do, both
//      annotated): satisfied keeps, unmet loses;
//   §5 a generic invented funicular case (no Banff literals in
//      the scenario): annotated related station stripped;
//   §6 repair-resurrection guard: repairItineraryForTravel-
//      Requirements (which rebuilds must_do_items from timeline
//      flags) run over a reconciled document does NOT bring the
//      stripped annotation back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyStagedMustDos, applyStagedMustDoVerification } from "@/lib/roamly/stagedMustDoVerification.ts";
import { runEnginePlan, engineDayToRoamlyDayPlan, assembleEngineItinerary } from "@/lib/roamly/engine/generate.ts";
import { repairItineraryForTravelRequirements } from "@/lib/itinerary.ts";

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}

const savedItinerary = JSON.parse(readFileSync(new URL("./fixtures/roamly-staged-banff-itinerary.json", import.meta.url), "utf8"));
const savedSummary = JSON.parse(readFileSync(new URL("./fixtures/roamly-staged-banff-summary.json", import.meta.url), "utf8"));
const BANFF_REQUEST = savedSummary.request.text;
const STATION = "Sulphur Mountain Cosmic Ray Station";
const SPRINGS = "Banff Upper Hot Springs";

function payload(destination, specialNotes) {
  return { destination, specialNotes, interests: [] };
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function stationItem(day) {
  return (day.live_timeline || []).find((a) => a.title === STATION);
}
function flagged(day, title) {
  const item = (day.live_timeline || []).find((a) => a.title === title);
  return Boolean(item && (item.must_do === true || item.plan_role === "must_do"));
}

/* Fixture pins: the contradiction as saved. */
{
  const day1 = savedItinerary.daily_itinerary[0];
  ok((day1.must_do_items || []).includes(STATION), "fixture: day 1 must_do_items lists the Cosmic Ray Station");
  ok(flagged(day1, STATION), "fixture: the station timeline item carries the must-do flag");
  const results = verifyStagedMustDos(savedItinerary, payload("Banff", BANFF_REQUEST));
  eq(results.find((r) => /gondola/i.test(r.label)).status, "unmet", "fixture: the gondola must-do is UNMET");
}

/* §1 — staged Banff fixture after applyStagedMustDoVerification:
 * the station's annotation is stripped in the data, the timeline
 * flag and protected_anchors; the activity itself remains as an
 * ordinary stop; the satisfied hot springs keep every annotation;
 * the honest gap sentence is present in day 1's words. */
{
  const applied = applyStagedMustDoVerification(clone(savedItinerary), payload("Banff", BANFF_REQUEST));
  const day1 = applied.daily_itinerary[0];
  ok(!(day1.must_do_items || []).includes(STATION), "§1 the station is NOT in day 1 must_do_items after reconciliation");
  ok((day1.must_do_items || []).includes(SPRINGS), "§1 the satisfied hot springs KEEP their must_do_items entry");
  ok(stationItem(day1), "§1 the station activity itself is retained in the day (never dropped)");
  ok(!flagged(day1, STATION), "§1 the station timeline item no longer carries a must-do flag");
  ok(flagged(day1, SPRINGS), "§1 the hot springs timeline item keeps its must-do flag");
  ok(!(day1.protected_anchors || []).includes(STATION), "§1 the station is NOT in protected_anchors after reconciliation");
  ok((day1.protected_anchors || []).includes(SPRINGS), "§1 the hot springs keep their protected_anchors entry");
  ok(
    (day1.protected_anchors || []).includes("Mountain Home B & B"),
    "§1 the stay anchor keeps its protected_anchors entry (it is not a must-do annotation, despite sharing the context word 'Mountain')"
  );
  ok(
    (day1.primary_plan || "").includes("One honest gap: you asked for the gondola ride up Sulphur Mountain."),
    "§1 the named-miss gap sentence is present in day 1's primary_plan"
  );
  ok(!/gondola/i.test(JSON.stringify(day1.must_do_items || [])), "§1 no must_do_items entry names or implies the gondola");
  eq(
    JSON.stringify(applied.daily_itinerary.flatMap((d) => (d.live_timeline || []).map((a) => a.title))),
    JSON.stringify(savedItinerary.daily_itinerary.flatMap((d) => (d.live_timeline || []).map((a) => a.title))),
    "§1 reconciliation drops no activity and renames none"
  );
}

/* §2 — staged fixture + an explicit gondola activity annotated as
 * a must-do: satisfied -> the annotation stays, no gap sentence. */
{
  const withGondola = clone(savedItinerary);
  const day1 = withGondola.daily_itinerary[0];
  day1.live_timeline.push({
    title: "Banff Gondola",
    location_name: "Banff Gondola",
    item_type: "activity",
    category: "Attraction",
    startTime: "15:00",
    endTime: "16:00",
    candidateId: "way/999001",
    plan_role: "must_do",
    must_do: true
  });
  day1.must_do_items = [...(day1.must_do_items || []), "Banff Gondola"];
  const applied = applyStagedMustDoVerification(clone(withGondola), payload("Banff", BANFF_REQUEST));
  const appliedDay1 = applied.daily_itinerary[0];
  ok((appliedDay1.must_do_items || []).includes("Banff Gondola"), "§2 the satisfied gondola KEEPS its must_do_items entry");
  ok(flagged(appliedDay1, "Banff Gondola"), "§2 the gondola timeline item keeps its must-do flag");
  ok((appliedDay1.must_do_items || []).includes(STATION), "§2 with the gondola present, the station annotation is untouched (no unmet gondola to reconcile)");
  eq(appliedDay1.primary_plan, day1.primary_plan, "§2 satisfied must-dos get no gap sentence — day words unchanged");
}

/* §3 — zero-engine path. */
function cand(key, name, kind, lat, lon) {
  return { key, name, kind, pos: { lat, lon }, hoursRaw: null, tags: {}, url: "", google: null };
}
function banffPack() {
  const sights = [
    cand("node/201", "Sulphur Mountain Cosmic Ray Station", "viewpoint", 51.1447, -115.5745),
    cand("node/202", "Banff Upper Hot Springs", "springs", 51.151, -115.559),
    cand("node/203", "Bow Falls", "falls", 51.1662, -115.5603),
    cand("node/204", "Luxton Home & Garden Museum", "museum", 51.172, -115.575)
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
function makeEnginePayload() {
  return {
    destination: "Banff",
    destinationCity: "Banff",
    specialNotes: BANFF_REQUEST,
    interests: [],
    startDate: "2026-11-01",
    endDate: "2026-11-04",
    daysCount: 4,
    travelersCount: 2,
    budgetAmount: 1500,
    budgetCurrency: "CAD",
    tripType: "single_destination",
    pace: "Balanced",
    travelStyle: "Balanced",
    accommodationPreference: "No preference",
    transportationPreference: "Mixed",
    language: "en"
  };
}
{
  // §3a — full engine run: solve + convert + assemble.
  const enginePayload = makeEnginePayload();
  const run = runEnginePlan({ pack: banffPack(), payload: enginePayload, totalDayCount: 4 });
  eq(run.plan.mustSeeResults.find((r) => /gondola/i.test(r.label)).status, "unmet", "§3a the engine solver reports the gondola UNMET");
  const mustSeeKeys = new Set(run.plan.mustSeeResults.map((m) => m.itemKey).filter((k) => typeof k === "string" && k.length > 0));
  const conversionCtx = {
    destination: "Banff",
    anchorName: run.ctx.anchorName,
    anchorKey: run.ctx.anchorKey,
    anchorBooked: false,
    anchorPos: run.ctx.anchorPos,
    totalDayCount: 4,
    mustSeeKeys,
    originLabel: null
  };
  const generatedDays = run.daysOut.map((d) => engineDayToRoamlyDayPlan(d, conversionCtx));
  const state = {
    payload: enginePayload,
    outline: null,
    priceDiscoveryId: null,
    priceDiscovery: null,
    budgetConstraint: null,
    confirmedBookings: []
  };
  const assembled = assembleEngineItinerary({ state, generatedDays, final: true });
  const allMustDo = assembled.daily_itinerary.flatMap((d) => d.must_do_items || []);
  ok(!allMustDo.includes(STATION), "§3a the assembled engine itinerary never annotates the station as a must-do");
  ok(allMustDo.includes(SPRINGS), "§3a the satisfied hot springs are annotated as a must-do");
  const day1 = assembled.daily_itinerary[0];
  const station = stationItem(day1);
  if (station) ok(!flagged(day1, STATION), "§3a if the station is scheduled as an ordinary stop it carries no must-do flag");
  const gaps = (day1.primary_plan || "").split("One honest gap: you asked for the gondola ride").length - 1;
  eq(gaps, 1, "§3a day 1's words carry the gondola gap sentence exactly once (assembly does not duplicate the narrative's)");
}
{
  // §3b — the assembly checkpoint fed the real saved day shape:
  // the pristine assembly passed the station's must-do annotation
  // straight through; the reconciled assembly strips it.
  const enginePayload = makeEnginePayload();
  const state = {
    payload: enginePayload,
    outline: null,
    priceDiscoveryId: null,
    priceDiscovery: null,
    budgetConstraint: null,
    confirmedBookings: []
  };
  const assembled = assembleEngineItinerary({ state, generatedDays: clone(savedItinerary).daily_itinerary, final: true });
  const day1 = assembled.daily_itinerary[0];
  ok(!(day1.must_do_items || []).includes(STATION), "§3b the zero-engine assembly strips the station from must_do_items");
  ok((day1.must_do_items || []).includes(SPRINGS), "§3b the zero-engine assembly keeps the satisfied hot springs entry");
  ok(stationItem(day1) && !flagged(day1, STATION), "§3b the station stays in the day with its must-do flag stripped");
  ok(!(day1.protected_anchors || []).includes(STATION), "§3b the zero-engine assembly strips the station from protected_anchors");
  ok((day1.protected_anchors || []).includes("Mountain Home B & B"), "§3b the stay anchor keeps its protected_anchors entry");
  ok(
    (day1.primary_plan || "").includes("One honest gap: you asked for the gondola ride up Sulphur Mountain."),
    "§3b the zero-engine assembly names the gondola gap in day 1's words"
  );
}

/* §4 — mixed day: one satisfied must-do + one unmet must-do, both
 * annotated. Only the unmet one's annotation is stripped. */
function miniDay(items, mustDoItems) {
  return {
    trip_title: "mini",
    daily_itinerary: [
      { day_number: 1, title: "Day 1", primary_plan: "A day out.", live_timeline: items, must_do_items: mustDoItems, protected_anchors: [...mustDoItems], food: [], map_queries: [] }
    ]
  };
}
function activity(title, extra = {}) {
  return { title, location_name: title, item_type: "activity", category: "Attraction", candidateId: `cand/${title}`, plan_role: "must_do", must_do: true, ...extra };
}
{
  const ask =
    "Please keep the days gentle, and also include the funicular ride up Halloway Head and the tram ride across Halloway Bay please.";
  const plan = miniDay(
    [activity("Halloway Funicular"), activity("Halloway Bay Signal Station")],
    ["Halloway Funicular", "Halloway Bay Signal Station"]
  );
  const results = verifyStagedMustDos(plan, payload("Port Halloway", ask));
  eq(results.find((r) => /funicular/i.test(r.label)).status, "satisfied", "§4 the funicular must-do is satisfied");
  eq(results.find((r) => /tram/i.test(r.label)).status, "unmet", "§4 the tram must-do is unmet (only a related station is in the plan)");
  const applied = applyStagedMustDoVerification(clone(plan), payload("Port Halloway", ask));
  const day = applied.daily_itinerary[0];
  ok((day.must_do_items || []).includes("Halloway Funicular"), "§4 the satisfied funicular KEEPS its annotation on the mixed day");
  ok(!(day.must_do_items || []).includes("Halloway Bay Signal Station"), "§4 the unmet tram's related station LOSES its annotation on the same day");
  ok(flagged(day, "Halloway Funicular"), "§4 the funicular item keeps its must-do flag");
  ok(!flagged(day, "Halloway Bay Signal Station"), "§4 the station item loses its must-do flag but stays in the day");
  ok(/tram/i.test(day.primary_plan) && /no verified match/.test(day.primary_plan), "§4 the tram gap is named in the day words");
}

/* §5 — generic invented funicular case, annotated related station:
 * stripped, with no destination/experience special-casing. */
{
  const ask = "Please keep the days gentle, and also include the funicular ride up Halloway Head please.";
  const plan = miniDay([activity("Halloway Head Signal Station")], ["Halloway Head Signal Station"]);
  const applied = applyStagedMustDoVerification(clone(plan), payload("Port Halloway", ask));
  const day = applied.daily_itinerary[0];
  eq((day.must_do_items || []).length, 0, "§5 the annotated summit signal station is stripped for the unmet funicular");
  ok(day.live_timeline.some((a) => a.title === "Halloway Head Signal Station"), "§5 the station activity itself remains in the day");
  ok(/funicular/i.test(day.primary_plan) && /no verified match/.test(day.primary_plan), "§5 the funicular gap sentence is present");
}

/* §6 — repair resurrection guard: the travel-requirements repair
 * rebuilds must_do_items from timeline flags (annotateDayPlan in
 * lib/itinerary.ts); over a reconciled document it must NOT bring
 * the stripped station annotation back — neither in any day's
 * must_do_items nor as a re-flagged timeline item. (The repair's
 * own unrelated timeline truncation is out of scope here; the
 * guard is about the annotation, not the repair's item set.) */
{
  const applied = applyStagedMustDoVerification(clone(savedItinerary), payload("Banff", BANFF_REQUEST));
  const repaired = repairItineraryForTravelRequirements(clone(applied), payload("Banff", BANFF_REQUEST));
  const allMustDo = repaired.daily_itinerary.flatMap((d) => d.must_do_items || []);
  ok(!allMustDo.includes(STATION), "§6 a later repair rebuild does NOT resurrect the station's must-do annotation");
  ok(
    !repaired.daily_itinerary.some((d) => flagged(d, STATION)),
    "§6 no repaired day re-flags the station timeline item as a must-do"
  );
}

console.log(`MUSTDO-RECONCILIATION CHECKS: ${count}/${count} PASS`);
