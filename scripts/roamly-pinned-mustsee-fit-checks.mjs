// Roamly pinned must-see fit checks (2026-11-01, ITEM 3 — pinned
// must-see safety closure):
// The diagnostic round fixed the FORCE must-see block in solver.ts:
// it placed a visit past the Make-Sense judge's hard day-end limit
// (judges.ts: ends past dayEndLimit + 60) and past the hunger limit
// (MEAL_GAP_LIMIT = 300) because it had no fit check at all. The
// PINNED must-see path (solver.ts, the block that LEADS a FULL day
// with the must-sees a traveler's booking pins to that day via
// mustSeeDayPins) carried the same missing check: it moves to each
// pinned candidate and addStop()s it unconditionally, back to back,
// with no meal, no pace break, and no end-time check — the day's
// lunch is only inserted by the skeleton AFTER every pin has been
// placed. Times are NOT fixed by a pin (a pin fixes only the DAY),
// so every start/end the pinned path emits is solver-chosen.
//
// These checks build the smallest deterministic scenarios that put
// the pinned path under time pressure and run the REAL judge
// (judgeTrip) on the produced plan:
//
//   A. Meal gap: three pinned museums on day 2, chained ~22 km
//      apart (34 min drive legs — the >=30 min idle gaps reset the
//      judge's break-cadence segments, isolating the hunger rule).
//      Lead placement runs 10:04 -> 15:42 before any meal can be
//      inserted: a 338 min span with no meal, over the 300 limit.
//   B. Accumulation: five pinned museums on day 1 on the same
//      chain. Lead placement runs to 19:50 — the fifth pin ends
//      past the day-end hard limit (18:30) and the meal gap is
//      586 min. On a safe solver the first pins schedule, a later
//      pin may be rescued legally after lunch by the force path,
//      and the rest surface honestly UNMET — never an illegal day.
//   C. Day end, single pin: one pinned museum ~311 km away. The
//      drive alone puts its solver-chosen visit at 17:18–18:48,
//      ending past the hard limit. Nothing about the day can make
//      that lead placement legal, so it must surface UNMET.
//
// Expected on the pre-fix solver: judgeTrip FAILS A, B and C with
// exactly the hard violations printed below. Expected after the
// fit gate: judgeTrip PASSES every scenario, pins that fit are
// scheduled on their pinned day, and pins that cannot fit legally
// are reported "unmet" (the status generate.ts surfaces to the
// traveler via namedMustSeeMiss) instead of being placed illegally.
import assert from "node:assert/strict";
import { solveTrip } from "@/lib/roamly/engine/solver.ts";
import { judgeTrip } from "@/lib/roamly/engine/judges.ts";
import { fmt } from "@/lib/roamly/engine/util.ts";

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}

const BASE = { lat: 45.5, lon: -73.55 };
function cand(key, name, lat) {
  return {
    key, name, kind: "museum", pos: { lat, lon: -73.55 }, hoursRaw: null, tags: {},
    url: `https://www.openstreetmap.org/${key}`, google: null
  };
}
function pack(sights) {
  return {
    destination: "Montreal",
    country: "Canada",
    center: BASE,
    counts: { total: sights.length, sights: sights.length, foods: 0, stays: 0, transport: 0 },
    stays: [],
    sights,
    excursions: [],
    foods: [],
    transport: [],
    weather: []
  };
}
const DATES = ["2026-10-26", "2026-10-27"];
function solve(p, mustSees, pins) {
  return solveTrip(p, {
    days: 2,
    startIso: DATES[0],
    dates: DATES,
    earliestMin: 540,
    restSpec: null,
    mustSees,
    basePos: BASE,
    baseName: "Base Hotel",
    calendar: null,
    mustSeeDayPins: pins
  });
}
const ms = (id, label, pattern) => ({ id, label, patterns: [pattern] });
function describe(result, verdict) {
  for (const day of result.days) {
    const items = day.items.map((i) => `${i.name || i.title} ${fmt(i.start)}-${fmt(i.end)}`).join(" | ");
    console.log(`  day ${day.dayNumber}: ${items || "(no items)"}`);
  }
  for (const r of result.mustSeeResults)
    console.log(`  must-see ${r.id}: ${r.status}${r.day ? ` day ${r.day}` : ""}${r.reason ? ` — ${r.reason}` : ""}`);
  console.log(`  judge: ${verdict.pass ? "PASS" : `FAIL — ${verdict.hardViolations.join(" ; ")}`}`);
}

