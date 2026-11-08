// roamly-hotel-selector-checks.mjs — HOTEL SELECTOR proof (owner
// order, 2026-11-08: the detailed itinerary had "no selector for
// hotel"). Pins, on fixtures with GENERIC place names:
//   - buildStayOptions: the stored hotel suggestions become options
//     under the stay surface's own price-display rule (a price shows
//     only for a live-partner / recently-searched price with usable
//     amounts and confidence other than "unknown" — estimate-only
//     numbers on a named property NEVER become its price);
//   - a range costs its midpoint (the transport optionAverage rule);
//     a nightly-only price derives its total as nightly × nights;
//   - retabulateStayTotals + applyStayOptionSelection: picking a
//     stay moves the trip total by exactly the stay delta under the
//     engine's own formula (fixed costs untouched, buffer stays
//     12%, budget status recomputed by calculateBudgetStatus), and
//     stamps staySelection { selectedBy: "traveler" };
//   - guards: an unpriced stay, a foreign option, and a
//     hotel-excluded budget can never be applied;
//   - STATIC face law on the selector + panel + page wiring:
//     BoardUI recipe, radio semantics, the picked line, the quiet
//     line, one provenance line, no black.
// Usage (from the tree root):
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//     scripts/roamly-hotel-selector-checks.mjs
// Run under BOTH TZ=America/Moncton and TZ=UTC.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const stayLib = await import("../lib/roamly/stayOptions.ts");
const { buildStayOptions, stayOptionCostCents, stayPriceDisplayable, retabulateStayTotals, applyStayOptionSelection } = stayLib;

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

const NIGHTS = 4;
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
  provider: "Stay22",
  photo_urls: ["https://example.invalid/harborview.jpg"]
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
  // Estimate-only numbers on a named property: never its price.
  price_type: "estimated",
  price_confidence: "unknown",
  estimated_total_cost_min: 470,
  estimated_total_cost_max: 520,
  estimated_nightly_cost_min: 118,
  estimated_nightly_cost_max: 130,
  provider: "Stay22"
});
const suggestionD = hotelSuggestion({
  candidateId: "fixture-d",
  title: "Riverside Rooms",
  // Nightly figures only: the whole-stay range is nightly × nights.
  price_type: "live_partner",
  price_confidence: "live",
  estimated_nightly_cost_min: 100,
  estimated_nightly_cost_max: 120,
  provider: "Stay22"
});
const suggestionE = hotelSuggestion({
  candidateId: "fixture-e",
  title: "Grand Harbor Hotel",
  price_type: "live_partner",
  price_confidence: "live",
  estimated_total_cost_min: 1500,
  estimated_total_cost_max: 1700,
  estimated_nightly_cost_min: 375,
  estimated_nightly_cost_max: 425,
  provider: "Stay22"
});
const flightSuggestion = hotelSuggestion({ category: "flight", booking_category: "flight", title: "Flight to Destination City" });

const options = buildStayOptions([suggestionA, suggestionB, suggestionC, suggestionD, flightSuggestion], NIGHTS);
const byId = Object.fromEntries(options.map((option) => [option.id, option]));

check("options: hotel suggestions only, order and count preserved", () => {
  assert.equal(options.length, 4);
  assert.deepEqual(options.map((o) => o.title), ["Harborview Hotel", "Old Town Suites", "Jardin Lodge", "Riverside Rooms"]);
});
check("displayable rule: live and cached prices show; estimate-only never does", () => {
  assert.equal(stayPriceDisplayable(suggestionA), true);
  assert.equal(stayPriceDisplayable(suggestionB), true);
  assert.equal(stayPriceDisplayable(suggestionC), false);
  // A live price with unknown confidence is still not displayable.
  assert.equal(stayPriceDisplayable({ ...suggestionA, price_confidence: "unknown" }), false);
  // A search-ready price is not a partner price.
  assert.equal(stayPriceDisplayable({ ...suggestionA, price_type: "search_ready" }), false);
});
check("option A: stored total + nightly ranges, live provenance, suggested", () => {
  const a = byId["fixture-a"];
  assert.equal(a.totalMin, 612);
  assert.equal(a.totalMax, 688);
  assert.equal(a.nightlyMin, 153);
  assert.equal(a.nightlyMax, 172);
  assert.equal(a.priceType, "live_partner");
  assert.equal(a.suggested, true);
  assert.equal(a.area, "Old Town");
  assert.equal(a.roomType, "Queen room");
  assert.equal(a.photoUrl, "https://example.invalid/harborview.jpg");
});
check("option C: unpriced — no totals, no nightly, no provenance, not suggested", () => {
  const c = byId["fixture-c"];
  assert.equal(c.totalMin, null);
  assert.equal(c.totalMax, null);
  assert.equal(c.nightlyMin, null);
  assert.equal(c.priceType, null);
  assert.equal(c.suggested, false);
});
check("option D: nightly-only price derives the total as nightly × nights", () => {
  const d = byId["fixture-d"];
  assert.equal(d.totalMin, 400);
  assert.equal(d.totalMax, 480);
  assert.equal(d.nightlyMin, 100);
});
check("cost: a range costs its midpoint (the transport rule)", () => {
  assert.equal(stayOptionCostCents(byId["fixture-a"]), 65000);
  assert.equal(stayOptionCostCents(byId["fixture-b"]), 56800);
  assert.equal(stayOptionCostCents(byId["fixture-d"]), 44000);
  assert.equal(stayOptionCostCents(byId["fixture-c"]), null);
  assert.equal(stayOptionCostCents(null), null);
});

