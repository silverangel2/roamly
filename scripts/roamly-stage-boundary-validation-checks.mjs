// Stage 7 / KF-1 fail-early (2026-11-11): stage-boundary validation.
//
// Reproduces the 2026-10-20 Charlottetown FINAL_VALIDATION_FAILED
// record classes (search-is-not-a-plan travel item, ungrounded hotel,
// cross-day activity repeat) as fixtures, proves the fixture trips
// the FINAL validator (calibration), then proves
// stageBoundaryDayErrors (lib/itinerary.ts) attributes each violation
// to the batch that produced the day — while both generation drivers
// (zero-engine runDayBatchStage, incumbent day-batch gate) now call
// it before a batch may be marked complete. Final validation is
// asserted UNCHANGED: still the backstop, still rejecting the same
// document, still accepting a clean one.
//
// Evidence tier: SIMULATED (pure functions over record-shaped
// fixtures + wiring pins). No production access.

import assert from "node:assert/strict";
import fs from "node:fs";

let checks = 0;
let failures = 0;
function check(label, fn) {
  checks += 1;
  try {
    fn();
    console.log(`ok ${checks} - ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${checks} - ${label}: ${error.message}`);
  }
}

const { validateItineraryForProduction, stageBoundaryDayErrors } = await import("../lib/itinerary.ts");

/* ---------------- fixtures: the Charlottetown record shape -------- */

const PAYLOAD = {
  destination: "Charlottetown",
  destinationCity: "Charlottetown",
  origin: "Saint John",
  originCity: "Saint John",
  travelers: 2,
  daysCount: 3
};

function seed(overrides) {
  return {
    time_label: "09:00 – 10:00",
    startTime: "09:00",
    endTime: "10:00",
    title: "Item",
    description: "",
    location_name: "Charlottetown",
    category: "Attraction",
    map_query: "",
    item_type: "activity",
    ...overrides
  };
}

function day(dayNumber, items) {
  return {
    day_number: dayNumber,
    date: `2026-10-${19 + dayNumber}`,
    city: "Charlottetown",
    title: `Day ${dayNumber}`,
    morning: "",
    afternoon: "",
    evening: "",
    food: [],
    estimated_cost: null,
    map_queries: [],
    live_timeline: items,
    plan_status: "planned",
    uncertainty: []
  };
}

// Day 1: the record's failing travel item ("flight search" is a
// search, not a plan) plus a real activity that day 3 repeats.
const DAY1 = day(1, [
  seed({
    item_type: "travel",
    category: "Flight",
    title: "Saint John to Charlottetown flight search",
    description: "Search for a flight from Saint John to Charlottetown.",
    time_label: "08:00 – 09:30",
    startTime: "08:00",
    endTime: "09:30"
  }),
  seed({
    title: "Events in Charlottetown",
    description: "Local events in the city centre.",
    location_name: "Downtown Charlottetown",
    time_label: "11:00 – 12:00",
    startTime: "11:00",
    endTime: "12:00"
  })
]);

// Day 2: the record's ungrounded hotel (a hotel SEARCH, no candidate,
// no provenance status).
const DAY2 = day(2, [
  seed({
    item_type: "hotel",
    category: "Hotel",
    title: "Charlottetown hotel search",
    description: "Search for a hotel in Charlottetown.",
    time_label: "15:00 – 15:30",
    startTime: "15:00",
    endTime: "15:30"
  }),
  seed({
    title: "Confederation Centre of the Arts",
    description: "Gallery visit.",
    location_name: "Downtown Charlottetown",
    time_label: "16:00 – 17:00",
    startTime: "16:00",
    endTime: "17:00"
  })
]);

// Day 3: the cross-day repeat of day 1's activity.
const DAY3 = day(3, [
  seed({
    title: "Events in Charlottetown",
    description: "Local events in the city centre.",
    location_name: "Downtown Charlottetown",
    time_label: "10:00 – 11:00",
    startTime: "10:00",
    endTime: "11:00"
  }),
  seed({
    item_type: "travel",
    category: "Flight",
    title: "Flight from Charlottetown to Saint John",
    description: "Return flight home.",
    location_name: "Charlottetown Airport",
    time_label: "18:00 – 19:30",
    startTime: "18:00",
    endTime: "19:30"
  })
]);

