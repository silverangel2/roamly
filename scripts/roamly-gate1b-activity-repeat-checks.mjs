// Roamly Gate-1B fix (2026-10-25) — activity-repeat regression checks.
//
// The post-deploy Gate-1 re-run (PR #103 live) proved the meal fix
// WORKED but the failure MOVED: fresh 5-day Toronto trips failed
// FINAL_VALIDATION with "activity Canada's Theatre Museum must not
// repeat across days | activity Trinity Square must not repeat across
// days" (signed-in identical-params trip 051aff2f). Root cause: the
// solver's cross-day ledger is keyed by candidate key, but final
// validation keys repeats on the NAME — so a same-name different-key
// venue (common in OSM-sourced packs) slipped past the ledger, and a
// fresh day-batch run had no activity memory at all (only meals were
// seeded by the Gate-1 fix).
//
// These checks run the REAL solveTrip + the REAL
// travelerReadinessErrors (the validation rule itself, untouched)
// over a thin Toronto-shaped pack with same-name twins and assert:
//   1. TWIN PACK, single 5-day run: no activity name repeats across
//      days — a twin is never scheduled once its name is used.
//   2. BATCH SEEDING: a run seeded with a prior batch's activities
//      picks next-best UNUSED places, never the seeded names.
//   3. EXHAUSTION HONESTY: a pool of only twins still yields zero
//      repeats — slots stay unfilled rather than repeating a place.
//   4. VALIDATION BACKSTOP: the real travelerReadinessErrors reports
//      zero activity-repeat errors for the fixed thin-pack plan.
//
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-gate1b-activity-repeat-checks.mjs
import assert from "node:assert/strict";

const { solveTrip } = await import("../lib/roamly/engine/solver.ts");
const { travelerReadinessErrors } = await import("../lib/itinerary.ts");

const BASE = { lat: 43.6532, lon: -79.3832 };
const DATES = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"];
const sight = (key, name, kind, dLat, dLon = 0) => ({
  key, name, kind,
  pos: { lat: BASE.lat + dLat, lon: BASE.lon + dLon },
  hoursRaw: null, tags: {}, url: ""
});
const food = (key, name, dLat) => ({
  key, name, kind: "restaurant",
  pos: { lat: BASE.lat + dLat, lon: BASE.lon },
  hoursRaw: null, tags: {}, url: ""
});

function pack(sights, foods = [food("food-near", "Near Eatery", 0.001)]) {
  return {
    destination: "Toronto", country: "Canada", center: BASE,
    counts: { total: sights.length + foods.length, sights: sights.length, foods: foods.length, stays: 0, transport: 0 },
    stays: [], sights, excursions: [], foods, transport: [],
    weather: DATES.map((date) => ({ date, tMax: 12, tMin: 4, precipProb: null }))
  };
}
function spec(extra = {}) {
  return {
    days: 5, startIso: DATES[0], dates: DATES, earliestMin: 570,
    restSpec: null, mustSees: [], basePos: BASE, baseName: "Toronto stay",
    ...extra
  };
}
function stopsOf(plan) {
  return plan.days.map((day) =>
    day.items.filter((i) => i.type === "stop").map((i) => ({ name: i.name, key: i.key })));
}
function activityRepeats(stopDays) {
  const seen = new Map();
  const repeats = [];
  stopDays.forEach((stops, d) => {
    for (const s of stops) {
      const k = String(s.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!k) continue;
      if (seen.has(k) && seen.get(k) !== d) repeats.push({ name: s.name, days: [seen.get(k) + 1, d + 1] });
      else seen.set(k, d);
    }
  });
  return repeats;
}
function toValidationDoc(plan) {
  return {
    daily_itinerary: plan.days.map((day, i) => ({
      day_number: i + 1,
      live_timeline: day.items
        .filter((item) => item.type === "stop" || item.type === "food" || item.type === "rest")
        .map((item) => ({
          item_type: item.type === "stop" ? "activity" : item.type === "food" ? "meal" : "rest",
          title: item.type === "stop" ? item.name : item.type === "food" ? item.name : item.title,
          description: ""
        }))
    }))
  };
}
const payload = { daysCount: 5, destination: "Toronto", origin: "Saint John", transportationPreference: "" };
const repeatErrors = (doc) =>
  travelerReadinessErrors(doc, payload).filter((e) => /activity .* must not repeat across days/.test(e));