// ---- Re-tabulation arithmetic, hand-checked ----
// Fixture totals are internally consistent with the engine formula:
// fixed = 194544 − 20844 − 65000 = 108700; 173700 × 12% = 20844.
const CURRENT = { totalEstimateCents: 194544, bufferEstimateCents: 20844, stayEstimateCents: 65000 };
check("retabulate: picking the CAD 568 stay moves the total by exactly the formula", () => {
  // subtotal = 108700 + 56800 = 165500; buffer = 165500 × 0.12 = 19860; total = 185360.
  assert.deepEqual(retabulateStayTotals(CURRENT, 56800), {
    stayEstimateCents: 56800,
    bufferEstimateCents: 19860,
    totalEstimateCents: 185360
  });
});
check("retabulate: re-picking a stay priced at the current line is the identity", () => {
  assert.deepEqual(retabulateStayTotals(CURRENT, 65000), {
    stayEstimateCents: 65000,
    bufferEstimateCents: 20844,
    totalEstimateCents: 194544
  });
});

// ---- Discovery-level selection (the transport mirror) ----
function fixtureDiscovery(overrides = {}) {
  return {
    budgetAmount: 2600,
    budgetCurrency: "CAD",
    budgetIncludesHotel: true,
    hotelEstimateCents: 65000,
    bufferEstimateCents: 20844,
    totalEstimateCents: 194544,
    committedBudgetCents: null,
    committedBookingCostStatus: "known_compatible",
    remainingBudgetCents: 65456,
    budgetStatus: "within_budget",
    stayOptions: buildStayOptions([suggestionA, suggestionB, suggestionC], NIGHTS),
    staySelection: null,
    budgetCategoryConfidence: [
      { category: "transport", label: "Live price", amountCents: 30000, source: "Travelpayouts", note: "" },
      { category: "hotel", label: "Conservative estimate", amountCents: 65000, source: "Roamly conservative hotel estimate", note: "estimate" }
    ],
    ...overrides
  };
}

