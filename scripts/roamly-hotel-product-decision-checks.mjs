import assert from "node:assert/strict";
import { evaluateHotelProductOptions } from "../lib/roamly/hotelProductDecision.ts";

const option = (providerProductId, totalStayPrice, overrides = {}) => ({
  providerProductId, roomDescription: null, totalStayPrice, currency: "CAD", taxesFees: null,
  taxInclusionStatus: "unknown", feeInclusionStatus: "unknown", availabilityStatus: "available",
  cancellationPolicy: null, deepLink: null, ...overrides
});
const property = (productOptions, currency = "CAD") => ({ candidateId: "booking:1001", providerPropertyId: "1001", currency, productOptions });

const simple = evaluateHotelProductOptions({ selectedProperty: property([option("P1", 610), option("P2", 675), option("P3", 720)]) });
assert.equal(simple.recommendedProductId, "P1");
assert.equal(simple.rationaleCodes.includes("LOWEST_COMPARABLE_TOTAL"), true);

const unknown = evaluateHotelProductOptions({ selectedProperty: property([option("P1", null), option("P2", 650)]) });
assert.equal(unknown.recommendedProductId, "P2");
assert.equal(unknown.rankedProductOptions.find((item) => item.option.providerProductId === "P1")?.comparableTotal, null);

const mixed = evaluateHotelProductOptions({
  selectedProperty: property([option("USD-1", 500, { currency: "USD" }), option("CAD-1", 650)], ""),
  budgetContext: {}
});
assert.equal(mixed.recommendedProductId, null);
assert.equal(mixed.unresolvedRequirements.includes("availability"), false);
assert.equal(mixed.rationaleCodes[0], "NO_FACTUALLY_ELIGIBLE_PRODUCT");

const mixedWithAuthority = evaluateHotelProductOptions({
  selectedProperty: property([option("USD-1", 500, { currency: "USD" }), option("CAD-1", 650)], ""),
  budgetContext: { comparisonCurrency: "CAD" }
});
assert.equal(mixedWithAuthority.recommendedProductId, "CAD-1");

const invalid = evaluateHotelProductOptions({ selectedProperty: property([option("bad", -10), option("good", 700)]) });
assert.equal(invalid.recommendedProductId, "good");

const cancellation = evaluateHotelProductOptions({
  selectedProperty: property([option("P1", 610, { cancellationPolicy: "non-refundable" }), option("P2", 640, { cancellationPolicy: "refundable/conditional" })]),
  travelerRequirements: { product: { refundableCancellation: { value: true, priority: "hard" } } }
});
assert.equal(cancellation.recommendedProductId, "P2");
assert.equal(cancellation.rankedProductOptions.find((item) => item.option.providerProductId === "P1")?.eligibility, "UNSATISFIED");

const cancellationUnknown = evaluateHotelProductOptions({
  selectedProperty: property([option("P1", 610), option("P2", 640)]),
  travelerRequirements: { product: { freeCancellation: { value: true, priority: "hard" } } }
});
assert.equal(cancellationUnknown.recommendedProductId, null);
assert.equal(cancellationUnknown.unresolvedRequirements.includes("free_cancellation"), true);

const mealUnknown = evaluateHotelProductOptions({
  selectedProperty: property([option("P1", 610)]),
  travelerRequirements: { product: { breakfast: { value: true, priority: "hard" } } }
});
assert.equal(mealUnknown.recommendedProductId, null);
assert.equal(mealUnknown.unresolvedRequirements.includes("breakfast"), true);

const tie = evaluateHotelProductOptions({ selectedProperty: property([option("P2", 610), option("P1", 610)]) });
assert.equal(tie.recommendedProductId, "P1");

const refreshed = evaluateHotelProductOptions({ selectedProperty: property([option("P2", 720), option("P3", 690)]) });
assert.equal(refreshed.recommendedProductId, "P3");
assert.equal(refreshed.rankedProductOptions.some((item) => item.option.providerProductId === "P1"), false);
assert.deepEqual(refreshed.rankedProductOptions.map((item) => item.option.providerProductId), ["P3", "P2"]);

const isolated = evaluateHotelProductOptions({ selectedProperty: property([option("P1", 610), option("P2", 675)]) });
assert.deepEqual(isolated.rankedProductOptions.map((item) => item.option.providerProductId), ["P1", "P2"]);
assert.equal(isolated.propertyCandidateId, "booking:1001");

const noProductId = evaluateHotelProductOptions({ selectedProperty: property([option(null, 100), option("P2", 200)]) });
assert.equal(noProductId.recommendedProductId, "P2");
assert.equal(noProductId.unresolvedRequirements.includes("product_identity"), true);

const confirmed = evaluateHotelProductOptions({ selectedProperty: property([option("P1", 610)]), confirmedHotelBooking: true });
assert.equal(confirmed.recommendedProductId, null);
assert.deepEqual(confirmed.eligibleProductOptions, []);
assert.deepEqual(confirmed.rationaleCodes, ["CONFIRMED_BOOKING_AUTHORITATIVE"]);

const exactProduct = evaluateHotelProductOptions({
  selectedProperty: property([option("P1", 610), option("P2", 600)]),
  travelerRequirements: { product: { exactProductRequest: { value: "P1", priority: "hard" } } }
});
assert.equal(exactProduct.recommendedProductId, "P1");
assert.equal(exactProduct.rankedProductOptions.find((item) => item.option.providerProductId === "P2")?.eligibility, "UNKNOWN");

console.log("Hotel product decision checks passed.");
