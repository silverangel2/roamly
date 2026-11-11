// roamly-stay-pick-persistence-checks.mjs — STAY PICK PERSISTENCE
// proof (the write-back seam for the hotel selector): a traveller's
// pick must survive — pick → save → reload shows the SAME stay at
// the SAME totals; a re-generation / refresh with a stored pick
// keeps the picked stay; a trip with no pick is untouched.
// Pins, on fixtures with GENERIC place names:
//   - discoveryFromDatabaseRow is the inverse of
//     discoveryToDatabaseRow (cents, stamps, options round-trip);
//   - prepareStaySelectionSave (the route's pure core): rehydrate
//     the stored row, build options from the trip's own stored
//     suggestions, apply the pick with the engine's formula, and
//     land it in the itinerary breakdown — arithmetic hand-checked
//     against the hotel-selector suite's numbers;
//   - the saved row carries the stamp in BOTH metadata and
//     source_summary plus the re-tabulated cent columns, and a
//     re-read of that row reproduces the pick exactly;
//   - carryForwardStaySelection: a fresh discovery (re-generation)
//     with a stored pick keeps the picked stay — stamp + stay line
//     re-tabulated from the FRESH fixed costs; the pick is released
//     (never repriced from stale figures) when the candidate is
//     gone or no longer priced; no-selection trips pass through
//     by reference;
//   - refusals: no discovery row, an unpriced pick, an unknown
//     pick, and a hotel-excluded budget can never be saved;
//   - STATIC wiring: the route, the selector's save call, the
//     page's stored-pick hand-off, and both honouring call sites.
// Usage (from the tree root):
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//     scripts/roamly-stay-pick-persistence-checks.mjs
// Run under BOTH TZ=America/Moncton and TZ=UTC.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const discoveryLib = await import("../lib/roamly/priceDiscovery.ts");
const { discoveryToDatabaseRow, discoveryFromDatabaseRow, applyPriceDiscoveryToItinerary } = discoveryLib;
const stayLib = await import("../lib/roamly/stayOptions.ts");
const { buildStayOptions, carryForwardStaySelection } = stayLib;
const saveLib = await import("../lib/roamly/staySelectionSave.ts");
const { prepareStaySelectionSave } = saveLib;

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

// ---- Fixtures (the hotel-selector suite's numbers, hand-checked there) ----
const NIGHTS = 4;
function hotelSuggestion(overrides = {}) {
  return {
    category: "hotel",
    booking_category: "hotel",
    title: "Harborview Hotel",
    description: "",
    booking_status: "needs_booking",
    booking_label: "Book stay options",
    normal_search_url: "https://www.stay22.com/",
    estimated_cost_min: null,
    estimated_cost_max: null,
    currency: "CAD",
    price_confidence: "live",
    ...overrides
  };
}
const suggestionA = hotelSuggestion({
  candidateId: "fixture-a",
  title: "Harborview Hotel",
  neighborhood: "Old Town",
  room_type: "Queen room",
  price_type: "live_partner",
  price_confidence: "live",
  estimated_total_cost_min: 612,
  estimated_total_cost_max: 688,
  estimated_nightly_cost_min: 153,
  estimated_nightly_cost_max: 172,
  provider: "Stay22"
});
const suggestionB = hotelSuggestion({
  candidateId: "fixture-b",
  title: "Old Town Suites",
  neighborhood: "Old Town",
  room_type: "Studio suite",
  price_type: "cached_recent",
  price_confidence: "estimated",
  estimated_total_cost_min: 540,
  estimated_total_cost_max: 596,
  estimated_nightly_cost_min: 135,
  estimated_nightly_cost_max: 149,
  provider: "Stay22"
});
const suggestionC = hotelSuggestion({
  candidateId: "fixture-c",
  title: "Jardin Lodge",
  neighborhood: "Garden District",
  price_type: "estimated",
  price_confidence: "unknown",
  estimated_total_cost_min: 470,
  estimated_total_cost_max: 520,
  estimated_nightly_cost_min: 118,
  estimated_nightly_cost_max: 130,
  provider: "Stay22"
});

