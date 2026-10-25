// G8 — Currency provenance checks (no network, no database).
// Proves, against the real lib/roamly/guestItineraryView.ts, that:
//  (a) a missing currency is never defaulted to an invented code: a priced
//      suggestion with no currency renders "price not available", and no
//      label ever carries an invented CAD code;
//  (b) stay picks under the "matched to your budget" heading carry price
//      evidence (amounts + a known currency); unpriced stays never appear
//      there, and when none is priced the stays section is empty (so the
//      component's existing length guard hides it entirely).
// Usage: node --experimental-strip-types scripts/roamly-g8-currency-provenance-checks.mjs
//        [path-to-guestItineraryView.ts] [path-to-GuestFreeItinerary.tsx]
// Defaults are the repo-relative paths.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const viewPath = process.argv[2] || path.join(process.cwd(), "lib/roamly/guestItineraryView.ts");
const componentPath = process.argv[3] || path.join(process.cwd(), "components/plan/GuestFreeItinerary.tsx");
const viewSrc = readFileSync(viewPath, "utf8");

// ---- Structural: no invented-currency default, stays require evidence ----
assert.ok(!/\|\|\s*["']CAD["']/.test(viewSrc), "missing currency must never default to CAD");
assert.ok(!/\?\?\s*["']CAD["']/.test(viewSrc), "missing currency must never fall back to CAD");
assert.ok(
  /stays:\s*bookingSection\([^)]*,\s*true\)/.test(viewSrc),
  "stays must call bookingSection with requirePriceEvidence=true"
);
assert.ok(viewSrc.includes('PRICE_NOT_AVAILABLE'), "view must define the price-not-available label");
assert.ok(
  /requirePriceEvidence[\s\S]{0,400}PRICE_NOT_AVAILABLE/.test(viewSrc),
  "the price-evidence filter must treat 'price not available' as NOT evidence"
);

// ---- Component contract (unchanged file): the heading only renders when
// stays is non-empty, so an empty stays array hides the whole section. ----
let componentSrc = null;
try { componentSrc = readFileSync(componentPath, "utf8"); } catch { /* optional in scratch */ }
if (componentSrc) {
  assert.ok(componentSrc.includes("Stay picks matched to your budget"), "component must still carry the budget-matched heading");
  assert.ok(componentSrc.includes("itinerary.stays.length ?"), "stays section must still be gated on stays.length");
}

// ---- Behavioural: run the real view builder on fixture suggestions ----
const { publicGuestItineraryView } = await import(pathToFileURL(viewPath).href);

function day() {
  return { day_number: 1, title: "Day 1", morning: "Morning", afternoon: "Afternoon", evening: "Evening", food: [], live_timeline: [] };
}
function viewFor(suggestions) {
  return publicGuestItineraryView({
    tripTitle: "Test trip",
    destination: "Toronto",
    itineraryStatus: "generated",
    fullJson: { daily_itinerary: [day()], booking_suggestions: suggestions }
  });
}
const hotel = (overrides) => ({
  booking_category: "hotel",
  affiliate_url: "https://example.test/hotel",
  title: "Test Hotel",
  ...overrides
});

// Case 1: priced + known currency stays, priced + no currency does not, unpriced does not.
const mixed = viewFor([
  hotel({ title: "Priced Hotel", currency: "PHP", estimated_nightly_cost_min: 2000, estimated_nightly_cost_max: 3000, affiliate_url: "https://example.test/priced" }),
  hotel({ title: "No Currency Hotel", estimated_nightly_cost_min: 1500, estimated_nightly_cost_max: 1800, affiliate_url: "https://example.test/nocurrency" }),
  hotel({ title: "No Price Hotel", affiliate_url: "https://example.test/noprice" })
]);
assert.equal(mixed.status, "ready", "fixture view must be ready");
assert.deepEqual(mixed.stays.map((s) => s.title), ["Priced Hotel"], "stays must contain ONLY the priced stay");
assert.ok(mixed.stays[0].priceLabel.includes("PHP"), `priced stay label must carry its real currency, got ${mixed.stays[0].priceLabel}`);
assert.ok(!mixed.stays[0].priceLabel.includes("CAD"), "priced stay label must not invent CAD");
assert.ok(!JSON.stringify(mixed.stays).includes("CAD"), "no stay may render an invented CAD label");

// Case 2: amounts without a currency render "price not available" (flights
// section is the witness: it does not filter, so the card survives to show
// its label — proving the label wording, not just the stays filter).
const flightView = viewFor([
  { booking_category: "flight", affiliate_url: "https://example.test/flight", title: "No Currency Flight", estimated_cost_min: 100, estimated_cost_max: 150 }
]);
assert.equal(flightView.flights.length, 1, "unfiltered section must still surface the card");
assert.equal(flightView.flights[0].priceLabel, "price not available", `missing-currency price must read "price not available", got ${flightView.flights[0].priceLabel}`);

// Case 3: when NO stay carries price evidence, stays is empty — the
// component then hides the "matched to your budget" section entirely.
const unpricedOnly = viewFor([
  hotel({ title: "No Currency Hotel", estimated_nightly_cost_min: 1500, affiliate_url: "https://example.test/nocurrency" }),
  hotel({ title: "No Price Hotel", affiliate_url: "https://example.test/noprice" })
]);
assert.deepEqual(unpricedOnly.stays, [], "stays must be empty when no stay carries price evidence");

// Case 4: unknown is never zero and never a bare number: no label is "0",
// and a currency-less priced card never renders its bare amount.
assert.ok(!flightView.flights[0].priceLabel.includes("100"), "currency-less label must not leak the bare amount");
assert.ok(!mixed.stays.some((s) => s.priceLabel === "0"), "no stay label may be zero for unknown");

console.log("g8-currency-provenance: no CAD default OK; priced-without-currency renders 'price not available' OK; stays carry price evidence only, empty when none priced OK");