const FULL_DOC = {
  destination_summary: "",
  route_reasoning: "",
  hotel_area_suggestions: [],
  daily_itinerary: [DAY1, DAY2, DAY3],
  booking_suggestions: [],
  generation_note: ""
};

const boundary = (priorDays, newDays, extra = {}) =>
  stageBoundaryDayErrors({
    priorDays,
    newDays,
    payload: PAYLOAD,
    totalDayCount: 3,
    includeTravelStructureChecks: true,
    ...extra
  });

/* ---------------- calibration: the record still fails final ------- */

const finalErrors = validateItineraryForProduction(FULL_DOC, PAYLOAD).errors;
console.log("final validator errors on the record-shaped doc:", JSON.stringify(finalErrors, null, 1));
check("CAL: final validator rejects the record-shaped doc (backstop intact)", () => {
  assert.equal(validateItineraryForProduction(FULL_DOC, PAYLOAD).ok, false);
});
check("CAL: 'search is not a plan' present at final validation", () => {
  assert.ok(finalErrors.some((e) => e.includes("Saint John to Charlottetown flight search: search is not a plan")));
});
check("CAL: ungrounded-hotel error present at final validation", () => {
  assert.ok(finalErrors.some((e) => e.includes("Charlottetown hotel search has no grounding/provenance")));
});
check("CAL: cross-day repeat error present at final validation", () => {
  assert.ok(finalErrors.some((e) => e === "activity Events in Charlottetown must not repeat across days."));
});

/* ---------------- boundary attribution ---------------------------- */

check("B1: batch 1 boundary fails on the search item, naming it", () => {
  const errors = boundary([], [DAY1]);
  assert.ok(errors.some((e) => e.includes("flight search: search is not a plan")), JSON.stringify(errors));
});
check("B2: batch 2 boundary fails on the ungrounded hotel", () => {
  const errors = boundary([DAY1], [DAY2]);
  assert.ok(errors.some((e) => e.includes("hotel Charlottetown hotel search has no grounding/provenance")), JSON.stringify(errors));
});
check("B2b: batch 2 boundary does not re-report batch 1's error", () => {
  const errors = boundary([DAY1], [DAY2]);
  assert.ok(!errors.some((e) => e.includes("flight search")), JSON.stringify(errors));
});
check("B3: batch 3 boundary fails on the cross-day repeat", () => {
  const errors = boundary([DAY1, DAY2], [DAY3]);
  assert.ok(errors.some((e) => e === "activity Events in Charlottetown must not repeat across days."), JSON.stringify(errors));
});
check("B4: a clean new day after a bad prior day attributes nothing", () => {
  const clean = day(2, [
    seed({
      title: "Victoria Park boardwalk",
      location_name: "Victoria Park",
      time_label: "10:00 – 11:00",
      startTime: "10:00",
      endTime: "11:00"
    })
  ]);
  const errors = boundary([DAY1], [clean], { includeTravelStructureChecks: false });
  assert.deepEqual(errors, []);
});
check("B5: the multi-day hotel rule is NOT fired at the boundary (differenced out, final-only)", () => {
  const errors = boundary([DAY1], [DAY2]);
  assert.ok(!errors.some((e) => e.includes("Multi-day itinerary names no hotel")), JSON.stringify(errors));
});

/* ---------------- relaxed-return exception, honoured exactly ------ */

