// roamly-transport-selection-save-checks.mjs — TRANSPORT PICK
// PERSISTENCE proof (Stage 7, 2026-11-11): the saved-trip
// transport seam that the assessment found UNBUILT, built as the
// twin of the stay seam (STAY-PICK-PERSISTENCE-REPORT). Before
// this stage: a traveller's transport pick existed only inside a
// generation (applyTransportOptionSelection + the
// transportSelection stamp); on a SAVED trip there was no save
// route at all, and both re-discovery paths (market refresh,
// re-generation) silently DROPPED the stamp — the logic map's
// recommendation took over again.
//
// Pins:
//   - prepareTransportSelectionSave (the route's pure core):
//     rehydrate the stored row, find the pick in the discovery's
//     OWN stored options, apply with the engine's formula, land
//     it in the itinerary breakdown — totals hand-checked against
//     the transport-options suite's arithmetic;
//   - the HONESTY law: the save never rewrites a day leg — the
//     returned itinerary's daily_itinerary is byte-identical to
//     the input's (an option's estimated duration never becomes
//     a leg's clock time);
//   - the saved row carries the stamp and a re-read reproduces
//     the pick exactly (transportSelectionFromRow);
//   - carryForwardTransportSelection: a fresh discovery keeps
//     the pick (stamp + totals re-tabulated from the FRESH fixed
//     costs, and the budget constraint names it "Traveller-
//     selected"); the pick is RELEASED — never repriced from
//     stale figures — when the option is gone or excluded;
//     no-selection trips pass through by reference;
//   - refusals: no discovery row, an unknown pick, and an
//     excluded (NO_SERVICE) pick can never be saved;
//   - STATIC wiring: the route (auth, confirmed-flight guard,
//     save + sync), and both carry sites (market refresh,
//     staged-generation context).
// Usage (from the tree root):
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//     scripts/roamly-transport-selection-save-checks.mjs
// Run under BOTH TZ=America/Moncton and TZ=UTC.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const discoveryLib = await import("../lib/roamly/priceDiscovery.ts");
const {
  discoverTripPrices,
  discoveryToDatabaseRow,
  discoveryFromDatabaseRow,
  applyTransportOptionSelection,
  carryForwardTransportSelection,
  transportSelectionFromRow,
  buildBudgetConstraintForItinerary
} = discoveryLib;
const transportLib = await import("../lib/roamly/transportOptions.ts");
const saveLib = await import("../lib/roamly/transportSelectionSave.ts");
const { prepareTransportSelectionSave, transportOptionKey, parseTransportOptionKey } = saveLib;

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
    userId: "user-fixture",
    tripId: "trip-fixture",
    ...overrides
  };
}
function skeletonItinerary() {
  return {
    trip_title: "Transport selection fixture",
    destination_summary: "",
    best_for: [],
    route_reasoning: "",
    budget_fit_summary: "",
    booking_status_summary: "",
    free_or_low_cost_notes: [],
    estimated_budget_breakdown: { total_estimate: "", transport: "", lodging: "", activities: "", food: "", buffer: "" },
    hotel_area_suggestions: [],
    transport_overview: "",
    daily_itinerary: DATES.map((date, index) => ({
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
      live_timeline:
        index === 0
          ? [{
              time_label: "09:00 – 11:30",
              startTime: "09:00",
              endTime: "11:30",
              title: "Drive from Saint John to Montreal",
              description: "Intercity drive.",
              location_name: "Montreal",
              category: "Transport",
              item_type: "travel",
              transportMode: "drive"
            }]
          : []
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
const byMode = (options, mode) => options.find((option) => option.mode === mode);

/* ---- fixture: drive recommended, flight pickable ----------------- */
const input = baseInput({ transportationPreference: "Drive" });
const discovery = await discoverTripPrices(input);
const driveOption = byMode(discovery.transportOptions, "drive");
const flightOption = byMode(discovery.transportOptions, "flight");
check("fixture: drive is the recommendation and a flight option exists to pick", () => {
  assert.equal(discovery.recommendedTransportOption?.mode, "drive");
  assert.ok(flightOption, "flight option present");
  assert.notEqual(flightOption.availability, "not_available");
  assert.notEqual(flightOption.presentation, "excluded");
});
const storedRow = discoveryToDatabaseRow(discovery, input);

/* ---- the save core ------------------------------------------------ */
const itinerary = skeletonItinerary();
const legsBefore = JSON.stringify(itinerary.daily_itinerary);
const prepared = prepareTransportSelectionSave({
  discoveryRow: storedRow,
  itinerary,
  optionKey: transportOptionKey(flightOption)
});
check("save: the flight pick applies with the traveller stamp", () => {
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.deepEqual(prepared.selection, { mode: "flight", title: flightOption.title, selectedBy: "traveler" });
  assert.equal(prepared.discovery.recommendedTransportOption?.mode, "flight");
});
check("save: totals are the engine's own re-tabulation for the picked option", () => {
  const direct = applyTransportOptionSelection(discoveryFromDatabaseRow(storedRow).discovery, flightOption);
  assert.equal(prepared.totals.transportEstimateCents, transportLib.transportOptionCostCents(flightOption));
  assert.equal(prepared.totals.transportEstimateCents, direct.selectedTransportEstimateCents);
  assert.equal(prepared.totals.totalEstimateCents, direct.totalEstimateCents);
  assert.equal(prepared.totals.bufferEstimateCents, direct.bufferEstimateCents);
});
check("save: the itinerary breakdown names the pick as the recommended transport", () => {
  const breakdown = prepared.itinerary.estimated_budget_breakdown;
  assert.equal(breakdown.recommended_transport_option?.mode, "flight");
  assert.equal(breakdown.recommended_transport_option?.title, flightOption.title);
  assert.ok(Array.isArray(breakdown.transport_options) && breakdown.transport_options.length === discovery.transportOptions.length);
});
check("HONESTY: the save never rewrites a day leg — daily_itinerary is byte-identical", () => {
  assert.equal(JSON.stringify(prepared.itinerary.daily_itinerary), legsBefore);
});
check("save: the new row carries the stamp and a re-read reproduces the pick exactly", () => {
  const savedRow = discoveryToDatabaseRow(prepared.discovery, prepared.input);
  assert.deepEqual(transportSelectionFromRow(savedRow), prepared.selection);
  const reread = discoveryFromDatabaseRow(savedRow);
  assert.equal(reread.discovery.totalEstimateCents, prepared.discovery.totalEstimateCents);
  assert.equal(reread.discovery.recommendedTransportOption?.mode, "flight");
});

/* ---- refusals ------------------------------------------------------ */
check("refusal: no discovery row -> NO_DISCOVERY_ROW", () => {
  const result = prepareTransportSelectionSave({ discoveryRow: null, itinerary, optionKey: transportOptionKey(flightOption) });
  assert.deepEqual(result, { ok: false, reason: "NO_DISCOVERY_ROW" });
});
check("refusal: an unknown pick -> OPTION_UNAVAILABLE", () => {
  const result = prepareTransportSelectionSave({ discoveryRow: storedRow, itinerary, optionKey: "flight::No such option" });
  assert.deepEqual(result, { ok: false, reason: "OPTION_UNAVAILABLE" });
});
check("refusal: a malformed key -> OPTION_UNAVAILABLE", () => {
  const result = prepareTransportSelectionSave({ discoveryRow: storedRow, itinerary, optionKey: "flight" });
  assert.deepEqual(result, { ok: false, reason: "OPTION_UNAVAILABLE" });
});
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
const flightOnlyDiscovery = await discoverTripPrices(baseInput({ marketResults: [liveFlightResult] }));
const flightOnlyRow = discoveryToDatabaseRow(flightOnlyDiscovery, baseInput({ userId: "user-fixture", tripId: "trip-fixture" }));
check("refusal: the NO_SERVICE train (excluded by rule) can never be saved", () => {
  const train = byMode(flightOnlyDiscovery.transportOptions, "train");
  assert.equal(train.presentation, "excluded");
  const result = prepareTransportSelectionSave({
    discoveryRow: flightOnlyRow,
    itinerary,
    optionKey: transportOptionKey(train)
  });
  assert.deepEqual(result, { ok: false, reason: "SELECTION_NOT_APPLIED" });
});
check("option key round-trips through parse", () => {
  assert.deepEqual(parseTransportOptionKey(transportOptionKey(flightOption)), {
    mode: flightOption.mode,
    title: flightOption.title
  });
});

/* ---- carry-forward -------------------------------------------------- */
check("carry: a fresh discovery keeps the pick, re-tabulated from the fresh costs", async () => {
  const fresh = await discoverTripPrices(input);
  const carried = carryForwardTransportSelection(fresh, prepared.selection);
  assert.deepEqual(carried.transportSelection, prepared.selection);
  const direct = applyTransportOptionSelection(fresh, byMode(fresh.transportOptions, "flight"));
  assert.equal(carried.totalEstimateCents, direct.totalEstimateCents);
  assert.equal(carried.selectedTransportEstimateCents, direct.selectedTransportEstimateCents);
});
check("carry: the budget constraint names it traveller-selected (generation honours the stamp)", () => {
  const carried = carryForwardTransportSelection(discovery, prepared.selection);
  assert.ok(buildBudgetConstraintForItinerary(carried).includes("Traveller-selected transport"));
});
check("carry: no selection passes the fresh discovery through by reference", () => {
  assert.equal(carryForwardTransportSelection(discovery, null), discovery);
  assert.equal(carryForwardTransportSelection(discovery, undefined), discovery);
});
check("carry: a pick the fresh discovery no longer offers is RELEASED by reference", async () => {
  const elsewhere = await discoverTripPrices(baseInput({ destination: "Halifax", destinationCity: "Halifax" }));
  const result = carryForwardTransportSelection(elsewhere, prepared.selection);
  assert.equal(result, elsewhere);
  assert.ok(!result.transportSelection);
});
check("carry: a pick that became excluded is RELEASED, never forced", () => {
  const result = carryForwardTransportSelection(flightOnlyDiscovery, { mode: "train", title: byMode(flightOnlyDiscovery.transportOptions, "train").title, selectedBy: "traveler" });
  assert.equal(result, flightOnlyDiscovery);
  assert.ok(!result.transportSelection);
});

/* ---- wiring ---------------------------------------------------------- */
const routeSource = readFileSync(new URL("../app/api/trips/[id]/transport-selection/route.ts", import.meta.url), "utf8");
check("wiring: the route exists with auth, the confirmed-flight guard, save + sync", () => {
  assert.ok(routeSource.includes("requireUser"));
  assert.ok(routeSource.includes("prepareTransportSelectionSave"));
  assert.ok(routeSource.includes("TRANSPORT_ALREADY_BOOKED"));
  assert.ok(routeSource.includes('booking_type === "flight"'));
  assert.ok(routeSource.includes("savePriceDiscovery"));
  assert.ok(routeSource.includes("syncGeneratedItinerary"));
});
const refreshSource = readFileSync(new URL("../lib/roamly/marketPriceRefresh.ts", import.meta.url), "utf8");
check("wiring: market refresh carries the transport pick forward", () => {
  assert.ok(refreshSource.includes("loadPreviousTransportSelection"));
  assert.ok(refreshSource.includes("carryForwardTransportSelection(stayCarriedDiscovery, previousTransportSelection)"));
});
const stagedSource = readFileSync(new URL("../lib/roamly/stagedItineraryGeneration.ts", import.meta.url), "utf8");
const generationDiscoverySource = readFileSync(new URL("../lib/roamly/generationDiscovery.ts", import.meta.url), "utf8");
check("wiring: staged-generation context carries the transport pick forward", () => {
  // The segment moved verbatim into the shared helper
  // (discovery-persistence fix, 2026-11-11): the carry-forward is
  // pinned there, the staged prep's delegation is pinned here.
  assert.ok(generationDiscoverySource.includes("loadStoredTransportSelection"));
  assert.ok(generationDiscoverySource.includes("carryForwardTransportSelection(generationDiscovery, storedTransport)"));
  assert.ok(stagedSource.includes("prepareGenerationDiscovery"));
});

console.log(`\ntransport-selection-save: ${passed}/${passed + failed} checks passed.`);
if (failed) {
  console.error(`transport-selection-save: ${failed} FAILURES`);
  process.exit(1);
}
console.log("PASS roamly-transport-selection-save-checks");
process.exit(0);