// --- Twin pack: spread grid (Toronto-shaped). The twins sit far apart
// (>0.15 km, so the solver's anti-clustering radius does NOT mask the
// name-blindness) — on pre-fix code day 1 and day 2 both schedule
// "Canada's Theatre Museum" and "Trinity Square", production's exact
// signature. A clustered fixture would hide this: twins within
// 0.15 km of each other are refused by farFromUsed alone.
const twinPack = pack([
  sight("sight-theatre-a", "Canada's Theatre Museum", "museum", 0.002, 0.002),
  sight("sight-theatre-b", "Canada's Theatre Museum", "museum", -0.004, 0.004),
  sight("sight-trinity-a", "Trinity Square", "park", 0.004, -0.002),
  sight("sight-trinity-b", "Trinity Square", "park", -0.002, -0.005),
  sight("sight-museum-two", "Second Museum", "museum", 0.006, 0.001),
  sight("sight-museum-three", "Third Museum", "museum", -0.006, -0.001),
  sight("sight-attraction-one", "Attraction One", "attraction", 0.001, 0.006),
  sight("sight-attraction-two", "Attraction Two", "attraction", -0.001, -0.007),
  sight("sight-gallery-one", "Gallery One", "gallery", 0.007, -0.004),
  sight("sight-gallery-two", "Gallery Two", "gallery", -0.007, 0.003),
  sight("sight-historic-one", "Historic One", "historic", 0.003, -0.006),
  sight("sight-historic-two", "Historic Two", "historic", -0.003, 0.007),
  sight("sight-view-one", "Viewpoint One", "viewpoint", 0.008, 0.005),
  sight("sight-view-two", "Viewpoint Two", "viewpoint", -0.008, -0.005),
  sight("sight-park-two", "Second Park", "park", 0.005, 0.008),
  sight("sight-park-three", "Third Park", "park", -0.005, -0.008)
]);

// --- 1. Twin pack, single 5-day run ------------------------------------
const plan = solveTrip(twinPack, spec());
const stopDays = stopsOf(plan);
console.log("twin-pack stops:", JSON.stringify(stopDays.map((s) => s.map((x) => x.name))));
const repeats = activityRepeats(stopDays);
assert.deepEqual(repeats, [], `no activity name may repeat across days in one run (got ${JSON.stringify(repeats)})`);
for (const twin of ["Canada's Theatre Museum", "Trinity Square"]) {
  const daysWith = stopDays.map((s, i) => (s.some((x) => x.name === twin) ? i + 1 : null)).filter(Boolean);
  assert.ok(daysWith.length <= 1, `${twin} must appear on at most one day (got days ${daysWith.join(",")})`);
}

// --- 2. Batch seeding: seeded run avoids prior days' activities --------
const day1Stops = stopDays[0];
assert.ok(day1Stops.length > 0, "day 1 must schedule at least one stop to seed from");
const seeded = solveTrip(twinPack, spec({
  priorActivities: day1Stops.map((s) => ({ key: s.key, name: s.name }))
}));
const seededDay1 = stopsOf(seeded)[0].map((s) => s.name);
console.log("seeded day-1 stops:", JSON.stringify(seededDay1));
for (const s of day1Stops) {
  assert.ok(!seededDay1.includes(s.name), `seeded run must not re-pick prior activity ${s.name}`);
}

// --- 2b. Name seeding: a twin of a seeded name is refused too ---------
const nameSeeded = solveTrip(twinPack, spec({
  priorActivities: [{ key: "sight-theatre-a", name: "Canada's Theatre Museum" }]
}));
const nameSeededStops = stopsOf(nameSeeded).flat().map((s) => s.name);
assert.ok(!nameSeededStops.includes("Canada's Theatre Museum"),
  "a run seeded with one twin's name must never schedule the other twin (different key, same name)");

// --- 3. Exhaustion honesty: twins only ----------------------------------
const tinyPack = pack([
  sight("sight-theatre-a", "Canada's Theatre Museum", "museum", 0.001),
  sight("sight-theatre-b", "Canada's Theatre Museum", "museum", 0.003),
  sight("sight-trinity-a", "Trinity Square", "park", 0.001, 0.001),
  sight("sight-trinity-b", "Trinity Square", "park", 0.003, 0.001)
]);
const tinyPlan = solveTrip(tinyPack, spec());
const tinyRepeats = activityRepeats(stopsOf(tinyPlan));
assert.deepEqual(tinyRepeats, [], `exhausted pool must stay unfilled, never repeat (got ${JSON.stringify(tinyRepeats)})`);

// --- 4. Validation backstop ---------------------------------------------
assert.deepEqual(repeatErrors(toValidationDoc(plan)), [], "real validation reports zero activity repeats for the fixed plan");

console.log("gate1b-activity-repeat: all checks passed");
