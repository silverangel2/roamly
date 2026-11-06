// Roamly V1 chained-return checks — 2026-11-02, owner-authorized,
// LOCAL ONLY. Sibling to roamly-v1-finalization-checks.mjs (Option A).
//
// The solver's relaxation CHAINS returns: each return is stamped with
// the PREVIOUS visit's day (solver.ts addStop) and the solver's gate
// measures the >= 4-day gap from the previous visit. The Option A
// validator exception admitted exactly one return referenced to the
// ORIGINAL day, so a genuine second return (e.g. Days 1/5/9) failed
// production final validation. This suite pins the corrected chain
// semantics of the exception in lib/itinerary.ts:
//
//   (a) GENUINE solver output — a park returning on Days 1/5/9 (14-day
//       stay) and Days 1/5/9/15 (18-day stay), produced by the real
//       solver and carried through the real production converter —
//       validates clean with the REAL validator.
//   (b) Negative controls — every broken chain still produces the
//       exact repeat error: invalid middle link, a return anchored to
//       an invalid link, an incorrect previous-day reference, a short
//       gap at the second link, an unstamped third visit, a stamped
//       original, an ineligible kind at a chain link.
//   (c) The one INTERPRETED case, per the owner's spec read literally:
//       "firstDay matching the immediately previous ACCEPTED visit's
//       actual day" + "at least four days between each consecutive
//       accepted visit". After an INVALID middle link is rejected, the
//       anchor remains the last accepted visit (the original), so a
//       later return stamped to that original with a >= 4-day gap IS
//       accepted — the chain skips the invalid link. Pinned as such.

import assert from "node:assert/strict";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}

const { solveTrip } = await import("@/lib/roamly/engine/solver.ts");
const { buildCalendar } = await import("@/lib/roamly/engine/pacing.ts");
const { engineDayToRoamlyDayPlan } = await import("@/lib/roamly/engine/generate.ts");
const { travelerReadinessErrors, validateItineraryForProduction } = await import("@/lib/itinerary.ts");

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const repeatErrors = (errors) => errors.filter((e) => /must not repeat across days/.test(e));

/* ------------------------------------------------------------------ */
/* (a) Genuine solver chains — real solver, real converter, validator  */
/* ------------------------------------------------------------------ */

console.log("(a) Genuine solver chains — real solver + real converter + real validator");

// Pack/spec construction copied from the V1 restore round's positive
// proof (verification/v1-restore-proof.mjs), generalized by stay
// length only.
const BASE = { lat: 43.6532, lon: -79.3832 };
const sight = (key, name, kind, dLat, dLon = 0) => ({
  key, name, kind,
  pos: { lat: BASE.lat + dLat, lon: BASE.lon },
  hoursRaw: null, tags: {}, url: `https://www.openstreetmap.org/${key}`
});
const food = (key, name, dLat) => ({
  key, name, kind: "restaurant",
  pos: { lat: BASE.lat + dLat, lon: BASE.lon },
  hoursRaw: null, tags: {}, url: `https://www.openstreetmap.org/${key}`
});
function buildConstruction(totalDays) {
  const fillers = [];
  const kinds = ["museum", "gallery", "historic", "attraction", "viewpoint"];
  let fi = 0;
  for (let gx = -2; gx <= 2; gx++)
    for (let gy = -2; gy <= 2; gy++) {
      if (gx === 0 && gy === 0) continue;
      fillers.push(sight(`filler-${fi}`, `Filler ${fi}`, kinds[fi % kinds.length], gx * 0.0035, gy * 0.0035));
      fi++;
    }
  const sights = [
    sight("park-home", "Home Park", "park", 0.0006, 0.0004),
    sight("park-home-twin", "Home Park", "park", -0.006, 0.006),
    sight("market-home", "Home Market", "market", 0.0011, -0.0006),
    ...fillers
  ];
  const pack = {
    destination: "Toronto", country: "Canada", center: BASE,
    counts: { total: sights.length + 1, sights: sights.length, foods: 1, stays: 0, transport: 0 },
    stays: [], sights, excursions: [], foods: [food("food-near", "Near Eatery", 0.001)], transport: [],
    weather: []
  };
  const dates = Array.from({ length: totalDays }, (_, i) =>
    new Date(Date.UTC(2026, 10, 10 + i)).toISOString().slice(0, 10));
  pack.weather = dates.map((date) => ({ date, tMax: 12, tMin: 4, precipProb: null }));
  const cal = buildCalendar({ totalDays, bases: [{ name: "Toronto", days: totalDays }] });
  const spec = {
    days: totalDays, startIso: dates[0], dates, earliestMin: 570,
    restSpec: null, mustSees: [], basePos: BASE, baseName: "Toronto stay",
    calendar: cal.days, relaxFavorites: cal.relaxFavorites
  };
  return { pack, spec, relaxFavorites: cal.relaxFavorites };
}

