// Roamly must-do STAGED-path verification checks (2026-10-31,
// Banff safeguards round, Safeguard 3):
// The zero-engine must-do fix (test:mustdo-preservation) closed
// the gondola substitution on the deterministic engine path, but
// the staged-AI path carried specialNotes into its prompts as
// prose only (stagedItineraryGeneration.ts outlinePrompt /
// dayBatchPrompt) with NO must-do verification at all: a related
// attraction could stand in for a requested experience in the
// saved itinerary and nothing ever flagged it.
//
// The fix is a deterministic verification pass at the last
// structured checkpoint before persistence — the end of
// assembleItinerary in stagedItineraryGeneration.ts, through
// which every persistItinerary save flows — implemented in
// lib/roamly/stagedMustDoVerification.ts. It REUSES the engine's
// extraction/derivation machinery (extractConstraints +
// deriveMustSees + mustSeeRequirement) and the solver's
// satisfaction semantics (an activity satisfies a must-do only
// when it names the requested experience/kind itself or carries
// its kind), and reports an unmet must-do through the same honest
// surface the zero-engine uses: the namedMustSeeMiss sentence in
// the first day's words (RoamlyDayPlan.primary_plan, where the
// zero-engine conversion lands its day narrative).
//
// Fixture provenance: scripts/fixtures/roamly-staged-banff-
// itinerary.json is a byte copy of the REAL saved Banff run
// (~/workspace/goals/roamly-october-4-repair/hidden_files/
// daily-test-runs/2026-10-30/itinerary.json) and
// roamly-staged-banff-summary.json a copy of that run's
// summary.json, whose request.text is the exact 107-word request.
// The saved itinerary is staged-shaped (daily_itinerary days with
// live_timeline activities): it contains "Sulphur Mountain Cosmic
// Ray Station" at Day 1 16:20 and "Banff Upper Hot Springs" at
// 17:38, and ZERO mentions of "gondola".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyStagedMustDos, applyStagedMustDoVerification } from "@/lib/roamly/stagedMustDoVerification.ts";

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

