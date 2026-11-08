// Transport-options selector + logic map (owner order, 2026-11-08).
// Roamly is prompt-asking + logic-map driven: the questions identify
// the traveller's needs, then NAMED rules (TRANSPORT_LOGIC_RULES)
// decide which transport options are suggested, available, or excluded
// by rule — hard facts (no service, too far) beat stated needs, stated
// needs beat suggestions. The traveller's pick then enters the trip's
// auto-calculation and rewrites the itinerary legs. These checks pin:
//   - Montreal <-> Saint John: train excluded NO_SERVICE with reason;
//     at no explicit preference the 9.9h drive is excluded TOO_FAR and
//     flight is the ONLY suggestion (FLIGHT_ONLY), priced from a live
//     partner result with provenance;
//   - the same route with an explicit Drive answer: the stated need
//     disarms the too-far rule and driving is suggested;
//   - a short haul where flying busts the stated budget: driving is
//     suggested by BUDGET_LOW_DRIVE ("fits your budget");
//   - a selection round-trip: totals recomputed with the engine's own
//     formula, the pick persisted in the discovery row, and the
//     generated legs rebuilt around the pick;
//   - excluded options can never be selected.
import assert from "node:assert/strict";

const itineraryLib = await import("../lib/itinerary.ts");
const transportLib = await import("../lib/roamly/transportOptions.ts");
const discoveryLib = await import("../lib/roamly/priceDiscovery.ts");

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
    trip_title: "Transport options fixture",
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