function runGenuineChain(totalDays, expectedChain, label) {
  const { pack, spec, relaxFavorites } = buildConstruction(totalDays);
  eq(relaxFavorites, true, `${label}: construction has relaxFavorites on`);
  const plan = solveTrip(pack, spec);
  const occurrences = [];
  plan.days.forEach((day, d) => day.items.filter((i) => i.type === "stop").forEach((s) => {
    if (s.key === "park-home-twin") {
      occurrences.push({ day: d + 1, repeat: s.repeat ?? null, firstDay: s.firstDay ?? null, kind: s.kind ?? null });
    }
  }));
  eq(
    JSON.stringify(occurrences.map((o) => [o.day, o.firstDay])),
    JSON.stringify(expectedChain),
    `${label}: solver places Home Park (twin) on days ${expectedChain.map((c) => c[0]).join("/")} with chain stamps (got ${JSON.stringify(occurrences)})`
  );
  ok(occurrences[0].repeat === null, `${label}: solver leaves the original visit unstamped`);
  ok(
    occurrences.slice(1).every((o) => o.repeat === true && o.kind === "park"),
    `${label}: every solver return is stamped repeat:true with kind park`
  );
  const ctx = {
    destination: "Toronto",
    anchorName: "Toronto stay",
    anchorKey: null,
    anchorBooked: false,
    anchorPos: null,
    totalDayCount: plan.days.length,
    mustSeeKeys: new Set(),
    originLabel: null
  };
  const roamlyDays = plan.days.map((d) => engineDayToRoamlyDayPlan(d, ctx));
  const doc = { daily_itinerary: roamlyDays, booking_suggestions: [] };
  const payload = { daysCount: totalDays, destination: "Toronto", origin: "", transportationPreference: "" };
  const readiness = travelerReadinessErrors(doc, payload);
  eq(JSON.stringify(readiness), "[]", `${label}: travelerReadinessErrors returns [] (got ${JSON.stringify(readiness)})`);
  const prod = validateItineraryForProduction(doc, payload);
  eq(prod.ok, true, `${label}: validateItineraryForProduction ok:true (errors: ${JSON.stringify(prod.errors)})`);
  eq(prod.errors.length, 0, `${label}: validateItineraryForProduction returns no errors`);
}

// The V1 restore round's own positive construction: a double return.
runGenuineChain(14, [[1, null], [5, 1], [9, 5]], "a-14d");
// A longer stay chains a third return of the same place.
runGenuineChain(18, [[1, null], [5, 1], [9, 5], [15, 9]], "a-18d");

/* ------------------------------------------------------------------ */
/* (b)+(c) Hand-built chain controls — each verdict pinned exactly     */
/* ------------------------------------------------------------------ */

console.log("(b/c) Chain controls — broken chains error; the interpreted case is pinned");

const hotelSeed = {
  item_type: "hotel",
  title: "Hôtel Marie Rollet",
  description: "Check in at Hôtel Marie Rollet — your base for this trip.",
  candidateId: "way/anchor",
  factualStatus: "search_ready"
};
const act = (title, extra = {}) => ({ item_type: "activity", title, description: "", ...extra });
const stamped = (firstDay, kind = "park") => ({ repeat: true, firstDay, kind });
const PARK = "Chain Park";
const PARK_MSG = `activity ${PARK} must not repeat across days.`;
const payload14 = { daysCount: 14, destination: "Toronto", origin: "", transportationPreference: "" };

function chainDoc(visits) {
  // visits: [{ day, extra }] for Chain Park; one item per listed day.
  const byDay = new Map(visits.map((v) => [v.day, v]));
  const days = [];
  for (let d = 1; d <= 14; d++) {
    const timeline = d === 1 ? [hotelSeed] : [];
    if (byDay.has(d)) timeline.push(act(PARK, byDay.get(d).extra));
    days.push({ day_number: d, live_timeline: timeline });
  }
  return { daily_itinerary: days, booking_suggestions: [] };
}
function expectRepeatCount(docIn, expected, label) {
  const errors = repeatErrors(travelerReadinessErrors(docIn, payload14));
  eq(errors.length, expected, `${label} (repeat errors: ${JSON.stringify(errors)})`);
  if (expected > 0) ok(errors.every((e) => e === PARK_MSG), `${label}: every repeat error is the verbatim message`);
}