function payload(destination, specialNotes) {
  return { destination, specialNotes, interests: [] };
}
function titles(itinerary) {
  return itinerary.daily_itinerary.flatMap((d) => (d.live_timeline || []).map((a) => a.title));
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* Fixture provenance pins. */
{
  eq(savedSummary.request.wordCount, 107, "fixture: the saved request is the exact 107-word request");
  ok(/gondola ride up Sulphur Mountain/.test(BANFF_REQUEST), "fixture: the request asks for the gondola ride");
  ok(!/gondola/i.test(JSON.stringify(savedItinerary)), "fixture: the saved itinerary contains zero 'gondola'");
  const day1 = savedItinerary.daily_itinerary[0];
  const station = day1.live_timeline.find((a) => a.title === "Sulphur Mountain Cosmic Ray Station");
  eq(station.startTime, "16:20", "fixture: the Cosmic Ray Station is Day 1 at 16:20");
  const springs = day1.live_timeline.find((a) => a.title === "Banff Upper Hot Springs");
  eq(springs.startTime, "17:38", "fixture: the hot springs are Day 1 at 17:38");
}

/* §1 — staged fixture as saved: the gondola must-do is reported
 * UNMET with the related-places reason; the Cosmic Ray Station
 * does NOT count as satisfying it; the hot springs are satisfied
 * by the hot springs themselves; the unmet flag lands in day 1's
 * primary_plan (the staged equivalent of the zero-engine's day
 * narrative surface) and nothing else changes. */
{
  const results = verifyStagedMustDos(savedItinerary, payload("Banff", BANFF_REQUEST));
  const gondola = results.find((r) => /gondola/i.test(r.label));
  ok(gondola, "§1 the gondola ask derives into a verified must-do on the staged path");
  eq(gondola.status, "unmet", "§1 the gondola must-do is UNMET in the saved staged itinerary");
  ok(/only related places match/.test(gondola.reason || ""), "§1 the unmet reason says only related places match");
  ok(
    !results.some((r) => r.status === "satisfied" && r.item === "Sulphur Mountain Cosmic Ray Station"),
    "§1 the Cosmic Ray Station is NOT counted as satisfying any must-do"
  );
  const hotSprings = results.find((r) => /hot springs/i.test(r.label));
  eq(hotSprings.status, "satisfied", "§1 the hot-springs must-do is satisfied");
  eq(hotSprings.item, "Banff Upper Hot Springs", "§1 the hot-springs match is the hot springs itself");

  const applied = applyStagedMustDoVerification(clone(savedItinerary), payload("Banff", BANFF_REQUEST));
  const day1Words = applied.daily_itinerary[0].primary_plan || "";
  ok(
    day1Words.includes("One honest gap: you asked for the gondola ride up Sulphur Mountain."),
    "§1 the named-miss sentence naming the gondola lands in day 1's primary_plan"
  );
  ok(/no verified match/.test(day1Words), "§1 the flag says honestly there is no verified match");
  ok(
    day1Words.startsWith(savedItinerary.daily_itinerary[0].primary_plan),
    "§1 the flag is appended to the day words, the original words are untouched"
  );
  eq(
    JSON.stringify(titles(applied)),
    JSON.stringify(titles(savedItinerary)),
    "§1 verification alters no activity: nothing dropped, nothing substituted, nothing invented"
  );
}

/* §2 — fixture + an explicit gondola activity: satisfied, and
 * the pass leaves the itinerary's day words unchanged. */
{
  const withGondola = clone(savedItinerary);
  withGondola.daily_itinerary[0].live_timeline.push({
    title: "Banff Gondola",
    location_name: "Banff Gondola",
    item_type: "activity",
    category: "Attraction",
    startTime: "15:00",
    endTime: "16:00",
    candidateId: "way/999001"
  });
  const results = verifyStagedMustDos(withGondola, payload("Banff", BANFF_REQUEST));
  const gondola = results.find((r) => /gondola/i.test(r.label));
  eq(gondola.status, "satisfied", "§2 an explicit gondola activity satisfies the gondola must-do");
  eq(gondola.item, "Banff Gondola", "§2 the satisfying item is the gondola itself");
  const applied = applyStagedMustDoVerification(clone(withGondola), payload("Banff", BANFF_REQUEST));
  eq(
    applied.daily_itinerary[0].primary_plan,
    withGondola.daily_itinerary[0].primary_plan,
    "§2 satisfied must-dos get no unmet flag — day words unchanged"
  );
}

/* §3 — generic invented must-dos in another destination behave
 * the same way (no destination/experience is special-cased). */
function miniItinerary(items) {
  return {
    trip_title: "mini",
    daily_itinerary: [
      { day_number: 1, title: "Day 1", primary_plan: "A day out.", live_timeline: items, food: [], map_queries: [] }
    ]
  };
}
function activity(title, extra = {}) {
  return { title, location_name: title, item_type: "activity", category: "Attraction", ...extra };
}
{
  // 3a: funicular ask, only the summit signal station in the plan.
  const ask = "Please keep the days gentle, and also include the funicular ride up Halloway Head please.";
  const stationOnly = miniItinerary([activity("Halloway Head Signal Station")]);
  const r1 = verifyStagedMustDos(stationOnly, payload("Port Halloway", ask));
  eq(r1[0].status, "unmet", "§3 the summit signal station does not satisfy the funicular must-do");
  ok(/only related places match/.test(r1[0].reason || ""), "§3 the funicular unmet reason is the related-places reason");
  const applied = applyStagedMustDoVerification(clone(stationOnly), payload("Port Halloway", ask));
  ok(/funicular/i.test(applied.daily_itinerary[0].primary_plan), "§3 the funicular miss is named in the day words");
  // 3b: the funicular itself in the plan satisfies it.
  const withRide = miniItinerary([activity("Halloway Head Signal Station"), activity("Halloway Funicular")]);
  const r2 = verifyStagedMustDos(withRide, payload("Port Halloway", ask));
  eq(r2[0].status, "satisfied", "§3 the funicular activity satisfies the funicular must-do");
  // 3c: a ferry must-do is satisfied by KIND — an activity whose
  // name differs but which carries the ferry kind (travel_mode),
  // mirroring the solver's kind fallback.
  const ferryAsk = "Please keep the days gentle, and also include the ferry ride across to Levis please.";
  const ferryPlan = miniItinerary([
    activity("Traverse Québec-Lévis", { item_type: "travel", category: "Transport", travel_mode: "ferry" })
  ]);
  const r3 = verifyStagedMustDos(ferryPlan, payload("Quebec City", ferryAsk));
  eq(r3[0].status, "satisfied", "§3 a ferry-kind activity satisfies the ferry must-do even when its name differs");
  eq(r3[0].item, "Traverse Québec-Lévis", "§3 the ferry match is the ferry crossing");
}

/* §4 — proper-noun-only must-do: exempt, exactly as in the
 * zero-engine (no head-noun requirement, no flag from this pass),
 * even when nothing in the plan names it. */
{
  const ask = "Please keep the days gentle, and also include a trip out to Montmorency Falls please.";
  const plan = miniItinerary([activity("Old Town Promenade")]);
  const results = verifyStagedMustDos(plan, payload("Quebec City", ask));
  const falls = results.find((r) => /Montmorency/i.test(r.label));
  ok(falls, "§4 the proper-noun must-do is still derived");
  eq(falls.status, "exempt", "§4 a proper-noun-only must-do carries no requirement and is exempt");
  const applied = applyStagedMustDoVerification(clone(plan), payload("Quebec City", ask));
  eq(applied.daily_itinerary[0].primary_plan, "A day out.", "§4 an exempt must-do gets no unmet flag");
}

/* §5 — constraint regressions on the real fixture: the
 * verification pass does not disturb the outcomes the Banff run
 * already had right. */
{
  const applied = applyStagedMustDoVerification(clone(savedItinerary), payload("Banff", BANFF_REQUEST));
  const timed = applied.daily_itinerary.flatMap((d) => (d.live_timeline || []).filter((a) => a.startTime));
  eq(timed.length, 35, "§5 the applied itinerary still carries its 35 timed activities");
  ok(
    timed.every((a) => a.startTime >= "10:00"),
    `§5 every timed activity still starts at or after 10:00 (earliest: ${timed.map((a) => a.startTime).sort()[0]})`
  );
  ok(
    (applied.daily_itinerary[2].rest_windows || []).some((w) => /Rest afternoon/.test(w)),
    "§5 day 3 keeps its explicit rest block"
  );
  const hotSprings = timed.find((a) => a.title === "Banff Upper Hot Springs");
  eq(hotSprings.startTime, "17:38", "§5 the hot-springs visit keeps its saved 17:38 start");
}

/* §6 — wiring: the pass is actually invoked at the end of
 * assembleItinerary (the checkpoint every staged save flows
 * through), after the travel-requirements repair that rewrites
 * the day words. */
{
  const source = readFileSync(new URL("../lib/roamly/stagedItineraryGeneration.ts", import.meta.url), "utf8");
  ok(
    source.includes('import { applyStagedMustDoVerification } from "@/lib/roamly/stagedMustDoVerification";'),
    "§6 stagedItineraryGeneration imports the verification pass"
  );
  const assembleAt = source.indexOf("function assembleItinerary");
  const repairAt = source.indexOf("repairItineraryForTravelRequirements(raw, payload)", assembleAt);
  const applyAt = source.indexOf("return applyStagedMustDoVerification(localized, payload);", assembleAt);
  ok(assembleAt >= 0 && repairAt > assembleAt && applyAt > repairAt, "§6 assembleItinerary returns the verified itinerary after repair/localize");
}

console.log(`MUSTDO-STAGED CHECKS: ${count}/${count} PASS`);