function baseInput(overrides = {}) {
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
const byMode = (options, mode) => options.find((option) => option.mode === mode);

// --- The logic map itself: named rules, in precedence order.
check("logic map is a named rule table in precedence order, with the 8h too-far threshold", () => {
  assert.deepEqual(
    transportLib.TRANSPORT_LOGIC_RULES.map((rule) => rule.id),
    ["NO_SERVICE", "TOO_FAR_TO_DRIVE", "FLIGHT_ONLY", "TRAVELLER_PREFERENCE", "BUDGET_LOW_DRIVE", "BEST_BALANCE"]
  );
  assert.equal(transportLib.DRIVE_TOO_FAR_HOURS, 8);
});

// --- Case 1: Montreal <-> Saint John, no explicit mode, live flight
// price. Feasibility beats everything: train has NO service, the 9.9h
// drive is too far, so flight is the ONLY suggestion.
const liveFlightResult = {
  category: "flight",
  provider: "Travelpayouts",
  title: "Saint John to Montreal flights",
  price_amount: 389,
  price_min: 362,
  price_max: 421,
  currency: "CAD",
  price_type: "live_partner"
};
const discoveryFlightOnly = await discoveryLib.discoverTripPrices(
  baseInput({ marketResults: [liveFlightResult] })
);
const flightOnlyOptions = discoveryFlightOnly.transportOptions;

check("SJ<->Montreal: train is excluded NO_SERVICE, with the Saint John reason and no price", () => {
  const train = byMode(flightOnlyOptions, "train");
  assert.equal(train.availability, "not_available");
  assert.equal(train.presentation, "excluded");
  assert.equal(train.logic_rule, "NO_SERVICE");
  assert.match(train.presentation_label, /No passenger trains serve Saint John/);
  assert.match(train.presentation_label, /Moncton/);
  assert.equal(train.estimated_cost_min, null);
  assert.equal(train.estimated_cost_max, null);
});

check("SJ<->Montreal: the ~9.9h drive is excluded TOO_FAR_TO_DRIVE with its honest duration in the label", () => {
  const drive = byMode(flightOnlyOptions, "drive");
  assert.equal(drive.presentation, "excluded");
  assert.equal(drive.logic_rule, "TOO_FAR_TO_DRIVE");
  assert.match(drive.presentation_label, /Too far to drive/);
  assert.ok(drive.estimated_duration_hours > transportLib.DRIVE_TOO_FAR_HOURS, `drive hours ${drive.estimated_duration_hours}`);
  assert.ok(drive.estimated_duration_hours > 9.5 && drive.estimated_duration_hours < 10.5);
});

check("SJ<->Montreal: flight is the ONLY suggestion (FLIGHT_ONLY), bus and mixed excluded by the same rule", () => {
  const flight = byMode(flightOnlyOptions, "flight");
  assert.equal(flight.presentation, "suggested");
  assert.equal(flight.logic_rule, "FLIGHT_ONLY");
  assert.equal(flight.presentation_label, "Only option — too far to drive");
  for (const mode of ["bus", "mixed"]) {
    const option = byMode(flightOnlyOptions, mode);
    assert.equal(option.presentation, "excluded", `${mode} presentation`);
    assert.equal(option.logic_rule, "FLIGHT_ONLY", `${mode} rule`);
  }
  assert.equal(discoveryFlightOnly.recommendedTransportOption?.mode, "flight");
  assert.equal(
    discoveryFlightOnly.selectedTransportEstimateCents,
    transportLib.transportOptionCostCents(flight)
  );
});

check("SJ<->Montreal: the flight price is the live partner price, with named provenance and coverage", () => {
  const flight = byMode(flightOnlyOptions, "flight");
  assert.equal(flight.price_confidence, "live_partner");
  assert.equal(flight.source, "Travelpayouts");
  const provenance = transportLib.transportOptionProvenance(flight);
  assert.match(provenance, /^Live partner price · Travelpayouts · Round trip 2026-10-30 – 2026-11-02$/);
});

check("excluded options can never be selected (drive and train picks are refused unchanged)", () => {
  for (const mode of ["drive", "train"]) {
    const updated = discoveryLib.applyTransportOptionSelection(discoveryFlightOnly, byMode(flightOnlyOptions, mode));
    assert.equal(updated, discoveryFlightOnly, `${mode} selection must be a no-op`);
  }
});

// --- Case 2: same route, the traveller's answers say Drive (the
// owner's own trip shape). The stated need disarms the too-far rule.
const discoveryDrive = await discoveryLib.discoverTripPrices(baseInput({ transportationPreference: "Drive" }));
const driveOptions = discoveryDrive.transportOptions;

check("SJ<->Montreal with a Drive answer: driving is suggested by TRAVELLER_PREFERENCE, not excluded", () => {
  const drive = byMode(driveOptions, "drive");
  assert.equal(drive.presentation, "suggested");
  assert.equal(drive.logic_rule, "TRAVELLER_PREFERENCE");
  assert.equal(drive.presentation_label, "Suggested — the way you said you want to travel");
  assert.equal(discoveryDrive.recommendedTransportOption?.mode, "drive");
  assert.equal(discoveryDrive.selectedTransportEstimateCents, transportLib.transportOptionCostCents(drive));
  const flight = byMode(driveOptions, "flight");
  assert.equal(flight.presentation, "available");
});

check("drive shows an estimated gas allowance with the rate and its planning-assumption source named", () => {
  const drive = byMode(driveOptions, "drive");
  assert.equal(drive.cost_breakdown.gas_price_per_liter, 1.7);
  assert.ok(drive.cost_breakdown.fuel_liters > 120 && drive.cost_breakdown.fuel_liters < 140);
  const provenance = transportLib.transportOptionProvenance(drive);
  assert.match(provenance, /^Estimated gas allowance · 755 km · /);
  assert.match(provenance, /\$1\.70\/L/);
  assert.match(provenance, /not a live pump price/);
});

check("fuel consumption is keyed off vehicle class from the sourced NRCan table, not one assumed figure", () => {
  const drive = byMode(driveOptions, "drive");
  // No car type in the traveller's answers yet -> the sedan-class
  // default applies, and it is the NRCan-derived Camry figure.
  assert.equal(drive.cost_breakdown.vehicle_class, "sedan");
  assert.equal(drive.cost_breakdown.fuel_consumption_l_per_100km, 8.3);
  assert.match(drive.cost_breakdown.fuel_consumption_source, /Natural Resources Canada/);
  assert.match(drive.cost_breakdown.fuel_consumption_source, /Toyota Camry/);
  assert.equal(transportLib.FUEL_CONSUMPTION_BY_CLASS.compact.lPer100Km, 6.8);
  assert.equal(transportLib.FUEL_CONSUMPTION_BY_CLASS.pickup.lPer100Km, 12.7);
  // A pickup answer scales the fuel estimate by the F-150 figure.
  const pickupComparison = transportLib.compareTransportOptions(baseInput({ vehicleClass: "pickup" }), {
    flightEstimateCents: 30000
  });
  const pickupDrive = byMode(pickupComparison.options, "drive");
  assert.equal(pickupDrive.cost_breakdown.vehicle_class, "pickup");
  assert.equal(pickupDrive.cost_breakdown.fuel_consumption_l_per_100km, 12.7);
  assert.ok(
    pickupDrive.cost_breakdown.fuel_liters > 185 && pickupDrive.cost_breakdown.fuel_liters < 200,
    `pickup fuel liters ${pickupDrive.cost_breakdown.fuel_liters}`
  );
});

check("a model-priced flight is labelled a model estimate, never a searched fare", () => {
  const flight = byMode(driveOptions, "flight");
  assert.equal(flight.price_confidence, "estimated");
  assert.match(transportLib.transportOptionProvenance(flight), /Roamly model — not a searched fare/);
});

// --- Case 3: selection round-trip. The traveller overrides the map's
// drive suggestion and picks the flight: totals, persistence and the
// generated legs must all follow the pick.
const flightPick = byMode(driveOptions, "flight");
const discoveryPicked = discoveryLib.applyTransportOptionSelection(discoveryDrive, flightPick);

check("selecting the flight re-tabulates the trip total with the engine's own formula", () => {
  const flightCents = transportLib.transportOptionCostCents(flightPick);
  const fixedCents = discoveryDrive.totalEstimateCents - discoveryDrive.bufferEstimateCents - discoveryDrive.selectedTransportEstimateCents;
  const subtotal = fixedCents + flightCents;
  assert.equal(discoveryPicked.selectedTransportEstimateCents, flightCents);
  assert.equal(discoveryPicked.bufferEstimateCents, Math.round(subtotal * 0.12));
  assert.equal(discoveryPicked.totalEstimateCents, subtotal + Math.round(subtotal * 0.12));
  assert.ok(discoveryPicked.totalEstimateCents < discoveryDrive.totalEstimateCents);
  assert.equal(discoveryPicked.recommendedTransportOption?.mode, "flight");
  assert.deepEqual(discoveryPicked.transportSelection, { mode: "flight", title: flightPick.title, selectedBy: "traveler" });
  const transportConfidence = discoveryPicked.budgetCategoryConfidence.find((entry) => entry.category === "transport");
  assert.equal(transportConfidence.amountCents, flightCents);
});

check("the pick is stamped into the persisted discovery row and the generation constraint", () => {
  const row = discoveryLib.discoveryToDatabaseRow(discoveryPicked, { ...baseInput(), userId: "fixture-user" });
  assert.equal(row.source_summary.transportSelection.mode, "flight");
  assert.equal(row.metadata.transportSelection.mode, "flight");
  assert.match(discoveryLib.buildBudgetConstraintForItinerary(discoveryPicked), /Traveller-selected transport:/);
});

check("the generated legs follow the pick: flight out and back at the flight total-travel estimate", () => {
  // The payload mirrors what the plan form sends after a pick: the
  // full updated discovery (selection stamp included). The traveller's
  // older "Drive" preference string is still on the payload — the
  // confirmed pick must outrank it, or the budget (flight) and the
  // legs (drive) would silently disagree.
  const payload = baseInput({
    transportationPreference: "Drive",
    priceDiscovery: {
      transportOptions: discoveryPicked.transportOptions,
      recommendedTransportOption: discoveryPicked.recommendedTransportOption,
      transportSelection: discoveryPicked.transportSelection
    }
  });
  const trip = itineraryLib.repairItineraryForTravelRequirements(skeletonItinerary(DATES), payload);
  const leg = findByTitle(trip.daily_itinerary[3], "Return travel to Saint John");
  assert.ok(leg, "return leg exists");
  assert.equal(leg.travel_mode, "flight");
  assert.ok(leg.durationMinutes >= 230 && leg.durationMinutes <= 250, `expected ~240, got ${leg.durationMinutes}`);
});

check("without a selection stamp, the stated preference still leads (pre-feature behaviour preserved)", () => {
  const payload = baseInput({
    transportationPreference: "Drive",
    priceDiscovery: {
      transportOptions: discoveryPicked.transportOptions,
      recommendedTransportOption: discoveryPicked.recommendedTransportOption
    }
  });
  const trip = itineraryLib.repairItineraryForTravelRequirements(skeletonItinerary(DATES), payload);
  const leg = findByTitle(trip.daily_itinerary[3], "Return travel to Saint John");
  assert.equal(leg.travel_mode, "drive");
});

check("without an override, the generated legs follow the map's drive suggestion at ~596 min", () => {
  const payload = baseInput({
    transportationPreference: "Drive",
    priceDiscovery: {
      transportOptions: discoveryDrive.transportOptions,
      recommendedTransportOption: discoveryDrive.recommendedTransportOption
    }
  });
  const trip = itineraryLib.repairItineraryForTravelRequirements(skeletonItinerary(DATES), payload);
  const leg = findByTitle(trip.daily_itinerary[3], "Return travel to Saint John");
  assert.ok(leg, "return leg exists");
  assert.equal(leg.travel_mode, "drive");
  assert.ok(leg.durationMinutes >= 560 && leg.durationMinutes <= 630, `expected ~596-600, got ${leg.durationMinutes}`);
});

// --- Case 4: short haul, budget low. Ottawa -> Montreal, 2 days,
// $800: flying busts the stated budget under the trip's own fit
// formula while driving fits, so the map leads with driving.
const discoveryBudget = await discoveryLib.discoverTripPrices(
  baseInput({
    origin: "Ottawa",
    originCity: "Ottawa",
    startDate: "2026-10-30",
    endDate: "2026-10-31",
    daysCount: 2
  })
);

check("Ottawa->Montreal on a tight budget: driving is suggested by BUDGET_LOW_DRIVE, flight stays available but expensive", () => {
  const drive = byMode(discoveryBudget.transportOptions, "drive");
  assert.equal(drive.presentation, "suggested");
  assert.equal(drive.logic_rule, "BUDGET_LOW_DRIVE");
  assert.equal(drive.presentation_label, "Suggested — fits your budget");
  const flight = byMode(discoveryBudget.transportOptions, "flight");
  assert.equal(flight.presentation, "available");
  assert.equal(flight.budget_fit, "expensive");
  assert.equal(discoveryBudget.recommendedTransportOption?.mode, "drive");
});

check("Ottawa->Montreal drive duration is distance math (~158 min), not a fixed number", () => {
  const minutes = transportLib.estimateIntercityLegMinutes(
    baseInput({ origin: "Ottawa", originCity: "Ottawa", transportationPreference: "Drive" }),
    "drive"
  );
  assert.ok(minutes >= 140 && minutes <= 175, `expected ~158, got ${minutes}`);
});

// --- Case 5: corridor control. With real place objects (the
// production input shape), Ottawa -> Montreal rail IS search-ready —
// NO_SERVICE is a route fact, not a global train kill.
check("Ottawa->Montreal with place objects: train is available (search-ready), not excluded", () => {
  const place = (label) => ({ label, value: label, source: "google_places", country: "Canada", countryCode: "CA" });
  const comparison = transportLib.compareTransportOptions(
    baseInput({
      origin: "Ottawa",
      originCity: "Ottawa",
      originPlace: place("Ottawa, Canada"),
      destinationPlace: place("Montreal, Canada"),
      startDate: "2026-10-30",
      endDate: "2026-10-31",
      daysCount: 2
    }),
    { flightEstimateCents: 30000, fixedTripCostCents: 45400 }
  );
  const train = byMode(comparison.options, "train");
  assert.equal(train.availability, "search_ready");
  assert.equal(train.presentation, "available");
  assert.ok(train.estimated_cost_max > 0);
});

console.log(
  failed === 0
    ? `\nPASS: all ${passed} transport-options checks passed`
    : `\nFAIL: ${failed} of ${passed + failed} transport-options checks failed`
);
process.exit(failed === 0 ? 0 : 1);