// Totals are internally consistent with the engine formula:
// 30000 + 65000 + 25000 + 35000 + 18700 = 173700; × 12% buffer
// (on the 173700 subtotal) = 20844; total 194544.
function fixtureDiscovery(overrides = {}) {
  return {
    tripType: "single_destination",
    origin: "Saint John",
    destination: "Montreal",
    destinationStops: [],
    returnToOrigin: true,
    flexibleCityOrder: false,
    flexibleDates: false,
    startDate: "2026-11-20",
    endDate: "2026-11-24",
    daysCount: 5,
    travelersCount: 2,
    travelers: { adults: 2, children: 0, infants: 0 },
    rooms: 1,
    bedPreference: "Queen",
    budgetAmount: 2600,
    budgetCurrency: "CAD",
    budgetIncludesFlights: true,
    budgetIncludesHotel: true,
    budgetIncludesActivities: true,
    flightEstimateCents: 30000,
    hotelEstimateCents: 65000,
    activitiesEstimateCents: 25000,
    foodEstimateCents: 35000,
    localTransportEstimateCents: 18700,
    selectedTransportEstimateCents: 30000,
    bufferEstimateCents: 20844,
    totalEstimateCents: 194544,
    committedBudgetCents: null,
    committedBookingCostStatus: "known_compatible",
    committedBookingKnownCents: 0,
    committedBookingCurrencies: [],
    remainingBudgetCents: 65456,
    budgetStatus: "within_budget",
    coverageNote: "Fixture coverage.",
    hotelNights: 4,
    hotelNightlyEstimateCents: 16250,
    hotelTaxesFeesBufferCents: 0,
    hotelEstimateNote: "Fixture hotel estimate.",
    budgetCategoryConfidence: [
      { category: "transport", label: "Live price", amountCents: 30000, source: "Travelpayouts", note: "" },
      { category: "hotel", label: "Conservative estimate", amountCents: 65000, source: "Roamly conservative hotel estimate", note: "estimate" }
    ],
    routeLegs: [],
    transportOptions: [],
    recommendedTransportOption: null,
    transportSelection: { mode: "flight", title: "Flight", selectedBy: "traveler" },
    stayOptions: [],
    staySelection: null,
    transportAssumptions: [],
    cityEstimates: [],
    recommendationNotes: [],
    sources: [{ provider: "fixture", label: "Fixture", confidence: "high" }],
    marketResults: [],
    selectedMarketPrices: [],
    unknownMarketPriceCount: 0,
    unknownMarketPriceCategories: [],
    priceCoverage: "partial",
    cross_border: false,
    crossBorderWarnings: [],
    originCurrency: "CAD",
    destinationCurrency: "CAD",
    currencyChange: false,
    ...overrides
  };
}
const fixtureInput = {
  userId: "user-fixture",
  tripId: "trip-fixture",
  destination: "Montreal",
  accommodationPreference: "Hotel",
  travelStyle: "Balanced",
  pace: "Balanced",
  walkingTolerance: "Medium",
  transportationPreference: "Mixed",
  accessibilityNeeds: "",
  dietaryPreference: "",
  interests: ["food"]
};
const fixtureItinerary = {
  booking_suggestions: [suggestionA, suggestionB, suggestionC],
  estimated_budget_breakdown: {},
  daily_itinerary: []
};