// Positive control: a well-formed hand-built chain validates clean.
expectRepeatCount(
  chainDoc([{ day: 1, extra: { kind: "park" } }, { day: 5, extra: stamped(1) }, { day: 9, extra: stamped(5) }]),
  0,
  "b-pos: hand-built Days 1/5/9 chain (firstDay 1 then 5) -> no repeat error"
);
// Positive control: market kind chains identically.
expectRepeatCount(
  chainDoc([{ day: 1, extra: { kind: "market" } }, { day: 6, extra: stamped(1, "market") }, { day: 11, extra: stamped(6, "market") }]),
  0,
  "b-pos: market chain Days 1/6/11 -> no repeat error"
);

// (a1) Invalid middle link + a later return anchored to that invalid link.
expectRepeatCount(
  chainDoc([{ day: 1, extra: { kind: "park" } }, { day: 4, extra: stamped(1) }, { day: 9, extra: stamped(4) }]),
  2,
  "b(a1): Day-4 return has gap 3 (invalid link) and Day-9 return anchored to the invalid Day 4 -> both rejected"
);

// (c) INTERPRETED CASE — owner's spec read literally. The Day-4 link is
// invalid (gap 3) and rejected; the anchor therefore remains the last
// ACCEPTED visit, Day 1. The Day-9 return stamped firstDay:1 references
// that previous accepted visit with a gap of 8 >= 4, so it is ACCEPTED:
// the chain skips the invalid link. Exactly one repeat error (Day 4).
expectRepeatCount(
  chainDoc([{ day: 1, extra: { kind: "park" } }, { day: 4, extra: stamped(1) }, { day: 9, extra: stamped(1) }]),
  1,
  "b(c) INTERPRETED: invalid Day-4 link rejected; Day-9 return stamped to the last ACCEPTED visit (Day 1, gap 8) is accepted -> exactly one repeat error"
);

// (b) Incorrect previous-day reference inside an otherwise valid chain.
expectRepeatCount(
  chainDoc([{ day: 1, extra: { kind: "park" } }, { day: 5, extra: stamped(1) }, { day: 9, extra: stamped(1) }]),
  1,
  "b(b): Day-9 return stamped firstDay:1 while the previous accepted visit is Day 5 -> rejected"
);

// (c-gap) Insufficient gap at the second link.
expectRepeatCount(
  chainDoc([{ day: 1, extra: { kind: "park" } }, { day: 5, extra: stamped(1) }, { day: 8, extra: stamped(5) }]),
  1,
  "b(c-gap): Day-8 return is only 3 days after the accepted Day-5 visit -> rejected"
);

// (d) Third visit without a valid stamp.
expectRepeatCount(
  chainDoc([{ day: 1, extra: { kind: "park" } }, { day: 5, extra: stamped(1) }, { day: 9, extra: { kind: "park" } }]),
  1,
  "b(d): Day-9 third visit carries no stamp -> rejected"
);

// (e1) Stamped original poisons the whole chain.
expectRepeatCount(
  chainDoc([{ day: 1, extra: stamped(1) }, { day: 5, extra: stamped(1) }, { day: 9, extra: stamped(5) }]),
  2,
  "b(e1): original visit itself stamped -> both returns rejected"
);

// (e2) Ineligible kind at a chain link.
expectRepeatCount(
  chainDoc([{ day: 1, extra: { kind: "park" } }, { day: 5, extra: stamped(1, "museum") }, { day: 9, extra: stamped(5) }]),
  2,
  "b(e2): Day-5 return has kind museum (not a RELAX_KIND) -> rejected, and Day 9 cannot anchor to it -> rejected"
);

// (f) Cross-batch shape: three visits, no stamps at all.
expectRepeatCount(
  chainDoc([
    { day: 1, extra: { kind: "park", sourceBatch: 1 } },
    { day: 5, extra: { kind: "park", sourceBatch: 2 } },
    { day: 9, extra: { kind: "park", sourceBatch: 2 } }
  ]),
  2,
  "b(f): unstamped repeats across batches -> both rejected"
);

console.log(`\nV1 chained-return checks: ${count} assertions passed.`);