const MARKET_DAY1 = day(1, [
  seed({ title: "Charlottetown Farmers Market", kind: "market", location_name: "Charlottetown Farmers Market" })
]);
const RETURN_STAMPED = day(6, [
  seed({
    title: "Charlottetown Farmers Market",
    kind: "market",
    location_name: "Charlottetown Farmers Market",
    repeat: true,
    firstDay: 1
  })
]);
const RETURN_UNSTAMPED = day(6, [
  seed({ title: "Charlottetown Farmers Market", kind: "market", location_name: "Charlottetown Farmers Market" })
]);
check("R1: a solver-stamped relaxed return (market, gap >= 4) passes the boundary", () => {
  const errors = stageBoundaryDayErrors({
    priorDays: [MARKET_DAY1],
    newDays: [RETURN_STAMPED],
    payload: { ...PAYLOAD, daysCount: 6 },
    totalDayCount: 6,
    includeTravelStructureChecks: false
  });
  assert.deepEqual(errors, []);
});
check("R2: the same return WITHOUT the stamp fails the boundary (exception never widened)", () => {
  const errors = stageBoundaryDayErrors({
    priorDays: [MARKET_DAY1],
    newDays: [RETURN_UNSTAMPED],
    payload: { ...PAYLOAD, daysCount: 6 },
    totalDayCount: 6,
    includeTravelStructureChecks: false
  });
  assert.ok(errors.some((e) => e.includes("must not repeat across days")), JSON.stringify(errors));
});

/* ---------------- chronology + transport mode --------------------- */

check("C1: an overlapping new day fails the boundary on chronology", () => {
  const overlap = day(2, [
    seed({ title: "Gallery visit", time_label: "09:00 – 11:00", startTime: "09:00", endTime: "11:00", location_name: "Gallery" }),
    seed({ title: "Harbour walk", time_label: "10:00 – 12:00", startTime: "10:00", endTime: "12:00", location_name: "Gallery" })
  ]);
  const errors = boundary([DAY1], [overlap], { includeTravelStructureChecks: false });
  assert.ok(errors.some((e) => e.includes("overlaps the previous item")), JSON.stringify(errors));
});
check("C2: drive-mode payload + flight content fails the boundary (mode mismatch)", () => {
  const flightDay = day(2, [
    seed({
      item_type: "travel",
      category: "Flight",
      title: "Flight to Moncton",
      description: "Fly to Moncton.",
      transportMode: "flight",
      location_name: "Charlottetown Airport"
    })
  ]);
  const errors = stageBoundaryDayErrors({
    priorDays: [],
    newDays: [flightDay],
    payload: { ...PAYLOAD, transportationPreference: "Drive" },
    totalDayCount: 3,
    includeTravelStructureChecks: false
  });
  assert.ok(errors.some((e) => e.includes("has flight content on a drive trip")), JSON.stringify(errors));
});

/* ---------------- travel-structure checks: engine on, incumbent off */

const NO_ARRIVAL_DAY1 = day(1, [
  seed({ title: "Confederation Centre of the Arts", location_name: "Downtown Charlottetown" })
]);
check("S1: engine mode — Day 1 without arrival travel fails the boundary", () => {
  const errors = boundary([], [NO_ARRIVAL_DAY1]);
  assert.ok(errors.some((e) => e.includes("Day 1 is missing travel/arrival")), JSON.stringify(errors));
});
check("S1b: incumbent mode — the same day does NOT fail (finalization repair owns arrival synthesis)", () => {
  const errors = boundary([], [NO_ARRIVAL_DAY1], { includeTravelStructureChecks: false });
  assert.ok(!errors.some((e) => e.includes("travel/arrival")), JSON.stringify(errors));
});
check("S2: engine mode — final day without departure fails the boundary", () => {
  const lastDay = day(3, [seed({ title: "Victoria Park boardwalk", location_name: "Victoria Park" })]);
  const errors = boundary([DAY1, DAY2], [lastDay]);
  assert.ok(errors.some((e) => e.includes("Final day is missing checkout/departure/return travel")), JSON.stringify(errors));
});
check("S3: engine mode — two major items, different places, no transfer fails the boundary", () => {
  const noTransfer = day(2, [
    seed({ title: "Gallery visit", location_name: "Downtown Charlottetown", time_label: "09:00 – 10:00", startTime: "09:00", endTime: "10:00" }),
    seed({ title: "Boardwalk walk", location_name: "Victoria Park", time_label: "11:00 – 12:00", startTime: "11:00", endTime: "12:00" })
  ]);
  const errors = boundary([DAY1], [noTransfer]);
  assert.ok(errors.some((e) => e.includes("missing transfer time between major items")), JSON.stringify(errors));
});