// ---- Round-trip: row → discovery is the writer's inverse ----
check("round-trip: cents, stamps and options survive row → discovery", () => {
  const options = buildStayOptions([suggestionA, suggestionB, suggestionC], NIGHTS);
  const discovery = fixtureDiscovery({ stayOptions: options });
  const row = discoveryToDatabaseRow(discovery, fixtureInput);
  const back = discoveryFromDatabaseRow(row);
  assert.ok(back, "rehydration returned null");
  assert.equal(back.discovery.hotelEstimateCents, 65000);
  assert.equal(back.discovery.bufferEstimateCents, 20844);
  assert.equal(back.discovery.totalEstimateCents, 194544);
  assert.equal(back.discovery.remainingBudgetCents, 65456);
  assert.equal(back.discovery.budgetAmount, 2600);
  assert.equal(back.discovery.budgetStatus, "within_budget");
  assert.equal(back.discovery.staySelection, null);
  assert.deepEqual(back.discovery.transportSelection, { mode: "flight", title: "Flight", selectedBy: "traveler" });
  assert.deepEqual(back.discovery.stayOptions.map((o) => o.id), ["fixture-a", "fixture-b", "fixture-c"]);
  assert.equal(back.discovery.stayOptions[1].totalMin, 540);
  assert.equal(back.input.userId, "user-fixture");
  assert.equal(back.input.tripId, "trip-fixture");
  assert.deepEqual(back.input.interests, ["food"]);
});
check("round-trip: an empty/garbage row rehydrates to null, never a phantom discovery", () => {
  assert.equal(discoveryFromDatabaseRow(null), null);
  assert.equal(discoveryFromDatabaseRow({}), null);
  assert.equal(discoveryFromDatabaseRow("nope"), null);
});

// ---- Pick → save → reload (the seam's whole point) ----
const rowBeforePick = discoveryToDatabaseRow(fixtureDiscovery(), fixtureInput);
const prepared = prepareStaySelectionSave({
  discoveryRow: rowBeforePick,
  itinerary: fixtureItinerary,
  optionId: "fixture-b",
  nights: NIGHTS
});
check("save: the pick applies with the engine's formula (hand-checked)", () => {
  assert.equal(prepared.ok, true);
  // Pick B costs its midpoint 56800; fixed = 108700; subtotal
  // 165500; buffer 19860; total 185360; remaining 260000 − 185360.
  assert.deepEqual(prepared.totals, { stayEstimateCents: 56800, bufferEstimateCents: 19860, totalEstimateCents: 185360 });
  assert.deepEqual(prepared.selection, { candidateId: "fixture-b", title: "Old Town Suites", selectedBy: "traveler" });
  assert.equal(prepared.discovery.remainingBudgetCents, 74640);
});
check("save: the itinerary breakdown the page reads carries the pick", () => {
  assert.equal(prepared.itinerary.estimated_budget_breakdown.selected_hotel_estimate_amount, 568);
  assert.equal(prepared.itinerary.estimated_budget_breakdown.total_estimate_amount, 1854);
  assert.equal(prepared.itinerary.estimated_budget_breakdown.buffer_estimate_amount, 199);
});
const savedRow = prepared.ok ? discoveryToDatabaseRow(prepared.discovery, prepared.input) : null;
check("save: the new discovery row stamps the pick in metadata AND source_summary", () => {
  assert.ok(savedRow);
  assert.equal(savedRow.hotel_estimate_cents, 56800);
  assert.equal(savedRow.total_estimate_cents, 185360);
  assert.equal(savedRow.remaining_budget_cents, 74640);
  assert.deepEqual(savedRow.metadata.staySelection, { candidateId: "fixture-b", title: "Old Town Suites", selectedBy: "traveler" });
  assert.deepEqual(savedRow.source_summary.staySelection, { candidateId: "fixture-b", title: "Old Town Suites", selectedBy: "traveler" });
  assert.equal(savedRow.metadata.stayOptions.find((o) => o.id === "fixture-b").suggested, true);
});
check("reload: re-reading the saved row reproduces the pick and its totals exactly", () => {
  const back = discoveryFromDatabaseRow(savedRow);
  assert.ok(back);
  assert.deepEqual(back.discovery.staySelection, { candidateId: "fixture-b", title: "Old Town Suites", selectedBy: "traveler" });
  assert.equal(back.discovery.hotelEstimateCents, 56800);
  assert.equal(back.discovery.bufferEstimateCents, 19860);
  assert.equal(back.discovery.totalEstimateCents, 185360);
  assert.equal(back.discovery.remainingBudgetCents, 74640);
  const breakdown = applyPriceDiscoveryToItinerary(fixtureItinerary, back.discovery).estimated_budget_breakdown;
  assert.equal(breakdown.selected_hotel_estimate_amount, 568);
  assert.equal(breakdown.total_estimate_amount, 1854);
});