/* ---- A. Meal gap: three chained pins lead day 2 ---- */
console.log("A. three pinned museums chained ~22 km apart, pinned to day 2");
const packA = pack([
  cand("node/101", "Alpha Museum", 45.7),
  cand("node/102", "Beta Museum", 45.9),
  cand("node/103", "Gamma Museum", 46.1)
]);
const seesA = [ms("ms-a1", "the Alpha Museum", "alpha museum"), ms("ms-a2", "the Beta Museum", "beta museum"), ms("ms-a3", "the Gamma Museum", "gamma museum")];
const resA = solve(packA, seesA, { "ms-a1": 1, "ms-a2": 1, "ms-a3": 1 });
const judgeA = judgeTrip(resA.days, { earliestMin: 540 });
describe(resA, judgeA);
/* ---- B. Accumulation: five chained pins on day 1 ---- */
console.log("B. five pinned museums chained ~22 km apart, pinned to day 1");
const namesB = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
const packB = pack(namesB.map((n, i) => cand(`node/20${i + 1}`, `${n} Museum`, 45.7 + i * 0.2)));
const seesB = namesB.map((n, i) => ms(`ms-b${i + 1}`, `the ${n} Museum`, `${n.toLowerCase()} museum`));
const pinsB = Object.fromEntries(seesB.map((s) => [s.id, 0]));
const resB = solve(packB, seesB, pinsB);
const judgeB = judgeTrip(resB.days, { earliestMin: 540 });
describe(resB, judgeB);
/* ---- C. Day end: one pin too far away to fit the day ---- */
console.log("C. one pinned museum ~311 km away, pinned to day 1");
const packC = pack([cand("node/301", "Faraway Museum", 48.3)]);
const seesC = [ms("ms-c1", "the Faraway Museum", "faraway museum")];
const resC = solve(packC, seesC, { "ms-c1": 0 });
const judgeC = judgeTrip(resC.days, { earliestMin: 540 });
describe(resC, judgeC);
ok(judgeA.pass, `A: judged plan is legal (violations: ${judgeA.hardViolations.join(" ; ") || "none"})`);
for (const s of seesA) {
  const r = resA.mustSeeResults.find((x) => x.id === s.id);
  eq(r.status, "scheduled", `A: ${s.id} schedules (legally) rather than being placed illegally or dropped`);
  eq(r.day, 2, `A: ${s.id} stays on its pinned day`);
}
{
  // The third pin cannot lead the day legally (it would end 338 min
  // into a meal-less span); it must land AFTER the day's meal, which
  // is where the force path can legally put it.
  const day2 = resA.days[1];
  const meal = day2.items.find((i) => i.type === "food" || (i.type === "rest" && i.part === "meal"));
  const gamma = day2.items.find((i) => i.name === "Gamma Museum");
  ok(!!meal && !!gamma && gamma.start >= meal.end, "A: the deferred pin lands after the meal, not in a meal-less lead run");
}

ok(judgeB.pass, `B: judged plan is legal (violations: ${judgeB.hardViolations.join(" ; ") || "none"})`);
for (const s of seesB.slice(0, 3)) {
  const r = resB.mustSeeResults.find((x) => x.id === s.id);
  eq(r.status, "scheduled", `B: ${s.id} schedules legally on the pinned day`);
  eq(r.day, 1, `B: ${s.id} stays on its pinned day`);
}
for (const s of seesB.slice(3)) {
  const r = resB.mustSeeResults.find((x) => x.id === s.id);
  eq(r.status, "unmet", `B: ${s.id} cannot fit legally and surfaces honestly UNMET instead of an illegal placement`);
}

ok(judgeC.pass, `C: judged plan is legal (violations: ${judgeC.hardViolations.join(" ; ") || "none"})`);
{
  const r = resC.mustSeeResults.find((x) => x.id === "ms-c1");
  eq(r.status, "unmet", "C: the far pin surfaces honestly UNMET instead of ending past the hard day-end limit");
  ok(!resC.days.some((d) => d.items.some((i) => i.key === "node/301")), "C: the far pin is not placed on any day");
}

console.log(`roamly-pinned-mustsee-fit: all ${count} checks passed`);