/* ---------------- clean generation still passes ------------------- */

check("G1: a fully clean 3-day doc passes final validation", () => {
  const cleanDay = (n, title) =>
    day(n, [
      seed({
        item_type: "travel",
        category: "Flight",
        title: n === 1 ? "Flight from Saint John to Charlottetown, arrival in Charlottetown" : "Flight from Charlottetown to Saint John, return departure",
        description: n === 1 ? "Fly and arrive." : "Return flight, departure from the airport.",
        location_name: "Charlottetown Airport",
        time_label: "08:00 – 09:30",
        startTime: "08:00",
        endTime: "09:30"
      }),
      seed({
        item_type: "hotel",
        category: "Hotel",
        title: "The Great George",
        description: "Check in at the hotel.",
        candidateId: "osm:node:1",
        factualStatus: "search_ready",
        location_name: "Downtown Charlottetown",
        time_label: "10:00 – 10:30",
        startTime: "10:00",
        endTime: "10:30"
      }),
      seed({
        title,
        location_name: "Downtown Charlottetown",
        time_label: "11:00 – 12:00",
        startTime: "11:00",
        endTime: "12:00"
      })
    ]);
  const doc = { ...FULL_DOC, daily_itinerary: [cleanDay(1, "Gallery visit"), cleanDay(2, "Harbour walk"), cleanDay(3, "Market morning")] };
  // Day 2's flight item is day-1-shaped; rebuild day 2 without travel.
  doc.daily_itinerary[1] = day(2, [
    seed({
      item_type: "hotel",
      category: "Hotel",
      title: "The Great George",
      description: "Hotel base.",
      candidateId: "osm:node:1",
      factualStatus: "search_ready",
      location_name: "Downtown Charlottetown",
      time_label: "09:00 – 09:30",
      startTime: "09:00",
      endTime: "09:30"
    }),
    seed({ title: "Harbour walk", location_name: "Downtown Charlottetown", time_label: "11:00 – 12:00", startTime: "11:00", endTime: "12:00" })
  ]);
  const result = validateItineraryForProduction(doc, PAYLOAD);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(boundary([], [doc.daily_itinerary[0]]), []);
});

/* ---------------- wiring pins ------------------------------------- */

const generateSource = fs.readFileSync(new URL("../lib/roamly/engine/generate.ts", import.meta.url), "utf8");
const stagedSource = fs.readFileSync(new URL("../lib/roamly/stagedItineraryGeneration.ts", import.meta.url), "utf8");
check("W1: engine day-batch stage calls stageBoundaryDayErrors before marking the batch complete", () => {
  const stageStart = generateSource.indexOf("async function runDayBatchStage");
  const callAt = generateSource.indexOf("stageBoundaryDayErrors({", stageStart);
  const completeAt = generateSource.indexOf('status: "complete",', callAt);
  assert.ok(stageStart >= 0 && callAt > stageStart && completeAt > callAt);
  assert.ok(generateSource.slice(callAt, completeAt).includes("includeTravelStructureChecks: true"));
});
check("W2: incumbent day-batch gate calls stageBoundaryDayErrors with structure checks off", () => {
  const callAt = stagedSource.indexOf("stageBoundaryDayErrors({");
  assert.ok(callAt > 0);
  assert.ok(stagedSource.slice(callAt, callAt + 400).includes("includeTravelStructureChecks: false"));
});
check("W3: both drivers throw DAY_BATCH_VALIDATION_FAILED from the batch boundary", () => {
  assert.ok(generateSource.includes('"DAY_BATCH_VALIDATION_FAILED"'));
  assert.ok(stagedSource.includes('"DAY_BATCH_VALIDATION_FAILED"'));
});

console.log(`\nstage-boundary-validation: ${checks - failures}/${checks} checks passed.`);
if (failures) {
  console.error(`stage-boundary-validation: ${failures} FAILURES`);
  process.exit(1);
}
console.log("PASS roamly-stage-boundary-validation-checks");
process.exit(0);
