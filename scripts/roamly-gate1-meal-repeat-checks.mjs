// Roamly Gate-1 fix (2026-10-25) — meal-repeat regression checks.
//
// The post-deploy Gate-1 failure: fresh 5-day Toronto trips failed
// FINAL_VALIDATION with "meal Don Alfonso 1890 must not repeat across
// days" x4. Root cause: the day-batch solver's addLunch fell back to
// ALL near foods when every near food was already used on another day
// of the plan, so one restaurant repeated on all five days and the
// final-validation gate (correctly) refused the plan.
//
// These checks run the REAL solveTrip + the REAL
// travelerReadinessErrors (the validation rule itself, untouched)
// over a thin Toronto-shaped pack and assert:
//   1. THIN PACK, single 5-day run: lunch names never repeat across
//      days — days with no unused food near get an honest meal
//      window (rest item), never a reused place.
//   2. BATCH SHAPE, five fresh runs extracting one day each (how the
//      production day batches actually assemble a plan): same rule.
//   3. CROSS-BATCH SEEDING: a run seeded with a prior batch's meal
//      picks the next-best UNUSED food, not the seeded one.
//   4. NAME SEEDING: a run seeded with a meal name never picks a
//      DIFFERENT venue sharing that name (validation keys on names).
//   5. VALIDATION BACKSTOP: the real travelerReadinessErrors reports
//      zero meal-repeat errors for the fixed thin-pack plan.
//
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-gate1-meal-repeat-checks.mjs
import assert from "node:assert/strict";

const { solveTrip } = await import("../lib/roamly/engine/solver.ts");
const { travelerReadinessErrors } = await import("../lib/itinerary.ts");

const BASE = { lat: 43.6532, lon: -79.3832 };
const DATES = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"];
const food = (key, name, dLat) => ({
  key, name, kind: "restaurant",
  pos: { lat: BASE.lat + dLat, lon: BASE.lon },
  hoursRaw: null, tags: {}, url: ""
});
const DON = "food-don-alfonso-1890";
const DON_TWIN = "food-don-alfonso-1890-twin";

function thinPack(foods) {
  return {
    destination: "Toronto", country: "Canada", center: BASE,
    counts: { total: foods.length, sights: 0, foods: foods.length, stays: 0, transport: 0 },
    stays: [], sights: [], excursions: [], foods, transport: [],
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
function lunchesOf(plan) {
  return plan.days.map((day) => {
    const foodItem = day.items.find((i) => i.type === "food");
    const windowItem = day.items.find((i) => i.type === "rest" && i.part === "meal");
    if (foodItem) return { kind: "food", name: foodItem.name, key: foodItem.key };
    if (windowItem) return { kind: "window", name: windowItem.title };
    return { kind: "none", name: "" };
  });
}
function toValidationDoc(plan) {
  return {
    daily_itinerary: plan.days.map((day, i) => ({
      day_number: i + 1,
      live_timeline: day.items
        .filter((item) => item.type === "food" || (item.type === "rest" && item.part === "meal"))
        .map((item) => ({
          item_type: item.type === "food" ? "meal" : "rest",
          title: item.type === "food" ? item.name : item.title,
          description: ""
        }))
    }))
  };
}
const payload = { daysCount: 5, destination: "Toronto", origin: "Saint John", transportationPreference: "" };
const mealRepeatErrors = (doc) =>
  travelerReadinessErrors(doc, payload).filter((e) => /must not repeat across days/.test(e));

// --- 1. Thin pack, single 5-day run (the Toronto shape) --------------
const thin = thinPack([
  food(DON, "Don Alfonso 1890", 0.001),   // ~0.11 km: the only near food
  food("food-far-east", "Far East Kitchen", 0.05) // ~5.5 km: outside 1.8 km
]);
const plan = solveTrip(thin, spec());
const lunches = lunchesOf(plan);
console.log("thin-pack lunches:", JSON.stringify(lunches, null, 0));
assert.equal(lunches[0].kind, "food", "day 1 books the near food");
assert.equal(lunches[0].name, "Don Alfonso 1890");
for (let d = 1; d < 5; d++) {
  assert.equal(lunches[d].kind, "window", `day ${d + 1} must hold a meal window, never a repeat (got ${lunches[d].kind} ${lunches[d].name})`);
}
const foodNames = lunches.filter((l) => l.kind === "food").map((l) => l.name);
assert.equal(new Set(foodNames).size, foodNames.length, "no food name repeats across days in one run");
assert.deepEqual(mealRepeatErrors(toValidationDoc(plan)), [], "real validation reports zero meal repeats for the fixed plan");

// --- 2. Batch shape: five fresh runs, one day each --------------------
const batchLunches = [];
for (let i = 0; i < 5; i++) {
  const run = solveTrip(thin, spec());
  batchLunches.push(lunchesOf(run)[i]);
}
console.log("batch-shape lunches:", JSON.stringify(batchLunches, null, 0));
const batchFoods = batchLunches.filter((l) => l.kind === "food").map((l) => l.name);
assert.equal(new Set(batchFoods).size, batchFoods.length, "batch-extracted plan never repeats a food name");
assert.equal(batchLunches.filter((l) => l.kind === "food").length, 1, "only day 1 books Don Alfonso in the batch shape");

// --- 3. Cross-batch seeding picks the next-best unused food -----------
const seededPack = thinPack([
  food(DON, "Don Alfonso 1890", 0.001),
  food("food-second-eatery", "Second Eatery", 0.005), // ~0.55 km: near, unused
  food("food-far-east", "Far East Kitchen", 0.05)
]);
const seeded = solveTrip(seededPack, spec({
  priorMeals: [{ key: DON, name: "Don Alfonso 1890" }]
}));
const seededLunches = lunchesOf(seeded);
console.log("seeded lunches day 1:", JSON.stringify(seededLunches[0]));
assert.equal(seededLunches[0].kind, "food", "seeded run still books a lunch when an unused food is near");
assert.equal(seededLunches[0].name, "Second Eatery", "seeded run must skip the prior batch's meal");

// --- 4. Name seeding blocks a same-name different venue ----------------
const twinPack = thinPack([
  food(DON, "Don Alfonso 1890", 0.001),
  food(DON_TWIN, "Don Alfonso 1890", 0.003), // same name, different key
  food("food-far-east", "Far East Kitchen", 0.05)
]);
const twin = solveTrip(twinPack, spec({
  priorMeals: [{ key: DON, name: "Don Alfonso 1890" }]
}));
const twinLunches = lunchesOf(twin);
console.log("name-seeded lunches day 1:", JSON.stringify(twinLunches[0]));
assert.equal(twinLunches[0].kind, "window", "a same-name twin must not stand in for the seeded meal");
assert.deepEqual(
  mealRepeatErrors(toValidationDoc(twin)),
  [],
  "real validation reports zero meal repeats for the name-seeded plan"
);

console.log("gate1 meal-repeat checks: PASS (5 assertions groups, thin Toronto pack, real solver + real validation)");