// ---- Refusals: nothing un-saveable ever reaches the row ----
check("refusal: no discovery row → NO_DISCOVERY_ROW", () => {
  const result = prepareStaySelectionSave({ discoveryRow: null, itinerary: fixtureItinerary, optionId: "fixture-b", nights: NIGHTS });
  assert.deepEqual(result, { ok: false, reason: "NO_DISCOVERY_ROW" });
});
check("refusal: an unpriced stay can never be saved as a pick", () => {
  const result = prepareStaySelectionSave({ discoveryRow: rowBeforePick, itinerary: fixtureItinerary, optionId: "fixture-c", nights: NIGHTS });
  assert.deepEqual(result, { ok: false, reason: "OPTION_UNAVAILABLE" });
});
check("refusal: a stay the trip does not carry can never be saved", () => {
  const result = prepareStaySelectionSave({ discoveryRow: rowBeforePick, itinerary: fixtureItinerary, optionId: "fixture-zzz", nights: NIGHTS });
  assert.deepEqual(result, { ok: false, reason: "OPTION_UNAVAILABLE" });
});
check("refusal: a hotel-excluded budget keeps its totals — pick not applied", () => {
  const row = discoveryToDatabaseRow(fixtureDiscovery({ budgetIncludesHotel: false }), fixtureInput);
  const result = prepareStaySelectionSave({ discoveryRow: row, itinerary: fixtureItinerary, optionId: "fixture-b", nights: NIGHTS });
  assert.deepEqual(result, { ok: false, reason: "SELECTION_NOT_APPLIED" });
});

// ---- Re-generation / refresh honouring ----
check("carry: a fresh discovery keeps the picked stay, re-tabulated from fresh costs", () => {
  // Fresh fixed costs: total 190400, buffer 20400, hotel estimate
  // 70000 → fixed = 100000. Pick B (56800): subtotal 156800,
  // buffer 18816, total 175616, remaining 84384.
  const fresh = fixtureDiscovery({ hotelEstimateCents: 70000, bufferEstimateCents: 20400, totalEstimateCents: 190400, remainingBudgetCents: 69600 });
  const options = buildStayOptions([suggestionA, suggestionB, suggestionC], NIGHTS);
  const carried = carryForwardStaySelection(fresh, { candidateId: "fixture-b", title: "Old Town Suites", selectedBy: "traveler" }, options);
  assert.notEqual(carried, fresh);
  assert.equal(carried.hotelEstimateCents, 56800);
  assert.equal(carried.bufferEstimateCents, 18816);
  assert.equal(carried.totalEstimateCents, 175616);
  assert.equal(carried.remainingBudgetCents, 84384);
  assert.deepEqual(carried.staySelection, { candidateId: "fixture-b", title: "Old Town Suites", selectedBy: "traveler" });
  // The fresh discovery object itself is untouched (pure function).
  assert.equal(fresh.staySelection, null);
  assert.equal(fresh.hotelEstimateCents, 70000);
});
check("carry: the pick is released when the candidate is gone — never repriced stale", () => {
  const fresh = fixtureDiscovery({ hotelEstimateCents: 70000, bufferEstimateCents: 20400, totalEstimateCents: 190400 });
  const withoutB = buildStayOptions([suggestionA, suggestionC], NIGHTS);
  const result = carryForwardStaySelection(fresh, { candidateId: "fixture-b", title: "Old Town Suites", selectedBy: "traveler" }, withoutB);
  assert.equal(result, fresh);
  assert.equal(result.staySelection, null);
});
check("carry: the pick is released when the candidate lost its price", () => {
  const fresh = fixtureDiscovery({ hotelEstimateCents: 70000, bufferEstimateCents: 20400, totalEstimateCents: 190400 });
  const unpricedB = { ...suggestionB, price_type: "estimated", price_confidence: "unknown" };
  const options = buildStayOptions([suggestionA, unpricedB, suggestionC], NIGHTS);
  const result = carryForwardStaySelection(fresh, { candidateId: "fixture-b", title: "Old Town Suites", selectedBy: "traveler" }, options);
  assert.equal(result, fresh);
});
check("carry: a trip with no stored pick passes through untouched", () => {
  const fresh = fixtureDiscovery();
  const options = buildStayOptions([suggestionA, suggestionB, suggestionC], NIGHTS);
  assert.equal(carryForwardStaySelection(fresh, null, options), fresh);
  assert.equal(carryForwardStaySelection(fresh, undefined, options), fresh);
});