check("apply: pick B re-tabulates, stamps staySelection, updates hotel confidence", () => {
  const discovery = fixtureDiscovery();
  const next = applyStayOptionSelection(discovery, byId["fixture-b"]);
  assert.equal(next.hotelEstimateCents, 56800);
  assert.equal(next.bufferEstimateCents, 19860);
  assert.equal(next.totalEstimateCents, 185360);
  assert.equal(next.remainingBudgetCents, 74640);
  assert.equal(next.budgetStatus, "within_budget");
  assert.deepEqual(next.staySelection, { candidateId: "fixture-b", title: "Old Town Suites", selectedBy: "traveler" });
  const hotel = next.budgetCategoryConfidence.find((entry) => entry.category === "hotel");
  assert.equal(hotel.label, "Recently searched");
  assert.equal(hotel.amountCents, 56800);
  assert.equal(hotel.note, "Recently searched hotel price used. Refresh before booking.");
  const transport = next.budgetCategoryConfidence.find((entry) => entry.category === "transport");
  assert.equal(transport.amountCents, 30000);
  assert.equal(next.stayOptions.find((o) => o.id === "fixture-b").suggested, true);
  assert.equal(next.stayOptions.find((o) => o.id === "fixture-a").suggested, false);
  // The original discovery is untouched (pure function).
  assert.equal(discovery.hotelEstimateCents, 65000);
  assert.equal(discovery.staySelection, null);
});
check("apply: a pricier pick can push the trip over budget — status recomputed", () => {
  const pricey = buildStayOptions([suggestionE], NIGHTS)[0];
  const discovery = fixtureDiscovery({ stayOptions: [pricey] });
  const next = applyStayOptionSelection(discovery, pricey);
  // cost 160000; subtotal = 108700 + 160000 = 268700; buffer = 32244; total = 300944.
  assert.equal(next.totalEstimateCents, 300944);
  assert.equal(next.budgetStatus, "over_budget");
  assert.equal(next.remainingBudgetCents, -40944);
});
check("guard: an unpriced stay can never be applied", () => {
  const discovery = fixtureDiscovery();
  const next = applyStayOptionSelection(discovery, byId["fixture-c"]);
  assert.equal(next.totalEstimateCents, 194544);
  assert.equal(next.staySelection, null);
});
check("guard: a foreign option (not the discovery's own) can never be applied", () => {
  const discovery = fixtureDiscovery();
  const foreign = { ...byId["fixture-b"], id: "fixture-zzz" };
  const next = applyStayOptionSelection(discovery, foreign);
  assert.equal(next.totalEstimateCents, 194544);
  assert.equal(next.staySelection, null);
});
check("guard: a hotel-excluded budget keeps its totals untouched", () => {
  const discovery = fixtureDiscovery({ budgetIncludesHotel: false });
  const next = applyStayOptionSelection(discovery, byId["fixture-b"]);
  assert.equal(next.totalEstimateCents, 194544);
  assert.equal(next.staySelection, null);
});

// ---- STATIC: face law + BoardUI wiring ----
const selector = readFileSync(new URL("../components/trip/StaySelector.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/trip/ItineraryHomePanel.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/trip/[id]/page.tsx", import.meta.url), "utf8");

check("STATIC selector: radio-card recipe, BoardUI skin, cascade, badge pop", () => {
  for (const needle of [
    'role="radiogroup"', 'role="radio"', "aria-checked",
    "bui-squircle", "rounded-bui-card", "shadow-bui-card",
    "border-cblue bg-cblue/5 ring-1 ring-cblue",
    "bui-enter", "bui-press", "bui-tap", "bui-badge-pop",
    '"--bui-delay"', "index * 70"
  ]) assert.ok(selector.includes(needle), `selector missing ${needle}`);
});
check("STATIC selector: the face law's exact lines, word budget kept", () => {
  assert.ok(selector.includes("Added to your itinerary and budget."));
  assert.ok(selector.includes("Suggested for this trip"));
  assert.ok(selector.includes("no saved price for these dates"));
  assert.ok(selector.includes("Stay prices from Stay22 partner search"));
  assert.ok(selector.includes("Trip total"));
  assert.ok(selector.includes('aria-label="Where you\'ll stay"') || selector.includes("Where you'll stay"));
});
check("STATIC selector: no black, no invented booking claim", () => {
  assert.ok(!/from-black|bg-black|text-black/.test(selector), "selector uses black");
  assert.ok(!selector.includes("Booked"), "selector claims a booking");
});
check("STATIC panel: BoardUI primitives imported and used (was zero)", () => {
  assert.ok(panel.includes('from "@/components/boardui/Card"'));
  assert.ok(panel.includes('from "@/components/boardui/Badge"'));
  assert.ok(panel.includes('from "@/components/boardui/Notice"'));
  assert.ok(panel.includes("<BuiCard"));
  assert.ok(panel.includes("<BuiChip"));
  assert.ok(panel.includes("<BuiNotice"));
  assert.ok(!/from-black|bg-black/.test(panel), "panel still uses black");
});
check("STATIC page: stay section mounts the selector with the trip's own totals", () => {
  assert.ok(page.includes('import { StaySelector } from "@/components/trip/StaySelector"'));
  assert.ok(page.includes("buildStayOptions(titledSuggestions, nights)"));
  assert.ok(page.includes("<StaySelector"));
  assert.ok(page.includes("Stay options in this package"));
  assert.ok(page.includes("selected_hotel_estimate_amount"));
});

console.log(`\n${passed} hotel-selector checks passed, ${failed} failed.`);
if (failed) process.exit(1);
