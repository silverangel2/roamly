// Walk finding 4 (2026-11-08): the generated intercity legs carried a
// flat 180-minute fallback for every mode and distance, and the
// arrival-buffer step inherited the same 3h. Montreal -> Saint John
// rendered as a "flight / 3h" that matches no real mode (flight
// total-travel model ~4h at 755 km; driving ~9.9h; no train serves
// Saint John). These checks pin the grounded behaviour:
//   - the leg's duration comes from the transport engine's own math
//     (recommended option hours, else the per-mode distance model);
//   - the arrival-buffer step gets its own 45 minutes, never the leg's;
//   - an unresolvable route yields NO invented estimate (null).
import assert from "node:assert/strict";

const itineraryLib = await import("../lib/itinerary.ts");
const transportLib = await import("../lib/roamly/transportOptions.ts");

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok ${passed + failed} - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok ${passed + failed} - ${name}`);
    console.log(`  ${String((err && err.message) || err).split("\n").join("\n  ")}`);
  }
}

function skeletonItinerary(dates) {
  return {
    trip_title: "Return-leg timing fixture",
    destination_summary: "",
    best_for: [],
    route_reasoning: "",
    budget_fit_summary: "",
    booking_status_summary: "",
    free_or_low_cost_notes: [],
    estimated_budget_breakdown: { total_estimate: "", transport: "", lodging: "", activities: "", food: "", buffer: "" },
    hotel_area_suggestions: [],
    transport_overview: "",
    daily_itinerary: dates.map((date, index) => ({
      day_number: index + 1,
      date,
      city: "Montreal",
      title: `Day ${index + 1}`,
      morning: "",
      afternoon: "",
      evening: "",
      food: [],
      estimated_cost: null,
      map_queries: [],
      live_timeline: []
    })),
    packing_checklist: [],
    local_tips: [],
    safety_notes: [],
    emergency_notes: [],
    booking_suggestions: [],
    pre_trip_essentials: [],
    regenerate_suggestions: []
  };
}

const DATES = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"];

function basePayload(overrides = {}) {
  return {
    origin: "Saint John",
    originCity: "Saint John",
    originCountry: "CA",
    destination: "Montreal",
    destinationCity: "Montreal",
    destinationCountry: "CA",
    startDate: "2026-10-30",
    endDate: "2026-11-02",
    daysCount: 4,
    budgetAmount: 800,
    budgetCurrency: "CAD",
    travelStyle: "Balanced",
    interests: ["Culture", "Food"],
    pace: "Balanced",
    walkingTolerance: "Medium",
    accommodationPreference: "Mid-range",
    transportationPreference: "Mixed",
    travelersCount: 1,
    specialNotes: "",
    ...overrides
  };
}

function findByTitle(day, prefix) {
  return day.live_timeline.find((item) => String(item.title).startsWith(prefix));
}

// --- Case 1: Montreal -> Saint John with the discovery recommendation
// that production produced (flight). The leg must carry the flight
// total-travel estimate (~4h at 755 km), NOT the flat 180, and the
// arrival step must be a 45-minute buffer.
// Production's discovery for this trip carried market pricing, which
// is what made flight the recommended option. Mirror that here: with
// no market data the flight option has null costs, is not "practical",
// and the engine instead recommends the mixed drive+fly option (also
// correct engine behaviour — just not the production shape).
const comparison = transportLib.compareTransportOptions(basePayload(), { flightEstimateCents: 30000 });
check("discovery comparison recommends flight for the market-priced 4-day SJ<->Montreal shape", () => {
  assert.equal(comparison.recommendedOption?.mode, "flight");
});

const flightPayload = basePayload({
  priceDiscovery: {
    transportOptions: comparison.options,
    recommendedTransportOption: comparison.recommendedOption
  }
});
const flightTrip = itineraryLib.repairItineraryForTravelRequirements(skeletonItinerary(DATES), flightPayload);
const expectedFlightMinutes = Math.round(comparison.recommendedOption.estimated_duration_hours * 60);

check("flight-implied return leg carries the flight total-travel estimate, not flat 180", () => {
  const lastDay = flightTrip.daily_itinerary[3];
  const leg = findByTitle(lastDay, "Return travel to Saint John");
  assert.ok(leg, "return leg exists");
  assert.equal(leg.travel_mode, "flight");
  assert.equal(leg.durationMinutes, expectedFlightMinutes);
  assert.notEqual(leg.durationMinutes, 180);
  assert.ok(leg.durationMinutes >= 230 && leg.durationMinutes <= 250, `expected ~240, got ${leg.durationMinutes}`);
});

check("flight return leg labels its duration as total travel time, not flight time", () => {
  const leg = findByTitle(flightTrip.daily_itinerary[3], "Return travel to Saint John");
  assert.ok(
    (leg.uncertainty || []).some((line) => /total travel time/i.test(line) && /not flight time alone/i.test(line)),
    `uncertainty was: ${(leg.uncertainty || []).join(" | ")}`
  );
});

check("arrival-back step gets its own 45-minute buffer, never the leg duration", () => {
  const arrival = findByTitle(flightTrip.daily_itinerary[3], "Estimated arrival back in Saint John");
  assert.ok(arrival, "arrival step exists");
  assert.equal(arrival.durationMinutes, 45);
});

check("outbound leg mirrors the same grounded estimate; arrival step is 45", () => {
  const firstDay = flightTrip.daily_itinerary[0];
  const leg = findByTitle(firstDay, "Travel to Montreal");
  assert.ok(leg, "outbound leg exists");
  assert.equal(leg.durationMinutes, expectedFlightMinutes);
  const arrival = findByTitle(firstDay, "Arrive in Montreal");
  assert.ok(arrival, "arrival step exists");
  assert.equal(arrival.durationMinutes, 45);
});

// --- Case 2: same route, explicit Drive preference (how the owner
// actually travelled). The leg must be the drive model (~9.9h), and
// the copy must be driving copy, not a flight assertion.
const drivePayload = basePayload({ transportationPreference: "Drive" });
const driveTrip = itineraryLib.repairItineraryForTravelRequirements(skeletonItinerary(DATES), drivePayload);
const expectedDriveMinutes = transportLib.estimateIntercityLegMinutes(drivePayload, "drive");

check("explicit Drive preference yields the drive-model duration (~9.9h), not 180 and not the flight figure", () => {
  const leg = findByTitle(driveTrip.daily_itinerary[3], "Return travel to Saint John");
  assert.ok(leg, "return leg exists");
  assert.equal(leg.travel_mode, "drive");
  assert.equal(leg.durationMinutes, expectedDriveMinutes);
  assert.ok(leg.durationMinutes >= 560 && leg.durationMinutes <= 630, `expected ~596, got ${leg.durationMinutes}`);
  assert.ok(!/flight/i.test(leg.description), `description must not assert flight: ${leg.description}`);
});

check("drive arrival-back step is still the 45-minute buffer", () => {
  const arrival = findByTitle(driveTrip.daily_itinerary[3], "Estimated arrival back in Saint John");
  assert.equal(arrival.durationMinutes, 45);
});

// --- Case 3: short-haul drive, Ottawa -> Montreal (200 km fallback
// corridor). Duration must scale with distance (~2.6h), proving the
// estimate is distance math, not a new fixed number.
const shortHaulPayload = basePayload({
  origin: "Ottawa",
  originCity: "Ottawa",
  destination: "Montreal",
  transportationPreference: "Drive"
});
const shortHaulTrip = itineraryLib.repairItineraryForTravelRequirements(skeletonItinerary(DATES), shortHaulPayload);
const expectedShortMinutes = transportLib.estimateIntercityLegMinutes(shortHaulPayload, "drive");

check("short-haul Ottawa->Montreal drive scales by distance (~158 min)", () => {
  const leg = findByTitle(shortHaulTrip.daily_itinerary[3], "Return travel to Ottawa");
  assert.ok(leg, "return leg exists");
  assert.equal(leg.durationMinutes, expectedShortMinutes);
  assert.ok(leg.durationMinutes >= 140 && leg.durationMinutes <= 175, `expected ~158, got ${leg.durationMinutes}`);
  const arrival = findByTitle(shortHaulTrip.daily_itinerary[3], "Estimated arrival back in Ottawa");
  assert.equal(arrival.durationMinutes, 45);
});

// --- Case 4: honest unknown. A route with no coordinates and no
// known-corridor fallback must produce NO estimate rather than an
// invented one.
check("unknown route yields null from the estimator (no invented duration)", () => {
  const minutes = transportLib.estimateIntercityLegMinutes(
    basePayload({ origin: "Atlantis", originCity: "Atlantis", destination: "El Dorado", destinationCity: "El Dorado" }),
    "flight"
  );
  assert.equal(minutes, null);
});

console.log(
  failed === 0
    ? `\nPASS: all ${passed} return-leg timing checks passed`
    : `\nFAIL: ${failed} of ${passed + failed} return-leg timing checks failed`
);
process.exit(failed === 0 ? 0 : 1);