// ---- STATIC: the seam is wired end to end ----
const route = readFileSync(new URL("../app/api/trips/[id]/stay-selection/route.ts", import.meta.url), "utf8");
const selector = readFileSync(new URL("../components/trip/StaySelector.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/trip/[id]/page.tsx", import.meta.url), "utf8");
const refresh = readFileSync(new URL("../lib/roamly/marketPriceRefresh.ts", import.meta.url), "utf8");
const staged = readFileSync(new URL("../lib/roamly/stagedItineraryGeneration.ts", import.meta.url), "utf8");
const generationDiscovery = readFileSync(new URL("../lib/roamly/generationDiscovery.ts", import.meta.url), "utf8");
const discoverySource = readFileSync(new URL("../lib/roamly/priceDiscovery.ts", import.meta.url), "utf8");

check("STATIC route: the surface's save pattern, auth-first, confirmed-stay guard", () => {
  for (const needle of [
    "requireUser", "getTripBundle", "prepareStaySelectionSave",
    "savePriceDiscovery", "syncGeneratedItinerary",
    "STAY_ALREADY_BOOKED", "getConfirmedBookingsForItinerary"
  ]) assert.ok(route.includes(needle), `route missing ${needle}`);
});
check("STATIC selector: opens on the stored pick, saves on pick, refreshes on success", () => {
  for (const needle of [
    "initialSelectionId", "/stay-selection", "router.refresh()",
    "setSelectedId(previousId)", "saveFailed"
  ]) assert.ok(selector.includes(needle), `selector missing ${needle}`);
});
check("STATIC page: the stored pick is handed to the selector", () => {
  assert.ok(page.includes("staySelectionId={"), "page does not pass staySelectionId");
  assert.ok(page.includes("initialSelectionId={staySelectionId}"), "PackageStays does not forward the pick");
  assert.ok(page.includes("persistedPriceDiscovery.staySelection"), "page does not read the stored stamp");
});
check("STATIC honouring: refresh and generation both carry the pick forward", () => {
  assert.ok(refresh.includes("carryForwardStaySelection"), "refresh drops the pick");
  assert.ok(refresh.includes("loadPreviousStaySelection"), "refresh never loads the pick");
  // The generation-side segment moved verbatim into the shared
  // helper (discovery-persistence fix, 2026-11-11): the honouring
  // mechanics are pinned there, the delegation is pinned on staged.
  assert.ok(generationDiscovery.includes("carryForwardStaySelection"), "generation drops the pick");
  assert.ok(generationDiscovery.includes("loadStoredStaySelection"), "generation never loads the pick");
  assert.ok(staged.includes("prepareGenerationDiscovery"), "generation no longer runs the shared discovery segment");
  assert.ok(discoverySource.includes("export function discoveryFromDatabaseRow"), "rehydrator missing");
});

console.log(`\n${passed} stay-pick-persistence checks passed, ${failed} failed.`);
if (failed) process.exit(1);
